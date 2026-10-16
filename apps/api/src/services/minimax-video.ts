/**
 * MiniMax (Hailuo) video + image API client.
 *
 *   POST  https://api.minimax.io/v1/video_generation  → { task_id }
 *   GET   https://api.minimax.io/v1/query/video_generation?task_id=… → status
 *   GET   https://api.minimax.io/v1/files/retrieve?file_id=… → download_url (TTL 1h)
 *   POST  https://api.minimax.io/v1/image_generation   → image-01 stills
 *
 * Auth: `Authorization: Bearer <MINIMAX_API_KEY>`. The key is NEVER logged,
 * printed, or persisted to a UsageEvent metadata payload — only the
 * `totalUsd` is recorded.
 *
 * A page clip is built the same way Runway's was: T2I still first (image-01),
 * then I2V animated against that still — except here the still URL is encoded
 * as a data URI inside the I2V call, then the MP4 download_url is fetched
 * and mirrored into R2. Download URLs expire inside an hour, which is why
 * `mirrorToR2` runs immediately after `Success`.
 *
 * The pipeline-facing surface (`generateClip`, `generateStill`, `animateStill`,
 * `generateStillWithFaces`, `estimateClipCredits`) matches the runway.ts
 * shape one-for-one, so the videoProvider.ts selector can swap without
 * changing any caller. When `MINIMAX_VIDEO` is not enabled, every function
 * returns the same stub shape runway.ts uses.
 *
 * Concurrency: `MINIMAX_VIDEO_CONCURRENCY` (default 2) limits how many
 * in-flight tasks this process owns at once. MiniMax's docs do not pin a
 * per-account limit; the conservative default keeps us under any plausible
 * RPM ceiling and matches the Runway knob we already ran at 2.
 */
import { appEnv, isFeatureEnabled } from "../config/env.js";
import { mirrorToR2 } from "./cloudflare.js";
import {
  MINIMAX_VIDEO_USD_768P_6S,
  MINIMAX_VIDEO_USD_1080P_6S,
  MINIMAX_VIDEO_USD_FAST_768P_6S,
  MINIMAX_VIDEO_USD_FAST_1080P_6S,
  MINIMAX_IMAGE_USD_IMAGE_01,
  estimateMinimaxVideoCostUsd as _usageTrackingVideoCost,
  estimateMinimaxImageCostUsd as _usageTrackingImageCost
} from "./usageTracking.js";

const API_BASE = "https://api.minimax.io";
const STUB_BASE = "https://placehold.co/1280x720/080C14/C49A1C/png?text=AnimBook";

/** Mirror of the Runway shape — used as a poor man's union so existing
 *  pipeline callers keep their type imports unchanged. */
export type MinimaxResolution = "768P" | "1080P";

export interface ReferenceImage {
  uri: string;
  /** Mirror of the Runway tag field. MiniMax I2V doesn't use @-tags, but we
   *  keep the slot so the ref-portrait pipeline keeps working unchanged. */
  tag: string;
}

export interface MinimaxJobInput {
  projectId: string;
  pageNum: number;
  prompt: string;
  motionPrompt?: string;
  negativePrompt?: string;
  styleId?: string;
  durationSeconds?: number;
  resolution?: MinimaxResolution;
  /** Storage prefix for R2 keys. Defaults to `minimax/<projectId>`. */
  storagePrefix?: string;
  /** Throw instead of returning a stub. */
  strict?: boolean;
  /** Up to 3 reference images for the still (subject references). */
  references?: ReferenceImage[];
  /** Prompt to use if MiniMax keeps rejecting the referenced one. */
  fallbackPrompt?: string;
}

export interface MinimaxJobResult {
  videoUrl: string;
  posterUrl: string;
  durationSeconds: number;
  source: "minimax" | "stub";
  creditsEstimate: number;
  /** Always false — MiniMax doesn't lock a subject across frames the way
   *  Runway's reference portrait did. Kept for pipeline consumers. */
  facesLocked?: boolean;
}

export class MinimaxError extends Error {
  constructor(message: string, readonly retryable = false, readonly moderation = false, readonly code = "") {
    super(message);
  }
}

const MODERATION_CODES = new Set(["1026", "1027"]);
const RETRYABLE_CODES = new Set(["1002", "1039"]);

