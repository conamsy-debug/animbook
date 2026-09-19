/**
 * Split-pipeline workers — STILL_PAGE and ANIMATE_PAGE.
 *
 * Runs on its own Bull queue (`animbook-split-pipeline`) with one job per
 * page so pages run in parallel instead of one after another. Concurrency
 * is tuned by env (`STILL_PAGE_CONCURRENCY` default 4, `ANIMATE_PAGE_CONCURRENCY`
 * default 2) — keep it low enough for Runway's per-account rate limits.
 *
 * Hard gates from the brief:
 *   - ANIMATE_PAGE refuses to spend Runway credits unless `stillStatus ===
 *     APPROVED` on the page. If not, it sets the clip to STALE and
 *     returns silently.
 *   - On failure, we mark the page FAILED only on the LAST attempt — earlier
 *     attempts rethrow so Bull's exponential backoff retries. This stops a
 *     worker that crashes mid-run from leaving a page in FAILED when a
 *     retry could still succeed.
 *
 * Idempotency: Bull jobId includes the still version (`still:<pageId>:v<n>`
 * and `animate:<pageId>:v<n>`). A double-click with the same version is a
 * no-op (Bull rejects duplicate jobIds); a regeneration that bumps
 * stillVersion gets through.
 *
 * Only enabled for books with `Book.splitPipeline = true`. The legacy
 * single-stage `VIDEO_GENERATION` pipeline stays exactly as it is in
 * pipeline.ts; routes gate on the flag.
 *
 * Testability: the processors take an optional `SplitDeps` so unit tests
 * can pass fakes for Runway / R2 / Prisma without spinning up Redis. The
 * live worker passes `defaultDeps()`.
 */
import { Queue, Worker } from "bullmq";
import type { JobsOptions } from "bullmq";
import type { WorkerOptions } from "bullmq/dist/esm/interfaces/index.js";
import type { Job } from "bullmq/dist/esm/classes/job.js";
import IORedis from "ioredis";
import { appEnv } from "../config/env.js";
import { prisma as defaultPrisma, type PrismaClient } from "../db.js";
import { emitPipelineEvent } from "../studio/events.js";
import { generateStill as defaultGenerateStill, animateStill as defaultAnimateStill } from "./runway.js";
import { mirrorToR2 as defaultMirrorToR2 } from "./cloudflare.js";
import { move as defaultMove, IllegalTransitionError } from "./pageState.js";
import { loadBrain as defaultLoadBrain } from "./pipeline.js";
import { safePrompt as defaultSafePrompt, stylePrompt as defaultStylePrompt } from "./promptSafety.js";
import type { MotionTier } from "@prisma/client";

const SPLIT_QUEUE_NAME = "animbook-split-pipeline";

/* --------------------------------------------------------------------- *
 * Concurrency knobs. Tuned for Runway's per-account rate limits; can be
 * overridden via env without a redeploy.
 * --------------------------------------------------------------------- */

