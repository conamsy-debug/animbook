import { Queue, Worker, QueueEvents, type Job } from "bullmq";
import IORedis from "ioredis";
import { appEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { emitPipelineEvent, type PipelineEvent } from "../studio/events.js";
import { generateBookBrain, type BookBrain } from "./bookBrain.js";
import { generateClip, generateStill } from "./runway.js";
import { generateNarration } from "./elevenlabs.js";
import { mirrorToR2, uploadAsset } from "./cloudflare.js";
import { safePrompt, stylePrompt, type NamedCharacter } from "./promptSafety.js";
import { defaultVoiceIdFor, findVoice } from "../config/voices.js";

const QUEUE_NAME = "animbook-pipeline";

let connection: IORedis | null = null;
function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(appEnv.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    });
  }
  return connection;
}

let queue: Queue<PipelineJobData> | null = null;
function getQueue(): Queue<PipelineJobData> {
  if (!queue) queue = new Queue<PipelineJobData>(QUEUE_NAME, { connection: getConnection() });
  return queue;
}

export type ProductionMode = "full" | "illustrated";

export interface PipelineJobData {
  projectId: string;
  triggerStage: "BOOK_BRAIN_ANALYSIS" | "VISUAL_STYLE" | "PROMPT_GENERATION" | "VIDEO_GENERATION" | "AUDIO_PRODUCTION";
  /** Regenerate just this page (with its direction note). */
  pageId?: string;
  /** "full": animate every page. "illustrated": paint every page, animate key scenes. */
  mode?: ProductionMode;
}

export interface ManuscriptPayload {
  pages: { pageNum: number; chapter?: string | null; text: string }[];
  sourceFilename: string;
  sha256: string;
}

export interface ManuscriptRepo {
  read(projectId: string): Promise<ManuscriptPayload | null>;
  write(projectId: string, payload: ManuscriptPayload): Promise<void>;
}

/**
 * In-memory manuscript cache. Real implementation would point to an object
 * store (Cloudflare R2, S3, etc). For Phase 1 we keep the manuscript in the
 * database row to avoid an extra storage dependency.
 */
class DatabaseManuscriptRepo implements ManuscriptRepo {
  async read(projectId: string): Promise<ManuscriptPayload | null> {
    const project = await prisma.studioProject.findUnique({ where: { id: projectId } });
    if (!project || !project.manuscriptSha256) return null;
    const pages = await prisma.page.findMany({
      where: { book: { studioProject: { id: projectId } } },
      orderBy: { pageNum: "asc" }
    });
    return {
      sourceFilename: project.sourceFilename ?? "manuscript.txt",
      sha256: project.manuscriptSha256,
      pages: pages.map((p) => ({ pageNum: p.pageNum, chapter: p.chapter, text: p.textExcerpt }))
    };
  }

  async write(projectId: string, payload: ManuscriptPayload): Promise<void> {
    // Pages are written by the upload route; this is a no-op for now.
    void projectId;
    void payload;
  }
}

export const manuscriptRepo: ManuscriptRepo = new DatabaseManuscriptRepo();

export async function enqueuePipeline(data: PipelineJobData): Promise<string> {
  // Analysis is cheap and safe to retry; generation spends Runway/ElevenLabs
  // credits, so it runs once and reports failures instead of repeating.
  const job = await getQueue().add("pipeline", data, {
    removeOnComplete: 50,
    removeOnFail: 50,
    attempts: data.triggerStage === "BOOK_BRAIN_ANALYSIS" ? 2 : 1
  });
  return job.id ?? "unknown";
}

export function startPipelineWorker(): Worker<PipelineJobData> | null {
  if (appEnv.NODE_ENV === "test") return null;
  try {
    const worker = new Worker<PipelineJobData>(
      QUEUE_NAME,
      async (job: Job<PipelineJobData>) => runPipeline(job.data),
      { connection: getConnection() }
    );
    worker.on("failed", (job, err) => {
      if (!job) return;
      emitPipelineEvent(job.data.projectId, {
        stage: "PIPELINE",
        status: "failed",
        progress: 0,
        message: err.message,
        at: new Date().toISOString()
      });
    });
    return worker;
  } catch (err) {
    console.warn("[pipeline] worker failed to start:", (err as Error).message);
    return null;
  }
}

