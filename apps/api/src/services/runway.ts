/**
 * Runway developer API client (https://docs.dev.runwayml.com).
 *
 * A page clip is made in two steps, which is cheaper than text-to-video and
 * gives every page a poster frame for free:
 *   1. text_to_image  (gen4_image, 720p)      → still / poster   ~5 credits
 *   2. image_to_video (gen4_turbo, 5s default) → animated clip    ~5 credits/s
 *
 * Runway output URLs expire after a day or two, so both files are mirrored
 * into Cloudflare R2 before the URLs are stored.
 *
 * generateClip() keeps its old contract for the Studio pipeline: on failure it
 * returns a stub (unless `strict` is set, which the seed script uses).
 */
import { appEnv, isFeatureEnabled } from "../config/env.js";
import { mirrorToR2 } from "./cloudflare.js";

const API_BASE = "https://api.dev.runwayml.com/v1";
const API_VERSION = "2024-11-06";
const STUB_BASE = "https://placehold.co/1280x720/080C14/C49A1C/png?text=AnimBook";

export type RunwayRatio = "1280:720" | "720:1280" | "960:960";

/** A reference image Runway should copy (face, outfit, style). Mention it in the prompt as @tag. */
export interface ReferenceImage {
  uri: string;
  /** 3–16 letters/digits/underscores, starting with a letter. */
  tag: string;
}

export interface RunwayJobInput {
  projectId: string;
  pageNum: number;
  /** What the still should show. */
  prompt: string;
  /** What moves, and how. Defaults to `prompt`. */
  motionPrompt?: string;
  negativePrompt?: string;
  styleId?: string;
  durationSeconds?: number;
  ratio?: RunwayRatio;
  /** R2 key prefix for the stored files. Defaults to `runway/<projectId>`. */
  storagePrefix?: string;
  /** Throw instead of returning a stub. */
  strict?: boolean;
  /** Up to 3 reference images for the still (character portraits). */
  references?: ReferenceImage[];
}

export interface RunwayJobResult {
  videoUrl: string;
  posterUrl: string;
  durationSeconds: number;
  source: "runway" | "stub";
  creditsEstimate: number;
}

export class RunwayError extends Error {
  constructor(message: string, readonly retryable = false, readonly moderation = false) {
    super(message);
  }
}

interface RunwayTask {
  id: string;
  status: "PENDING" | "THROTTLED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  output?: string[];
  failure?: string;
  failureCode?: string;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${appEnv.RUNWAY_API_KEY}`,
    "Content-Type": "application/json",
    "X-Runway-Version": API_VERSION
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function createTask(path: string, body: unknown): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    } catch (err) {
      // Connection failed before a response — the task was not accepted.
      console.warn(`[runway] ${path} network error (${(err as Error).message}), retrying`);
      await sleep(Math.min(60_000, 5_000 * 2 ** attempt));
      continue;
    }
    if (res.ok) return ((await res.json()) as { id: string }).id;
    const detail = await res.text().catch(() => "");
    if (res.status === 429 || res.status >= 500) {
      await sleep(Math.min(60_000, 5_000 * 2 ** attempt));
      continue;
    }
    throw new RunwayError(`Runway ${path} → ${res.status}: ${detail.slice(0, 300)}`);
  }
  throw new RunwayError(`Runway ${path} kept failing (rate limited / server error)`, true);
}

async function waitForTask(id: string, timeoutMs = 15 * 60_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(5_000); // Runway asks for ≥5s between polls
    let task: RunwayTask;
    try {
      const res = await fetch(`${API_BASE}/tasks/${id}`, { headers: headers() });
      if (!res.ok) continue;
      task = (await res.json()) as RunwayTask;
    } catch {
      // Network blip while polling — the task keeps running on Runway's side.
      continue;
    }
    if (task.status === "SUCCEEDED") {
      const url = task.output?.[0];
      if (!url) throw new RunwayError(`Runway task ${id} succeeded with no output`);
      return url;
    }
    if (task.status === "FAILED" || task.status === "CANCELLED") {
      const code = task.failureCode ?? "";
      throw new RunwayError(
        `Runway task ${id} ${task.status}${code ? ` [${code}]` : ""}: ${task.failure ?? "unknown"}`,
        code.startsWith("INTERNAL"),
        code.startsWith("SAFETY")
      );
    }
  }
  throw new RunwayError(`Runway task ${id} timed out`, true);
}

/**
 * Runway fetches reference images itself; sending them inline (data URIs)
 * avoids failures when it can't reach or read our media domain.
 */
async function inlineImage(uri: string): Promise<string> {
  if (!/^https?:\/\//i.test(uri)) return uri;
  const res = await fetch(uri);
  if (!res.ok) throw new RunwayError(`Could not load reference image (${res.status}) ${uri.slice(0, 80)}`);
  const type = res.headers.get("content-type")?.split(";")[0] || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${type};base64,${buf.toString("base64")}`;
}