function readConcurrency(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const STILL_CONCURRENCY = readConcurrency("STILL_PAGE_CONCURRENCY", 4);
const ANIMATE_CONCURRENCY = readConcurrency("ANIMATE_PAGE_CONCURRENCY", 2);

/* --------------------------------------------------------------------- *
 * Clip-length picker. Part A pins both tiers at 10s — Part B will move
 * STANDARD to 5s and let the Brain / author override.
 * --------------------------------------------------------------------- */

export function pickClipSeconds(_tier: MotionTier): number {
  return 10;
}

export function estimateClipCostUsd(seconds: number): number {
  // Runway gen4_turbo is 5 credits/sec at $0.01/credit.
  return seconds * 5 * 0.01;
}

/* --------------------------------------------------------------------- *
 * Connection / queue singletons.
 * --------------------------------------------------------------------- */

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

let splitQueue: Queue<SplitJobData> | null = null;
function getSplitQueue(): Queue<SplitJobData> {
  if (!splitQueue) splitQueue = new Queue<SplitJobData>(SPLIT_QUEUE_NAME, { connection: getConnection() });
  return splitQueue;
}

/* --------------------------------------------------------------------- *
 * Job data shapes.
 * --------------------------------------------------------------------- */

export type SplitJobName = "STILL_PAGE" | "ANIMATE_PAGE";

export interface SplitJobData {
  projectId: string;
  pageId: string;
  /** Bumped on every regeneration so Bull jobIds never collide. */
  stillVersion: number;
  /**
   * Optional override the author typed in the "Edit prompt and
   * regenerate" UI. Falls back to the brain-derived prompt.
   */
  promptOverride?: string;
  /** Direction note from the per-page regenerate input. */
  note?: string;
}

/* --------------------------------------------------------------------- *
 * Dependency injection seam. The live worker uses `defaultDeps()`; tests
 * construct a `SplitDeps` with fakes for `prisma`, `runway`, etc.
 * --------------------------------------------------------------------- */

export interface SplitDeps {
  prisma: PrismaClient;
  generateStill: (prompt: string, ratio: string) => Promise<string>;
  animateStill: (stillUrl: string, motion: string, seconds: number, ratio: string) => Promise<string>;
  mirrorToR2: (sourceUrl: string, key: string, fallbackContentType: string) => Promise<{ url: string }>;
  loadBrain: (bookId: string) => Promise<unknown>;
  stylePrompt: (styleId: string | null | undefined, recommendation: string | null | undefined) => string;
  safePrompt: (prompt: string, characters: { name: string; description: string }[]) => string;
  move: typeof defaultMove;
}

export function defaultDeps(): SplitDeps {
  return {
    prisma: defaultPrisma,
    generateStill: defaultGenerateStill,
    animateStill: defaultAnimateStill,
    mirrorToR2: defaultMirrorToR2 as unknown as SplitDeps["mirrorToR2"],
    loadBrain: defaultLoadBrain as unknown as SplitDeps["loadBrain"],
    stylePrompt: defaultStylePrompt as unknown as SplitDeps["stylePrompt"],
    safePrompt: defaultSafePrompt as unknown as SplitDeps["safePrompt"],
    move: defaultMove
  };
}

/* --------------------------------------------------------------------- *
 * Enqueue helpers. Caller already filtered which pages qualify; we
 * just stamp the right Bull jobId so a re-click is a no-op.
 * --------------------------------------------------------------------- */

export async function enqueueStillJob(data: SplitJobData): Promise<string> {
  const job = await getSplitQueue().add(
    "STILL_PAGE",
    data,
    {
      jobId: `still:${data.pageId}:v${data.stillVersion}`,
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 20
    } as JobsOptions
  );
  return job.id ?? "unknown";
}

export async function enqueueAnimateJob(data: SplitJobData): Promise<string> {
  const job = await getSplitQueue().add(
    "ANIMATE_PAGE",
    data,
    {
      jobId: `animate:${data.pageId}:v${data.stillVersion}`,
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 20
    } as JobsOptions
  );
  return job.id ?? "unknown";
}

/* --------------------------------------------------------------------- *
 * Page-row helper.
 * --------------------------------------------------------------------- */

type PageRow = Awaited<ReturnType<typeof defaultPrisma.page.findUnique>>;
type PageWithBook = NonNullable<PageRow>;

/* --------------------------------------------------------------------- *
 * STILL_PAGE processor.
 *
 * 1. Load page + brain
 * 2. move stillStatus -> GENERATING (compare-and-set; bail on lost race)
 * 3. Generate still via Runway gen4_image
 * 4. Mirror to R2
 * 5. Update posterUrl + stillPrompt + stillStatus -> READY
 * 6. On failure: rethrow so Bull retries (only the last attempt marks FAILED)
 * --------------------------------------------------------------------- */

export async function runStillPageJob(
  data: SplitJobData,
  attempt: number,
  maxAttempts: number,
  deps: SplitDeps = defaultDeps()
): Promise<void> {
  const page = await deps.prisma.page.findUnique({
    where: { id: data.pageId },
    include: { book: { select: { styleId: true, splitPipeline: true } } }
  });
  if (!page) throw new Error(`Page ${data.pageId} not found`);
  if (!page.book.splitPipeline) {
    // Book was un-flagged after we enqueued. Drop silently.
    return;
  }
  const brain = (await deps.loadBrain(page.bookId)) as {
    style_recommendation?: string;
    characters?: { name: string; description: string }[];
    page_manifest: {
      page_num: number;
      animation_prompt_draft?: string;
      primary_action?: string;
      emotion?: string;
      characters_present?: string[];
    }[];
  };
  const style = deps.stylePrompt(page.book.styleId, brain.style_recommendation);
  const manifest = brain.page_manifest.find((m) => m.page_num === page.pageNum);
  const characters = (brain.characters ?? []).map((c) => ({ name: c.name, description: c.description }));
  const present = characters.filter((c) => manifest?.characters_present?.includes(c.name));
  const cast = present.map((c) => `${c.description}`).join("; ");
  const baseScene = manifest?.animation_prompt_draft ?? page.animationPrompt ?? page.textExcerpt;
  const note = data.note ? ` Direction: ${data.note}` : "";
  const count = present.length === 0 ? "" : present.length === 1 ? "Exactly one character in frame. " : `Exactly ${present.length} characters in frame. `;
  const prompt = deps.safePrompt(
    data.promptOverride ?? `${style}. ${count}${baseScene}${cast ? ` Characters: ${cast}.` : ""}${note}`,
    characters
  );

  try {
    await deps.move("stillStatus", page.id, "GENERATING");
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      // Already in GENERATING (worker restarted between attempts) or someone
      // else won — let Bull retry once and then bail.
      if (attempt < maxAttempts) throw err;
      return;
    }
    throw err;
  }

  try {
    const ratio = "1280:720";
    const stillUrl = await deps.generateStill(prompt, ratio);
    const stored = await deps.mirrorToR2(
      stillUrl,
      `studio/${data.projectId}/p${page.pageNum}-${Date.now().toString(36)}.png`,
      "image/png"
    );
    await deps.prisma.page.update({
      where: { id: page.id },
      data: {
        posterUrl: stored.url,
        stillPrompt: prompt,
        stillStatus: "READY"
      }
    });
    emitPipelineEvent(data.projectId, {
      stage: "STILL_PAGE",
      status: "running",
      progress: 50,
      message: `Page ${page.pageNum} still ready`,
      payload: { pageId: page.id, status: "READY" },
      at: new Date().toISOString()
    });
  } catch (err) {
    console.warn(`[split/still] page ${page.pageNum}: ${(err as Error).message}`);
    if (attempt >= maxAttempts) {
      // Last attempt — mark FAILED. Earlier attempts just rethrow so Bull retries.
      await deps.prisma.page.update({
        where: { id: page.id },
        data: { stillStatus: "FAILED" }
      }).catch(() => {/* ignore — race with a concurrent regenerate */});
      emitPipelineEvent(data.projectId, {
        stage: "STILL_PAGE",
        status: "failed",
        progress: 0,
        message: `Page ${page.pageNum} still failed`,
        payload: { pageId: page.id, status: "FAILED" },
        at: new Date().toISOString()
      });
    }
    throw err;
  }
}