export function startPipelineEvents(): QueueEvents | null {
  if (appEnv.NODE_ENV === "test") return null;
  try {
    const events = new QueueEvents(QUEUE_NAME, { connection: getConnection() });
    events.on("completed", ({ jobId }) => {
      // Best-effort: the worker emits the granular events.
      void jobId;
    });
    return events;
  } catch (err) {
    console.warn("[pipeline] events failed to start:", (err as Error).message);
    return null;
  }
}

async function emit(projectId: string, event: Omit<PipelineEvent, "at">): Promise<void> {
  emitPipelineEvent(projectId, { ...event, at: new Date().toISOString() });
}

async function runPipeline(data: PipelineJobData): Promise<void> {
  switch (data.triggerStage) {
    case "BOOK_BRAIN_ANALYSIS":
      return runAnalysis(data);
    case "AUDIO_PRODUCTION":
      return runAudioOnly(data);
    default:
      return data.pageId ? runPageRegeneration(data) : runGeneration(data);
  }
}

/** Upload → Book Brain, then stop so the author can review it and pick a style. */
async function runAnalysis(data: PipelineJobData): Promise<void> {
  const project = await prisma.studioProject.findUnique({
    where: { id: data.projectId },
    include: { book: true }
  });
  if (!project) throw new Error(`Studio project ${data.projectId} not found`);
  const manuscript = await manuscriptRepo.read(data.projectId);
  if (!manuscript) throw new Error("Manuscript not ingested yet");

  await emit(data.projectId, { stage: "MANUSCRIPT_INGESTION", status: "succeeded", progress: 10, message: "Manuscript ingested" });
  await prisma.studioProject.update({
    where: { id: data.projectId },
    data: { status: "ANALYZING", currentStage: "BOOK_BRAIN_ANALYSIS" }
  });
  await emit(data.projectId, { stage: "BOOK_BRAIN_ANALYSIS", status: "running", progress: 15, message: "Reading the manuscript" });
  const { brain, source } = await generateBookBrain({
    title: project.book?.title ?? project.name,
    author: project.book?.author,
    vertical: project.vertical,
    manuscript
  });
  await persistBrain(data.projectId, brain);
  await prisma.studioProject.update({
    where: { id: data.projectId },
    data: { status: "BRAIN_REVIEW", currentStage: "BOOK_BRAIN_ANALYSIS" }
  });
  await emit(data.projectId, {
    stage: "BOOK_BRAIN_ANALYSIS",
    status: "succeeded",
    progress: 30,
    message: source === "anthropic" ? "Analysis ready for your review" : `Analysis ready (${source})`
  });
}

async function loadBrain(bookId: string): Promise<BookBrain> {
  const row = await prisma.bookBrain.findUnique({ where: { bookId }, select: { rawJson: true } });
  if (!row) throw new Error("Book Brain missing — run the analysis first");
  return row.rawJson as unknown as BookBrain;
}

/**
 * Pages that get full motion in "illustrated" mode: chapter openings, the
 * Book Brain's key beats, and a steady sprinkle in between.
 */
function keyPagesFor(brain: BookBrain, pages: { pageNum: number; chapter: string | null }[]): Set<number> {
  const key = new Set<number>();
  const arc = brain.narrative_arc ?? { setup_pages: [], climax_pages: [], resolution_pages: [] };
  for (const n of [...(arc.setup_pages ?? []), ...(arc.climax_pages ?? []), ...(arc.resolution_pages ?? [])]) key.add(n);
  let lastChapter: string | null = null;
  for (const p of pages) {
    if (p.chapter && p.chapter !== lastChapter) {
      key.add(p.pageNum);
      lastChapter = p.chapter;
    }
  }
  key.add(pages[0]?.pageNum ?? 1);
  // At least one moving page in every ten.
  for (let i = 0; i < pages.length; i += 10) {
    const window = pages.slice(i, i + 10).map((p) => p.pageNum);
    if (!window.some((n) => key.has(n))) key.add(window[0]!);
  }
  return key;
}