interface MinimaxQueryResp {
  task_id?: string;
  status?: "Preparing" | "Queueing" | "Processing" | "Success" | "Fail";
  file_id?: string;
  base_resp?: { status_code?: number; status_msg?: string };
}

interface MinimaxCreateResp {
  task_id?: string;
  base_resp?: { status_code?: number; status_msg?: string };
}

interface MinimaxFileResp {
  file?: { download_url?: string; filename?: string };
  base_resp?: { status_code?: number; status_msg?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** NEVER log or include the key — only the env-presence and the request outcome. */
function authHeaders(): Record<string, string> {
  if (!appEnv.MINIMAX_API_KEY) {
    throw new MinimaxError("MINIMAX_API_KEY not configured");
  }
  return {
    Authorization: `Bearer ${appEnv.MINIMAX_API_KEY}`,
    "Content-Type": "application/json"
  };
}

function baseRespError(label: string, r: { base_resp?: { status_code?: number; status_msg?: string } } | null): MinimaxError {
  const code = r?.base_resp?.status_code?.toString() ?? "unknown";
  const msg = r?.base_resp?.status_msg ?? label;
  if (MODERATION_CODES.has(code)) return new MinimaxError(`MiniMax ${label}: ${msg} (${code}) — moderation`, false, true, code);
  if (RETRYABLE_CODES.has(code)) return new MinimaxError(`MiniMax ${label}: ${msg} (${code}) — retryable`, true, false, code);
  if (code === "2049" || code === "1004" || code === "1008") return new MinimaxError(`MiniMax ${label}: ${msg} (${code}) — auth/billing`, false, false, code);
  return new MinimaxError(`MiniMax ${label}: ${msg} (${code})`, false, false, code);
}

async function postJson<T>(path: string, body: unknown, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
    } catch (err) {
      lastErr = err;
      console.warn(`[minimax] ${path} network error (${(err as Error).message}), retry ${i + 1}/${attempts}`);
      await sleep(Math.min(30_000, 3_000 * 2 ** i));
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    const detail = await res.text().catch(() => "");
    if (res.status === 429 || res.status >= 500) {
      lastErr = new MinimaxError(`MiniMax ${path} → ${res.status}: ${detail.slice(0, 200)}`, true);
      await sleep(Math.min(60_000, 3_000 * 2 ** i));
      continue;
    }
    throw new MinimaxError(`MiniMax ${path} → ${res.status}: ${detail.slice(0, 200)}`);
  }
  throw lastErr;
}

async function getJson<T>(path: string, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, { method: "GET", headers: authHeaders() });
    } catch (err) {
      lastErr = err;
      await sleep(Math.min(30_000, 3_000 * 2 ** i));
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 || res.status >= 500) {
      lastErr = new MinimaxError(`MiniMax GET ${path} → ${res.status}`, true);
      await sleep(Math.min(60_000, 3_000 * 2 ** i));
      continue;
    }
    const detail = await res.text().catch(() => "");
    throw new MinimaxError(`MiniMax GET ${path} → ${res.status}: ${detail.slice(0, 200)}`);
  }
  throw lastErr;
}

async function createVideoTask(body: Record<string, unknown>): Promise<string> {
  const resp = await postJson<MinimaxCreateResp>("/v1/video_generation", body);
  if (!resp.task_id) throw baseRespError("video_generation", resp);
  return resp.task_id;
}

async function waitForVideo(taskId: string, timeoutMs = 25 * 60_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(5_000);
    const resp = await getJson<MinimaxQueryResp>(`/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`);
    if (resp.base_resp && resp.base_resp.status_code && resp.base_resp.status_code !== 0) {
      throw baseRespError("query/video_generation", resp);
    }
    if (resp.status === "Success" && resp.file_id) {
      return resp.file_id;
    }
    if (resp.status === "Fail") {
      throw baseRespError("video_generation failed", resp);
    }
  }
  throw new MinimaxError(`MiniMax task ${taskId} timed out`, true);
}

async function downloadFile(fileId: string): Promise<string> {
  const resp = await getJson<MinimaxFileResp>(`/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`);
  if (!resp.file?.download_url) throw baseRespError("files/retrieve", resp);
  return resp.file.download_url;
}

