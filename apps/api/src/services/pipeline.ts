import { Queue, Worker, QueueEvents, type Job } from "bullmq";
import IORedis from "ioredis";
import { appEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { emitPipelineEvent, type PipelineEvent } from "../studio/events.js";
import { generateBookBrain, type BookBrain } from "./bookBrain.js";
import { generateClip, generateStill, animateStill } from "./runway.js";
import { generateNarration } from "./elevenlabs.js";
import { mirrorToR2, uploadAsset } from "./cloudflare.js";
import { safePrompt, stylePrompt, type NamedCharacter } from "./promptSafety.js";
import { defaultVoiceIdFor, findVoice } from "../config/voices.js";
import { splitHookIntoScenes } from "./trailer.js";

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
  triggerStage: "BOOK_BRAIN_ANALYSIS" | "VISUAL_STYLE" | "PROMPT_GENERATION" | "VIDEO_GENERATION" | "AUDIO_PRODUCTION" | "TRAILER_GENERATION";
  /** Regenerate just this page (with its direction note). */
  pageId?: string;
  /** "full": animate every page. "illustrated": paint every page, animate key scenes. */
  mode?: ProductionMode;
  /** Only used by TRAILER_GENERATION — identifies which share to write the
   *  stitched trailer back into. */
  shareId?: string;
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
    case "TRAILER_GENERATION":
      return runTrailerStage(data);
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

/** Exported so splitPipeline can reuse it for per-page still/animate jobs. */
export async function loadBrain(bookId: string): Promise<BookBrain> {
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
  // Pages where the author has manually overridden motionTier — we skip
  // writing that column for them so a Brain re-analysis preserves the
  // override. Other fields (animationPrompt, sceneType, etc.) still get
  // refreshed; only motionTier is sticky.
  const overridden = await prisma.page.findMany({
    where: { bookId: project.bookId, motionTierOverridden: true },
    select: { pageNum: true }
  });
  const overriddenNums = new Set(overridden.map((p) => p.pageNum));
  await Promise.all(
    brain.page_manifest.map((page) => {
      const skipTier = overriddenNums.has(page.page_num);
      // Backwards-compat: older stored brains don't carry motionTier; we
      // default to STANDARD so legacy rows get the cheaper 5s clip.
      const tier = page.motionTier ?? "STANDARD";
      return prisma.page.update({
        where: { bookId_pageNum: { bookId: project.bookId!, pageNum: page.page_num } },
        data: {
          animationPrompt: page.animation_prompt_draft,
          negativePrompt: "blurry, low quality, distorted faces",
          sceneType: page.primary_action,
          emotionalRegister: page.emotion,
          cameraAngle: page.camera_angle,
          ...(skipTier ? {} : { motionTier: tier })
        }
      });
    })
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
    select: {
      narratorVoiceId: true,
      culturalOrigin: true,
      book: {
        select: {
          vertical: true,
          creator: { select: { id: true, narratorVoiceId: true, voiceStatus: true } }
        }
      }
    }
  });
  // Voice precedence:
  //   1. BookBrain.narratorVoiceId (book-level pin the author picked in Studio;
  //      can be either a curated id like "british-storyteller" or
  //      "author:<elevenVoiceId>" to use the author's clone).
  //   2. The author's own ElevenLabs clone — listed first under the curated
  //      list at /api/narration/voices when readers pick voices, and used
  //      by default here so an author's books naturally read in their own
  //      voice without any Studio setup.
  //   3. Vertical + region default.
  let chosenId = brain?.narratorVoiceId ?? null;
  if (!chosenId || chosenId === "author:auto") {
    const creatorClone = brain?.book.creator;
    if (creatorClone?.narratorVoiceId && creatorClone.voiceStatus === "CLONED") {
      chosenId = creatorClone.narratorVoiceId;
    }
  }
  if (!chosenId) {
    chosenId = findVoice(defaultVoiceIdFor({ vertical: brain?.book.vertical ?? "CONSUMER", setting: brain?.culturalOrigin }))?.elevenVoiceId;
  }
  // Brain may store the author-key wrapper ("author:voice_abc") which is
  // our stable AnimBook-side id; strip the prefix so ElevenLabs gets the
  // raw voice_id.
  const voiceId = chosenId?.startsWith("author:") ? chosenId.slice("author:".length) : chosenId;
  // Sequential: ElevenLabs limits concurrent requests on smaller plans.
  let didMarkOrphan = false; // dedupe the REMOVED write per run
  for (const page of pages) {
    // Skip pages that already have narration — re-kicks (e.g. after
    // OCR-garbage cleanup) shouldn't burn credits re-narrating good
    // pages. The user can clear `audioUrl` to force a re-narrate.
    if (page.audioUrl) continue;
    try {
      const result = await generateNarration({
        text: page.textExcerpt,
        voiceId,
        storageKey: `narration/${projectId}/p${page.pageNum}-${Date.now().toString(36)}.mp3`
      });
      // If ElevenLabs returned 404 for the voice we asked for, generateNarration
      // already retried with the fallback voice. Surface the orphaned id to
      // the user record so the UI shows the "re-clone" banner. Only the
      // first orphaned page writes — subsequent pages in the same run skip
      // the redundant UPDATE since voiceStatus is already REMOVED.
      if (result.orphanedVoiceId && !didMarkOrphan && brain?.book.creator?.id) {
        const { markVoiceOrphaned } = await import("./elevenlabs.js");
        const flipped = await markVoiceOrphaned(brain.book.creator.id, result.orphanedVoiceId);
        if (flipped) {
          console.warn(`[pipeline/audio] user ${brain.book.creator.id} voice ${result.orphanedVoiceId} marked REMOVED`);
          didMarkOrphan = true;
        }
      }
      if (!result.audioUrl) {
        // Narration came back as a stub — nothing useful to store. Leave the
        // page's audioStatus alone so a re-run can succeed.
        continue;
      }
      await prisma.page.update({
        where: { id: page.id },
        data: { audioUrl: result.audioUrl, vttUrl: result.vttUrl, audioStatus: "READY" }
      });
    } catch (err) {
      console.warn(`[pipeline/audio] page ${page.pageNum}: ${(err as Error).message}`);
      await prisma.page.update({
        where: { id: page.id },
        data: { audioStatus: "FAILED" }
      }).catch(() => {/* page might have been deleted concurrently */});
    }
  }
}