/** After style selection: prompts → video → narration → ready for review. */
async function runGeneration(data: PipelineJobData): Promise<void> {
  const project = await prisma.studioProject.findUnique({ where: { id: data.projectId }, select: { bookId: true } });
  if (!project?.bookId) throw new Error("Studio project has no linked book");
  const brain = await loadBrain(project.bookId);
  const mode: ProductionMode = data.mode ?? ((brain as { production_mode?: ProductionMode }).production_mode ?? "full");
  // Remember the mode so single-page regenerations match the rest of the book.
  await prisma.bookBrain.update({
    where: { bookId: project.bookId },
    data: { rawJson: { ...(brain as unknown as object), production_mode: mode } as object }
  });

  await prisma.studioProject.update({
    where: { id: data.projectId },
    data: { status: "GENERATING", currentStage: "PROMPT_GENERATION" }
  });
  await emit(data.projectId, { stage: "PROMPT_GENERATION", status: "running", progress: 35, message: "Writing scene prompts" });
  await buildPrompts(data.projectId, brain);
  await emit(data.projectId, { stage: "PROMPT_GENERATION", status: "succeeded", progress: 45 });

  await prisma.studioProject.update({ where: { id: data.projectId }, data: { currentStage: "VIDEO_GENERATION" } });
  await emit(data.projectId, { stage: "VIDEO_GENERATION", status: "running", progress: 50, message: "Animating pages" });
  const video = await runVideoStage(data.projectId, brain, mode);
  await emit(data.projectId, {
    stage: "VIDEO_GENERATION",
    status: "succeeded",
    progress: 80,
    message: video.failed ? `${video.done} pages animated, ${video.failed} need another try` : `${video.done} pages animated`
  });

  await prisma.studioProject.update({ where: { id: data.projectId }, data: { currentStage: "AUDIO_PRODUCTION" } });
  // Long books: record the opening pages now; the rest are recorded the first
  // time a reader plays them (see /api/narration/pages).
  const narrateLimit = video.total > 60 ? 3 : undefined;
  await emit(data.projectId, {
    stage: "AUDIO_PRODUCTION",
    status: "running",
    progress: 85,
    message: narrateLimit ? "Recording the opening pages" : "Recording narration"
  });
  await runAudioStage(data.projectId, narrateLimit);
  await emit(data.projectId, {
    stage: "AUDIO_PRODUCTION",
    status: "succeeded",
    progress: 95,
    message: narrateLimit ? "Opening pages narrated; the rest record as readers play them" : undefined
  });

  await prisma.studioProject.update({
    where: { id: data.projectId },
    data: { status: "REVIEW", currentStage: "QUALITY_TRIAGE" }
  });
  await emit(data.projectId, { stage: "QUALITY_TRIAGE", status: "succeeded", progress: 100, message: "Ready for your review" });
}

async function runAudioOnly(data: PipelineJobData): Promise<void> {
  await emit(data.projectId, { stage: "AUDIO_PRODUCTION", status: "running", progress: 85, message: "Recording narration" });
  await runAudioStage(data.projectId);
  await prisma.studioProject.update({ where: { id: data.projectId }, data: { status: "REVIEW", currentStage: "QUALITY_TRIAGE" } });
  await emit(data.projectId, { stage: "AUDIO_PRODUCTION", status: "succeeded", progress: 100, message: "Narration ready" });
}

async function runPageRegeneration(data: PipelineJobData): Promise<void> {
  const page = await prisma.page.findUnique({ where: { id: data.pageId! } });
  if (!page) throw new Error("Page not found");
  const brain = await loadBrain(page.bookId);
  await emit(data.projectId, { stage: "VIDEO_GENERATION", status: "running", progress: 60, message: `Re-animating page ${page.pageNum}` });
  const mode: ProductionMode = (brain as { production_mode?: ProductionMode }).production_mode ?? "full";
  const wasStill = mode === "illustrated" && !page.videoUrl;
  const result = await animatePage(data.projectId, brain, page, !wasStill);
  await emit(data.projectId, {
    stage: "VIDEO_GENERATION",
    status: result === "done" ? "succeeded" : "failed",
    progress: 100,
    message: result === "done" ? `Page ${page.pageNum} re-animated` : `Page ${page.pageNum} could not be animated — try another note`
  });
}