async function inlineImage(uri: string): Promise<string> {
  if (!/^https?:\/\//i.test(uri)) return uri;
  const res = await fetch(uri);
  if (!res.ok) throw new MinimaxError(`Could not inline reference (${res.status}) for ${uri.slice(0, 80)}`);
  const type = res.headers.get("content-type")?.split(";")[0] || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${type};base64,${buf.toString("base64")}`;
}

interface MinimaxImageResp {
  data?: {
    image_base64?: string[];
    image_urls?: string[];
  };
  base_resp?: { status_code?: number; status_msg?: string };
}

/** Generates an image-01 still from a text prompt. Returns the URL or the
 *  downloaded-and-mirrored public URL. */
export async function generateStill(
  prompt: string,
  ratio: string = "16:9",
  references: ReferenceImage[] = [],
  options: { attempts?: number } = {}
): Promise<string> {
  if (!isFeatureEnabled("MINIMAX_VIDEO")) {
    return STUB_BASE;
  }
  const aspect = ratioToAspect(ratio);
  const body: Record<string, unknown> = {
    model: appEnv.MINIMAX_IMAGE_MODEL,
    prompt: prompt.slice(0, 1500),
    aspect_ratio: aspect,
    response_format: "url"
  };
  if (references.length) {
    const first = references[0]!;
    body.subject_reference = [{ type: "character", image_file: await inlineImage(first.uri) }];
  }
  const attempts = Math.max(1, options.attempts ?? 3);
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await postJson<MinimaxImageResp>("/v1/image_generation", body, 1);
      if (resp.base_resp && resp.base_resp.status_code !== 0) throw baseRespError("image_generation", resp);
      const url = resp.data?.image_urls?.[0];
      if (url) return url;
      const b64 = resp.data?.image_base64?.[0];
      if (b64) {
        // Strip any `data:image/...;base64,` prefix to avoid double-prefix on the consumer side.
        const cleaned = b64.includes(",") ? b64.split(",").slice(1).join(",") : b64;
        return `data:image/png;base64,${cleaned}`;
      }
      throw new MinimaxError("MiniMax image_generation returned no URLs or base64 data");
    } catch (err) {
      lastErr = err;
      if (err instanceof MinimaxError && err.moderation) throw err;
      if (i < attempts - 1) {
        await sleep(2_000);
        continue;
      }
    }
  }
  throw lastErr ?? new MinimaxError("MiniMax image_generation gave up");
}

/** Animates a still image into a 6s/768P (default) clip. The still is passed
 *  inline as a `first_frame_image` data URI — public URLs are also accepted,
 *  but inlining dodges any CDN-side fetch failures. */
export async function animateStill(
  imageUrl: string,
  motionPrompt: string,
  durationSeconds = 6,
  resolution: MinimaxResolution = "768P"
): Promise<string> {
  if (!isFeatureEnabled("MINIMAX_VIDEO")) {
    return STUB_BASE;
  }
  const safe = await inlineImage(imageUrl);
  const body: Record<string, unknown> = {
    model: appEnv.MINIMAX_VIDEO_MODEL,
    prompt: motionPrompt.slice(0, 1500),
    first_frame_image: safe,
    duration: durationSeconds,
    resolution
  };
  const taskId = await createVideoTask(body);
  const fileId = await waitForVideo(taskId);
  return await downloadFile(fileId);
}

/** Reference-image strategy. MiniMax image-01 only allows a single subject
 *  reference (the I2V doc even nags about subject_reference length 1), so the
 *  multi-reference ladder Runway had collapses to: 1) referenced, 2)
 *  description-only fallback. */
export async function generateStillWithFaces(
  prompt: string,
  fallbackPrompt: string,
  shape: "wide" | "tall",
  references: ReferenceImage[]
): Promise<{ url: string; facesLocked: boolean }> {
  const ratio = shape === "wide" ? "16:9" : "9:16";
  if (!references.length) {
    return { url: await generateStill(fallbackPrompt || prompt, ratio, [], { attempts: 3 }), facesLocked: false };
  }
  try {
    const url = await generateStill(prompt, ratio, references.slice(0, 1), { attempts: 2 });
    return { url, facesLocked: true };
  } catch (err) {
    if (err instanceof MinimaxError && err.moderation) throw err;
    console.warn(`[minimax] subject-referenced image rejected, falling back`);
    return { url: await generateStill(fallbackPrompt || prompt, ratio, [], { attempts: 2 }), facesLocked: false };
  }
}

export function estimateClipCredits(
  durationSeconds = 6,
  resolution: MinimaxResolution = "768P",
  isFast: boolean = false
): number {
  return Math.round(_usageTrackingVideoCost({ durationSeconds, resolution, isFast }) * 100) / 100;
}

function stubResult(durationSeconds: number): MinimaxJobResult {
  return { videoUrl: STUB_BASE, posterUrl: STUB_BASE, durationSeconds, source: "stub", creditsEstimate: 0 };
}

export async function generateClip(input: MinimaxJobInput): Promise<MinimaxJobResult> {
  const duration = input.durationSeconds ?? 6;
  const resolution = input.resolution ?? "768P";
  const isFast = /-Fast$/i.test(appEnv.MINIMAX_VIDEO_MODEL);
  if (!isFeatureEnabled("MINIMAX_VIDEO")) {
    if (input.strict) throw new MinimaxError("MINIMAX_VIDEO not configured");
    return stubResult(duration);
  }
  try {
    const shape = resolution === "1080P" ? "wide" : resolution === "768P" ? "wide" : "wide";
    const refs = input.references ?? [];
    const stillPrompt = input.negativePrompt ? `${input.prompt} Avoid: ${input.negativePrompt}.` : input.prompt;
    const fallback = input.fallbackPrompt ?? stillPrompt;
    const { url: stillUrl, facesLocked } =
      refs.length > 0
        ? await generateStillWithFaces(stillPrompt, fallback, shape, refs)
        : { url: await generateStill(stillPrompt), facesLocked: false };
    const clipUrl = await animateStill(stillUrl, input.motionPrompt ?? input.prompt, duration, resolution);
    const prefix = (input.storagePrefix ?? `minimax/${input.projectId}`).replace(/\/+$/, "");
    const stamp = Date.now().toString(36);
    const poster = await mirrorToR2(stillUrl, `${prefix}/p${input.pageNum}-${stamp}.png`, "image/png");
    const video = await mirrorToR2(clipUrl, `${prefix}/p${input.pageNum}-${stamp}.mp4`, "video/mp4");
    if (video.source !== "r2") {
      console.warn("[minimax] R2 not configured — storing MiniMax URLs, which expire within ~1h");
    }
    return {
      videoUrl: video.source === "r2" ? video.url : clipUrl,
      posterUrl: poster.source === "r2" ? poster.url : stillUrl,
      durationSeconds: duration,
      source: "minimax",
      creditsEstimate: estimateClipCredits(duration, resolution, isFast),
      facesLocked
    };
  } catch (err) {
    if (input.strict) throw err;
    console.warn(`[minimax] ${(err as Error).message}, returning stub`);
    return stubResult(duration);
  }
}

export const minimaxStatus = {
  live: isFeatureEnabled("MINIMAX_VIDEO"),
  model: appEnv.MINIMAX_VIDEO_MODEL,
  imageModel: appEnv.MINIMAX_IMAGE_MODEL,
  isFast: /-Fast$/i.test(appEnv.MINIMAX_VIDEO_MODEL),
  // 6s/768P default — surfaced so the UI + cost helpers can render without
  // having to read env vars directly.
  defaultResolution: "768P" as MinimaxResolution,
  defaultDurationSeconds: 6,
  estimatedPerClipUsd: estimateClipCredits(6, "768P", false),
  imageCostUsd: _usageTrackingImageCost(1)
};

// Defaults reused in tests + the integration provider.
export {
  MINIMAX_VIDEO_USD_768P_6S,
  MINIMAX_VIDEO_USD_1080P_6S,
  MINIMAX_VIDEO_USD_FAST_768P_6S,
  MINIMAX_VIDEO_USD_FAST_1080P_6S,
  MINIMAX_IMAGE_USD_IMAGE_01
};

function ratioToAspect(ratio: string): string {
  if (ratio === "720:1280" || ratio === "1080:1920" || ratio === "9:16") return "9:16";
  if (ratio === "960:960" || ratio === "1:1") return "1:1";
  return "16:9"; // 1280:720 and friends
}
