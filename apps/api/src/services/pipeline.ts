import { Queue, Worker, QueueEvents, type Job } from "bullmq";
import IORedis from "ioredis";
import { appEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { emitPipelineEvent, type PipelineEvent } from "../studio/events.js";
import { generateBookBrain, type BookBrain } from "./bookBrain.js";
import { generateClip } from "./runway.js";
import { generateNarration } from "./elevenlabs.js";
import { uploadAsset } from "./cloudflare.js";

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

export interface PipelineJobData {
  projectId: string;
  triggerStage: "BOOK_BRAIN_ANALYSIS" | "VISUAL_STYLE" | "PROMPT_GENERATION" | "VIDEO_GENERATION" | "AUDIO_PRODUCTION";
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
  const job = await getQueue().add("pipeline", data, {
    removeOnComplete: 50,
    removeOnFail: 50,
    attempts: 2
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
  const project = await prisma.studioProject.findUnique({
    where: { id: data.projectId },
    include: { book: { include: { pages: true } } }
  });
  if (!project) throw new Error(`Studio project ${data.projectId} not found`);
  const manuscript = await manuscriptRepo.read(data.projectId);
  if (!manuscript) throw new Error("Manuscript not ingested yet");

  await emit(data.projectId, { stage: "MANUSCRIPT_INGESTION", status: "succeeded", progress: 10, message: "Manuscript ingested" });

  // Stage 02: Book Brain analysis
  await prisma.studioProject.update({ where: { id: data.projectId }, data: { currentStage: "BOOK_BRAIN_ANALYSIS" } });
  await emit(data.projectId, { stage: "BOOK_BRAIN_ANALYSIS", status: "running", progress: 15 });
  const { brain, source } = await generateBookBrain({
    title: project.book?.title ?? project.name,
    author: project.book?.author,
    vertical: project.vertical,
    manuscript
  });
  await persistBrain(data.projectId, brain);
  await emit(data.projectId, {
    stage: "BOOK_BRAIN_ANALYSIS",
    status: "succeeded",
    progress: 30,
    message: `Brain generated (${source})`
  });

  // Stage 04: Prompt generation (parallel)
  await prisma.studioProject.update({ where: { id: data.projectId }, data: { currentStage: "PROMPT_GENERATION" } });
  await emit(data.projectId, { stage: "PROMPT_GENERATION", status: "running", progress: 35 });
  await buildPrompts(data.projectId, brain);
  await emit(data.projectId, { stage: "PROMPT_GENERATION", status: "succeeded", progress: 50 });

  // Stage 05: Video generation (parallel)
  await prisma.studioProject.update({ where: { id: data.projectId }, data: { currentStage: "VIDEO_GENERATION" } });
  await emit(data.projectId, { stage: "VIDEO_GENERATION", status: "running", progress: 55 });
  await runVideoStage(data.projectId, brain);
  await emit(data.projectId, { stage: "VIDEO_GENERATION", status: "succeeded", progress: 75 });

  // Stage 06/07: Quality + audio (best-effort, in-line)
  await prisma.studioProject.update({ where: { id: data.projectId }, data: { currentStage: "AUDIO_PRODUCTION" } });
  await emit(data.projectId, { stage: "AUDIO_PRODUCTION", status: "running", progress: 80 });
  await runAudioStage(data.projectId);
  await emit(data.projectId, { stage: "AUDIO_PRODUCTION", status: "succeeded", progress: 95 });

  await prisma.studioProject.update({
    where: { id: data.projectId },
    data: { currentStage: "METADATA_UPLOAD", status: "READY_TO_PUBLISH" }
  });
  await emit(data.projectId, { stage: "PUBLISH", status: "succeeded", progress: 100, message: "Ready to publish" });
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
          negativePrompt: "blurry, low quality, distorted faces, watermarks",
          sceneType: page.primary_action,
          emotionalRegister: page.emotion,
          cameraAngle: page.camera_angle
        }
      })
    )
  );
}

async function runVideoStage(projectId: string, brain: BookBrain): Promise<void> {
  const project = await prisma.studioProject.findUnique({ where: { id: projectId }, select: { bookId: true } });
  if (!project?.bookId) return;
  const pages = await prisma.page.findMany({
    where: { bookId: project.bookId },
    orderBy: { pageNum: "asc" }
  });
  await Promise.all(
    pages.map(async (page) => {
      const manifest = brain.page_manifest.find((m) => m.page_num === page.pageNum);
      const prompt = manifest?.animation_prompt_draft ?? page.animationPrompt ?? "Cinematic still atmosphere";
      const result = await generateClip({ projectId, pageNum: page.pageNum, prompt });
      await prisma.page.update({
        where: { id: page.id },
        data: {
          videoUrl: result.videoUrl,
          posterUrl: result.posterUrl,
          qualityScore: result.source === "runway" ? 0.85 : 0.6,
          status: "APPROVED"
        }
      });
    })
  );
}

async function runAudioStage(projectId: string): Promise<void> {
  const project = await prisma.studioProject.findUnique({ where: { id: projectId }, select: { bookId: true } });
  if (!project?.bookId) return;
  const pages = await prisma.page.findMany({ where: { bookId: project.bookId }, orderBy: { pageNum: "asc" } });
  await Promise.all(
    pages.map(async (page) => {
      const result = await generateNarration({ text: page.textExcerpt });
      await prisma.page.update({
        where: { id: page.id },
        data: { audioUrl: result.audioUrl, vttUrl: result.vttUrl }
      });
    })
  );
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