async function persistBrain(projectId: string, brain: BookBrain): Promise<void> {
  const project = await prisma.studioProject.findUnique({ where: { id: projectId }, select: { bookId: true } });
  if (!project?.bookId) throw new Error("Studio project has no linked book");
  await prisma.bookBrain.upsert({
    where: { bookId: project.bookId },
    create: {
      bookId: project.bookId,
      genre: brain.genre,
      culturalOrigin: brain.cultural_origin,
      targetAudience: brain.target_audience,
      styleSelected: brain.style_recommendation,
      rawJson: brain as unknown as object
    },
    update: {
      genre: brain.genre,
      culturalOrigin: brain.cultural_origin,
      targetAudience: brain.target_audience,
      styleSelected: brain.style_recommendation,
      rawJson: brain as unknown as object
    }
  });
}

async function buildPrompts(projectId: string, brain: BookBrain): Promise<void> {
  const project = await prisma.studioProject.findUnique({ where: { id: projectId }, select: { bookId: true } });
  if (!project?.bookId) return;
  await Promise.all(
    brain.page_manifest.map((page) =>
      prisma.page.update({
        where: { bookId_pageNum: { bookId: project.bookId!, pageNum: page.page_num } },
        data: {
          animationPrompt: page.animation_prompt_draft,
          negativePrompt: "blurry, low quality, distorted faces",
          sceneType: page.primary_action,
          emotionalRegister: page.emotion,
          cameraAngle: page.camera_angle
        }
      })
    )
  );
}

async function runVideoStage(projectId: string, brain: BookBrain, mode: ProductionMode): Promise<{ done: number; failed: number; total: number }> {
  const project = await prisma.studioProject.findUnique({ where: { id: projectId }, select: { bookId: true } });
  if (!project?.bookId) return { done: 0, failed: 0, total: 0 };
  const pages = await prisma.page.findMany({ where: { bookId: project.bookId }, orderBy: { pageNum: "asc" } });
  const keyPages = mode === "illustrated" ? keyPagesFor(brain, pages.map((p) => ({ pageNum: p.pageNum, chapter: p.chapter }))) : null;
  let next = 0;
  let done = 0;
  let failed = 0;
  // Two at a time keeps within Runway's concurrency limits.
  await Promise.all(
    [0, 1].map(async () => {
      while (next < pages.length) {
        const page = pages[next++];
        const moving = !keyPages || keyPages.has(page.pageNum);
        const result = await animatePage(projectId, brain, page, moving);
        if (result === "done") done++;
        else failed++;
        await emit(projectId, {
          stage: "VIDEO_GENERATION",
          status: "running",
          progress: 50 + Math.round((30 * (done + failed)) / Math.max(1, pages.length)),
          message: `Page ${page.pageNum} ${result === "done" ? (moving ? "animated" : "illustrated") : "needs another try"}`
        });
      }
    })
  );
  return { done, failed, total: pages.length };
}

type PageRow = Awaited<ReturnType<typeof prisma.page.findMany>>[number];

/**
 * One page: safe, styled prompts → Runway → R2. `moving` pages get a video;
 * the rest get a painted still (about a sixth of the cost) which the reader
 * slowly pans across. Pages wait for the author's approval.
 */