/**
 * Trailer pipeline: turn a BookShare hook into a 3-clip Runway trailer.
 * 1) fetch the share row + project + book
 * 2) split the hook into 3 scene prompts
 * 3) generateStill + animateStill per scene
 * 4) ffmpeg concat the 3 clips into a single ~30s MP4
 * 5) upload the MP4 to R2, write back to BookShare.trailerUrl + status=READY
 */
async function runTrailerStage(data: PipelineJobData): Promise<void> {
  if (!data.shareId) throw new Error("TRAILER_GENERATION needs shareId");
  const share = await prisma.bookShare.findUnique({
    where: { id: data.shareId },
    include: { book: { select: { id: true, vertical: true, title: true, author: true, slug: true } } }
  });
  if (!share?.book) throw new Error(`Share ${data.shareId} not found`);
  await prisma.bookShare.update({
    where: { id: share.id },
    data: { status: "GENERATING", failureReason: null }
  });
  await emit(data.projectId, {
    stage: "TRAILER_GENERATION",
    status: "running",
    progress: 5,
    message: "Splitting the hook into scenes"
  });

  const scenes = splitHookIntoScenes(share.hook);
  const styleBase = "Cinematic book-trailer still, vertical-friendly 16:9, painterly style consistent with a quality picture book.";

  // Each scene = 1 still + 1 10s clip.
  const clipUrls: string[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      const promptKey = `scene${i + 1}` as "scene1" | "scene2" | "scene3";
      const scenePrompt = scenes[promptKey];
      await emit(data.projectId, {
        stage: "TRAILER_GENERATION",
        status: "running",
        progress: 10 + i * 25,
        message: `Scene ${i + 1}/3 — generating still`
      });
      const stillUrl = await generateStill(`${styleBase} ${scenePrompt}`, "1280:720");
      // animateStill uploads the clip via mirrorToR2 internally; verify by
      // checking the returned URL is hosted on our CDN.
      const clipUrl = await animateStill(stillUrl, `Subtle cinematic motion: ${scenePrompt}`, 10, "1280:720");
      clipUrls.push(clipUrl);
    }

    // Stitch the 3 clips. Pull each one into a temp file, concat, upload.
    await emit(data.projectId, {
      stage: "TRAILER_GENERATION",
      status: "running",
      progress: 90,
      message: "Stitching the trailer"
    });
    const { stitchTrailerClips, applyTrailerWatermark } = await import("./trailer.js");
    const { readFile } = await import("node:fs/promises");
    const { writeFileSync } = await import("node:fs");
    const listFile = `/tmp/trailer-${share.id}.txt`;
    const workDir = `/tmp/trailer-${share.id}`;
    const { mkdirSync } = await import("node:fs");
    mkdirSync(workDir, { recursive: true });
    const localPaths: string[] = [];
    for (let i = 0; i < clipUrls.length; i++) {
      const localPath = `${workDir}/c${i + 1}.mp4`;
      const r = await fetch(clipUrls[i]!);
      const buf = Buffer.from(await r.arrayBuffer());
      writeFileSync(localPath, buf);
      localPaths.push(localPath);
    }
    const listContents = localPaths.map((p) => `file '${p}'`).join("\n");
    writeFileSync(listFile, listContents);
    const outFile = `${workDir}/trailer.mp4`;
    await stitchTrailerClips(listFile, outFile);

    // Burn in the AnimBook wordmark before upload so the trailer is
    // pre-branded wherever it's posted (no second-pass editing needed).
    await emit(data.projectId, {
      stage: "TRAILER_GENERATION",
      status: "running",
      progress: 95,
      message: "Adding the AnimBook wordmark"
    });
    const watermarkedFile = `${workDir}/trailer-watermarked.mp4`;
    try {
      await applyTrailerWatermark(outFile, watermarkedFile);
    } catch (watermarkErr) {
      // Watermarking is non-essential — never fail the whole trailer because
      // of a missing asset or a transient ffmpeg hiccup. Log and ship the
      // un-watermarked file.
      console.warn(`[trailer] watermark failed (${(watermarkErr as Error).message.slice(0, 200)}), shipping without watermark`);
      writeFileSync(watermarkedFile, await readFile(outFile));
    }
    const trailerBuf = await readFile(watermarkedFile);
    const { uploadAsset } = await import("./cloudflare.js");
    const stored = await uploadAsset({
      key: `trailer/${share.book.id}/${share.id}.mp4`,
      body: trailerBuf,
      contentType: "video/mp4"
    });

    // Cover-with-title-overlay thumbnail. Used as `og:image` and the
    // share landing poster so social previews show the book title even
    // on platforms that strip video playback. Best-effort: a missing
    // cover URL or ffmpeg failure will leave thumbnailUrl null and the
    // public share endpoint falls back to the bare coverUrl.
    let thumbnailUrl: string | null = null;
    try {
      const cover = await prisma.book.findUnique({
        where: { id: share.book.id },
        select: { coverUrl: true, title: true }
      });
      if (cover?.coverUrl) {
        const { renderCoverOverlayPng } = await import("./trailer.js");
        const { pngBytes } = await renderCoverOverlayPng(cover.coverUrl, cover.title);
        const thumb = await uploadAsset({
          key: `share/${share.book.id}/${share.id}-thumb.png`,
          body: pngBytes,
          contentType: "image/png",
          cacheControl: "public, max-age=86400"
        });
        thumbnailUrl = thumb.url;
      }
    } catch (thumbErr) {
      console.warn(`[trailer] thumbnail failed (${(thumbErr as Error).message.slice(0, 200)}), using bare coverUrl`);
    }

    await prisma.bookShare.update({
      where: { id: share.id },
      data: {
        trailerUrl: stored.url,
        thumbnailUrl: thumbnailUrl ?? undefined,
        status: "READY",
        failureReason: null
      }
    });
    await emit(data.projectId, {
      stage: "TRAILER_GENERATION",
      status: "succeeded",
      progress: 100,
      message: "Trailer ready"
    });
    // Best-effort cleanup of temp files.
    const { rmSync } = await import("node:fs");
    rmSync(workDir, { recursive: true, force: true });
  } catch (err) {
    const reason = (err as Error).message.slice(0, 500);
    console.warn(`[trailer] share ${share.id} failed: ${reason}`);
    await prisma.bookShare.update({
      where: { id: share.id },
      data: { status: "FAILED", failureReason: reason }
    });
    await emit(data.projectId, {
      stage: "TRAILER_GENERATION",
      status: "failed",
      progress: 0,
      message: `Trailer failed: ${reason}`
    });
    throw err;
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