/* --------------------------------------------------------------------- *
 * ANIMATE_PAGE processor.
 *
 * 1. Load page
 * 2. HARD GATE: stillStatus must be APPROVED. If not, set clipStatus STALE
 *    and return — never spend Runway credits on a still the author hasn't
 *    signed off on.
 * 3. move clipStatus -> GENERATING
 * 4. Animate via Runway gen4_turbo (duration from pickClipSeconds)
 * 5. Mirror to R2
 * 6. Update videoUrl + clipStatus -> READY
 * 7. On failure: rethrow so Bull retries (last attempt marks FAILED)
 * --------------------------------------------------------------------- */

export async function runAnimatePageJob(
  data: SplitJobData,
  attempt: number,
  maxAttempts: number,
  deps: SplitDeps = defaultDeps()
): Promise<void> {
  const page = await deps.prisma.page.findUnique({
    where: { id: data.pageId },
    include: { book: { select: { styleId: true, splitPipeline: true } } }
  });
  if (!page) throw new Error(`Page ${data.pageId} not found`);
  if (!page.book.splitPipeline) return;

  // Hard gate from the brief — don't ever spend Runway credits on a still
  // the author hasn't approved. Set the clip to STALE so the UI makes it
  // obvious the pairing is broken, and exit without doing any work.
  if (page.stillStatus !== "APPROVED") {
    await deps.prisma.page.update({
      where: { id: page.id },
      data: { clipStatus: "STALE" }
    }).catch(() => {/* concurrent regenerate already moved us */});
    emitPipelineEvent(data.projectId, {
      stage: "ANIMATE_PAGE",
      status: "failed",
      progress: 0,
      message: `Page ${page.pageNum} clip marked stale — still not approved`,
      payload: { pageId: page.id, status: "STALE" },
      at: new Date().toISOString()
    });
    return;
  }
  if (!page.posterUrl) {
    // Approved still but no URL — shouldn't happen, but guard so we never
    // send Runway an empty promptImage.
    await deps.prisma.page.update({
      where: { id: page.id },
      data: { clipStatus: "STALE" }
    }).catch(() => {});
    return;
  }

  try {
    await deps.move("clipStatus", page.id, "GENERATING");
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      if (attempt < maxAttempts) throw err;
      return;
    }
    throw err;
  }

  try {
    const brain = (await deps.loadBrain(page.bookId)) as {
      characters?: { name: string; description: string }[];
      page_manifest: {
        page_num: number;
        primary_action?: string;
        emotion?: string;
        characters_present?: string[];
      }[];
    };
    const characters = (brain.characters ?? []).map((c) => ({ name: c.name, description: c.description }));
    const manifest = brain.page_manifest.find((m) => m.page_num === page.pageNum);
    const present = characters.filter((c) => manifest?.characters_present?.includes(c.name));
    const count = present.length === 0 ? "" : present.length === 1 ? "Exactly one character in frame. " : `Exactly ${present.length} characters in frame. `;
    const motion = deps.safePrompt(
      `${count}Small, natural movement: ${manifest?.primary_action ?? "gentle ambient motion"}. ` +
        `Mood: ${manifest?.emotion ?? page.emotionalRegister ?? "calm"}. Slow camera push-in. ` +
        `No new people or animals enter the frame.${data.note ? ` Direction: ${data.note}` : ""}`,
      characters
    );
    const duration = pickClipSeconds(page.motionTier);
    const ratio = "1280:720";
    const clipUrl = await deps.animateStill(page.posterUrl, motion, duration, ratio);
    const stored = await deps.mirrorToR2(
      clipUrl,
      `studio/${data.projectId}/p${page.pageNum}-${Date.now().toString(36)}.mp4`,
      "video/mp4"
    );
    await deps.prisma.page.update({
      where: { id: page.id },
      data: {
        videoUrl: stored.url,
        clipStatus: "READY",
        qualityScore: 0.85
      }
    });
    emitPipelineEvent(data.projectId, {
      stage: "ANIMATE_PAGE",
      status: "running",
      progress: 80,
      message: `Page ${page.pageNum} clip ready`,
      payload: { pageId: page.id, status: "READY" },
      at: new Date().toISOString()
    });
  } catch (err) {
    console.warn(`[split/animate] page ${page.pageNum}: ${(err as Error).message}`);
    if (attempt >= maxAttempts) {
      await deps.prisma.page.update({
        where: { id: page.id },
        data: { clipStatus: "FAILED" }
      }).catch(() => {});
      emitPipelineEvent(data.projectId, {
        stage: "ANIMATE_PAGE",
        status: "failed",
        progress: 0,
        message: `Page ${page.pageNum} clip failed`,
        payload: { pageId: page.id, status: "FAILED" },
        at: new Date().toISOString()
      });
    }
    throw err;
  }
}