async function animatePage(projectId: string, brain: BookBrain, page: PageRow, moving = true): Promise<"done" | "failed"> {
  const book = await prisma.book.findUnique({ where: { id: page.bookId }, select: { styleId: true } });
  const style = stylePrompt(book?.styleId, brain.style_recommendation);
  const manifest = brain.page_manifest.find((m) => m.page_num === page.pageNum);
  const characters: NamedCharacter[] = (brain.characters ?? []).map((c) => ({ name: c.name, description: c.description }));
  const present = characters.filter((c) => manifest?.characters_present?.includes(c.name));
  const cast = present.map((c) => `${c.description}`).join("; ");
  const scene = manifest?.animation_prompt_draft ?? page.animationPrompt ?? page.textExcerpt;
  const count = present.length === 0 ? "" : present.length === 1 ? "Exactly one character in frame. " : `Exactly ${present.length} characters in frame. `;
  const note = page.directionNote ? ` Direction: ${page.directionNote}` : "";
  const still = safePrompt(`${style}. ${count}${scene}${cast ? ` Characters: ${cast}.` : ""}${note}`, characters);
  const motion = safePrompt(
    `${count}Small, natural movement: ${manifest?.primary_action ?? "gentle ambient motion"}. ` +
      `Mood: ${manifest?.emotion ?? page.emotionalRegister ?? "calm"}. Slow camera push-in. No new people or animals enter the frame.${note}`,
    characters
  );
  try {
    if (!moving) {
      const url = await generateStill(still, "1920:1080");
      const stored = await mirrorToR2(url, `studio/${projectId}/p${page.pageNum}-${Date.now().toString(36)}.png`, "image/png");
      await prisma.page.update({
        where: { id: page.id },
        data: { videoUrl: null, posterUrl: stored.url, animationPrompt: still, qualityScore: 0.8, status: "PENDING" }
      });
      return "done";
    }
    const result = await generateClip({
      projectId,
      pageNum: page.pageNum,
      prompt: still,
      motionPrompt: motion,
      negativePrompt: page.negativePrompt ?? undefined,
      storagePrefix: `studio/${projectId}`,
      strict: true
    });
    await prisma.page.update({
      where: { id: page.id },
      data: { videoUrl: result.videoUrl, posterUrl: result.posterUrl, animationPrompt: still, qualityScore: 0.85, status: "PENDING" }
    });
    return "done";
  } catch (err) {
    console.warn(`[pipeline] page ${page.pageNum}: ${(err as Error).message}`);
    await prisma.page.update({ where: { id: page.id }, data: { status: "FLAGGED", qualityScore: 0 } });
    return "failed";
  }
}

async function runAudioStage(projectId: string, limit?: number): Promise<void> {
  const project = await prisma.studioProject.findUnique({ where: { id: projectId }, select: { bookId: true } });
  if (!project?.bookId) return;
  const pages = (await prisma.page.findMany({ where: { bookId: project.bookId }, orderBy: { pageNum: "asc" } })).slice(0, limit);
  const brain = await prisma.bookBrain.findUnique({
    where: { bookId: project.bookId },
    select: { narratorVoiceId: true, culturalOrigin: true, book: { select: { vertical: true } } }
  });
  const voiceId =
    brain?.narratorVoiceId ??
    findVoice(defaultVoiceIdFor({ vertical: brain?.book.vertical ?? "CONSUMER", setting: brain?.culturalOrigin }))?.elevenVoiceId;
  // Sequential: ElevenLabs limits concurrent requests on smaller plans.
  for (const page of pages) {
    const result = await generateNarration({
      text: page.textExcerpt,
      voiceId,
      storageKey: `narration/${projectId}/p${page.pageNum}-${Date.now().toString(36)}.mp3`
    });
    if (!result.audioUrl) continue;
    await prisma.page.update({
      where: { id: page.id },
      data: { audioUrl: result.audioUrl, vttUrl: result.vttUrl }
    });
  }
}

export async function shutdownPipeline(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}

// Used by the upload route to register a manuscript after parsing.
export async function registerManuscript(projectId: string, payload: ManuscriptPayload): Promise<void> {
  const project = await prisma.studioProject.findUnique({ where: { id: projectId } });
  if (!project?.bookId) throw new Error("Project has no linked book");
  await prisma.page.deleteMany({ where: { bookId: project.bookId } });
  await prisma.page.createMany({
    data: payload.pages.map((p) => ({
      bookId: project.bookId!,
      pageNum: p.pageNum,
      chapter: p.chapter ?? null,
      textExcerpt: p.text,
      sourceTextSha256: payload.sha256,
      status: "PENDING" as const
    }))
  });
  await prisma.studioProject.update({
    where: { id: projectId },
    data: {
      sourceFilename: payload.sourceFilename,
      manuscriptSha256: payload.sha256,
      status: "BRAIN_REVIEW",
      currentStage: "BOOK_BRAIN_ANALYSIS"
    }
  });
  await prisma.book.update({
    where: { id: project.bookId },
    data: { totalPages: payload.pages.length }
  });
}

// Re-export helper used by the upload pipeline.
export { uploadAsset };