/** Runway sometimes fails a task with an internal error; those are worth one or two more tries. */
async function withTaskRetry(label: string, run: () => Promise<string>, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await run();
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof RunwayError && err.retryable;
      if (!retryable || i === attempts - 1) throw err;
      console.warn(`[runway] ${label} failed (${(err as Error).message}), retry ${i + 1}/${attempts - 1}`);
      await sleep(10_000);
    }
  }
  throw lastErr;
}

export async function generateStill(prompt: string, ratio: string = "1280:720", references: ReferenceImage[] = []): Promise<string> {
  const body: Record<string, unknown> = { model: "gen4_image", promptText: prompt.slice(0, 1000), ratio };
  if (references.length) {
    body.referenceImages = await Promise.all(
      references.slice(0, 3).map(async (r) => ({ uri: await inlineImage(r.uri), tag: r.tag }))
    );
  }
  return withTaskRetry("image", async () => waitForTask(await createTask("/text_to_image", body)));
}

export async function animateStill(imageUrl: string, motionPrompt: string, durationSeconds = 5, ratio: RunwayRatio = "1280:720"): Promise<string> {
  const body = {
    model: "gen4_turbo",
    promptImage: imageUrl,
    promptText: motionPrompt.slice(0, 1000),
    ratio,
    duration: durationSeconds
  };
  return withTaskRetry("video", async () => waitForTask(await createTask("/image_to_video", body)));
}

export function estimateClipCredits(durationSeconds = 5): number {
  return 5 + 5 * durationSeconds;
}

export async function generateClip(input: RunwayJobInput): Promise<RunwayJobResult> {
  const duration = input.durationSeconds ?? 5;
  const ratio = input.ratio ?? "1280:720";
  if (!isFeatureEnabled("RUNWAY")) {
    if (input.strict) throw new RunwayError("RUNWAY_API_KEY not configured");
    return stubResult(duration);
  }
  try {
    const stillPrompt = input.negativePrompt ? `${input.prompt} Avoid: ${input.negativePrompt}.` : input.prompt;
    const stillUrl = await generateStill(stillPrompt, ratio, input.references ?? []);
    const clipUrl = await animateStill(stillUrl, input.motionPrompt ?? input.prompt, duration, ratio);

    const prefix = (input.storagePrefix ?? `runway/${input.projectId}`).replace(/\/+$/, "");
    const stamp = Date.now().toString(36);
    const poster = await mirrorToR2(stillUrl, `${prefix}/p${input.pageNum}-${stamp}.png`, "image/png");
    const video = await mirrorToR2(clipUrl, `${prefix}/p${input.pageNum}-${stamp}.mp4`, "video/mp4");
    if (video.source !== "r2") {
      console.warn("[runway] R2 not configured — storing Runway URLs, which expire within ~48h");
    }
    return {
      videoUrl: video.source === "r2" ? video.url : clipUrl,
      posterUrl: poster.source === "r2" ? poster.url : stillUrl,
      durationSeconds: duration,
      source: "runway",
      creditsEstimate: estimateClipCredits(duration)
    };
  } catch (err) {
    if (input.strict) throw err;
    console.warn(`[runway] ${(err as Error).message}, returning stub`);
    return stubResult(duration);
  }
}

function stubResult(durationSeconds: number): RunwayJobResult {
  return { videoUrl: STUB_BASE, posterUrl: STUB_BASE, durationSeconds, source: "stub", creditsEstimate: 0 };
}

export const runwayStatus = { live: isFeatureEnabled("RUNWAY") };