/* --------------------------------------------------------------------- *
 * Worker startup. Mirrors the legacy pipeline worker pattern: start the
 * workers when the API boots, except in `test`.
 * --------------------------------------------------------------------- */

let stillWorker: Worker<SplitJobData> | null = null;
let animateWorker: Worker<SplitJobData> | null = null;

export function startSplitWorkers(): { still: Worker<SplitJobData> | null; animate: Worker<SplitJobData> | null } {
  if (appEnv.NODE_ENV === "test") return { still: null, animate: null };
  if (!stillWorker) {
    const stillOpts: WorkerOptions = { connection: getConnection(), concurrency: STILL_CONCURRENCY };
    stillWorker = new Worker<SplitJobData>(
      SPLIT_QUEUE_NAME,
      async (job: Job<SplitJobData>) => runStillPageJob(job.data, job.attemptsMade + 1, job.opts.attempts ?? 1),
      stillOpts
    );
  }
  if (!animateWorker) {
    const animateOpts: WorkerOptions = { connection: getConnection(), concurrency: ANIMATE_CONCURRENCY };
    animateWorker = new Worker<SplitJobData>(
      SPLIT_QUEUE_NAME,
      async (job: Job<SplitJobData>) => runAnimatePageJob(job.data, job.attemptsMade + 1, job.opts.attempts ?? 1),
      animateOpts
    );
  }
  return { still: stillWorker, animate: animateWorker };
}

/**
 * Process a single page synchronously in the current process. Used by the
 * API routes when running unit tests (no Redis / Bull worker available)
 * and for emergency "process this now" admin operations.
 */
export async function processStillPageInline(data: SplitJobData): Promise<void> {
  return runStillPageJob(data, 1, 1);
}

export async function processAnimatePageInline(data: SplitJobData): Promise<void> {
  return runAnimatePageJob(data, 1, 1);
}

export async function shutdownSplitPipeline(): Promise<void> {
  await Promise.all([stillWorker?.close(), animateWorker?.close()]);
  stillWorker = null;
  animateWorker = null;
  if (splitQueue) {
    await splitQueue.close();
    splitQueue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}