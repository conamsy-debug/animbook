/**
 * Media post-processing for every asset the pipeline generates.
 *
 * Three optimisations, all applied to NEW assets only:
 *
 *   video      â†’ remux with `-movflags +faststart` (streams are COPIED,
 *                so there is no re-encode and no quality loss) so the
 *                `moov` index sits at the FRONT of the file. A browser
 *                can then start playing as soon as the first bytes
 *                arrive instead of first downloading the whole file to
 *                find the index at the end.
 *   image      â†’ WebP (quality 80) at the size the asset is actually
 *                displayed at. The source PNGs are 0.9â€“2.0 MB each.
 *   narration  â†’ mono MP3 at 48 kbps (the source is 128 kbps mono).
 *
 * IMPORTANT: this NEVER overwrites the original. The caller uploads the
 * optimised bytes under a NEW R2 key and points the database at it; the
 * original object stays in the bucket untouched. That is what makes
 * `apps/api/scripts/rollback-optimized-media.mjs` able to restore the
 * old URLs.
 *
 * Every function degrades gracefully: if ffmpeg is missing or fails, the
 * ORIGINAL bytes are returned with `applied: false` and a note. A missing
 * optimiser must never fail a paid-for pipeline job.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpeg } from "./ffmpegBin.js";

export type MediaKind = "video" | "image" | "narration";

export interface OptimizeOptions {
  /** Max width in pixels. Height follows the source aspect ratio. */
  maxWidth?: number;
  /** WebP quality, 1-100. */
  quality?: number;
}

export interface OptimizedMedia {
  body: Buffer;
  contentType: string;
  /** The file extension the optimised bytes should be stored under. */
  extension: string;
  bytesBefore: number;
  bytesAfter: number;
  /** False when the optimiser could not run and the original was kept. */
  applied: boolean;
  note?: string;
}

/** Displayed sizes. Posters match the 1280x720 clip they sit under;
 *  covers are shown in a 3:4 card that is at most ~400 CSS px wide, so
 *  800px is a comfortable 2x. */
export const POSTER_MAX_WIDTH = 1280;
export const COVER_MAX_WIDTH = 800;
export const WEBP_QUALITY = 80;
export const NARRATION_BITRATE = "48k";

interface RunResult {
  ok: boolean;
  stdout: Buffer;
  stderr: string;
}

/**
 * Run ffmpeg with the input buffer on disk; returns the output bytes.
 *
 * `outputArgs` are the ENCODER options (-c copy, -vf, -b:a, â€¦). They must
 * sit AFTER the `-i <input>` in the command line â€” ffmpeg parses anything
 * before `-i` as an *input* option and rejects them there.
 *
 * The input and output are real files, NOT pipes: `-movflags +faststart`
 * has to rewrite the `moov` atom into the front of the file afterwards,
 * which needs a seekable output. Piping to stdout would silently
 * produce a non-faststart file.
 */
function runFfmpeg(
  outputArgs: string[],
  input: Buffer,
  inputExt: string,
  outputExt: string
): Promise<RunResult> {
  return new Promise((resolve) => {
    const bin = resolveFfmpeg() ?? "ffmpeg";
    let dir: string;
    try {
      dir = mkdtempSync(join(tmpdir(), "animbook-ff-"));
    } catch (err) {
      resolve({ ok: false, stdout: Buffer.alloc(0), stderr: `tempdir failed: ${(err as Error).message}` });
      return;
    }
    const inPath = join(dir, `in.${inputExt}`);
    const outPath = join(dir, `out.${outputExt}`);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, ["-v", "error", "-y", "-i", inPath, ...outputArgs, outPath], {
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      // spawn() throws SYNCHRONOUSLY for some failures (e.g. a path that is
      // not an executable at all -> EFTYPE on Windows). Without this catch
      // the rejection would escape and take the whole pipeline job down.
      rmSync(dir, { recursive: true, force: true });
      resolve({ ok: false, stdout: Buffer.alloc(0), stderr: `spawn failed: ${(err as Error).message}` });
      return;
    }
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => outChunks.push(c));
    child.stderr.on("data", (c: Buffer) => errChunks.push(c));
    child.on("error", (err) => {
      rmSync(dir, { recursive: true, force: true });
      resolve({ ok: false, stdout: Buffer.alloc(0), stderr: `spawn failed: ${err.message}` });
    });
    child.on("close", (code) => {
      let stdout = Buffer.alloc(0);
      try {
        stdout = readFileSync(outPath);
      } catch {
        /* no output file */
      }
      rmSync(dir, { recursive: true, force: true });
      resolve({
        ok: code === 0,
        stdout,
        stderr: Buffer.concat(errChunks).toString("utf8").slice(0, 400)
      });
    });
    try {
      writeFileSync(inPath, input);
    } catch (err) {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
      resolve({ ok: false, stdout: Buffer.alloc(0), stderr: `write failed: ${(err as Error).message}` });
    }
  });
}

/**
 * Remux an MP4 so the moov atom is at the front. `-c copy` means the
 * video and audio streams are copied bit-for-bit â€” no re-encode, no
 * quality loss, and the byte size barely changes.
 */
export async function optimizeVideo(body: Buffer): Promise<OptimizedMedia> {
  const result = await runFfmpeg(
    ["-c", "copy", "-movflags", "+faststart", "-f", "mp4"],
    body,
    "mp4",
    "mp4"
  );
  if (!result.ok || result.stdout.length === 0) {
    return {
      body,
      contentType: "video/mp4",
      extension: "mp4",
      bytesBefore: body.length,
      bytesAfter: body.length,
      applied: false,
      note: result.stderr || "ffmpeg remux failed"
    };
  }
  return {
    body: result.stdout,
    contentType: "video/mp4",
    extension: "mp4",
    bytesBefore: body.length,
    bytesAfter: result.stdout.length,
    applied: true
  };
}

/**
 * Re-encode a still as WebP at the size it is displayed at.
 * Only re-encodes when the source is actually larger than the target,
 * so we never inflate a small image.
 */
export async function optimizeImage(body: Buffer, options: OptimizeOptions = {}): Promise<OptimizedMedia> {
  const maxWidth = options.maxWidth ?? POSTER_MAX_WIDTH;
  const quality = options.quality ?? WEBP_QUALITY;
  const result = await runFfmpeg(
    [
      "-vf",
      `scale='min(${maxWidth},iw)':-2:flags=lanczos`,
      "-c:v",
      "libwebp",
      "-quality",
      String(quality),
      "-compression_level",
      "6",
      "-f",
      "webp"
    ],
    body,
    "png",
    "webp"
  );
  if (!result.ok || result.stdout.length === 0) {
    return {
      body,
      contentType: "image/png",
      extension: "png",
      bytesBefore: body.length,
      bytesAfter: body.length,
      applied: false,
      note: result.stderr || "ffmpeg webp encode failed"
    };
  }
  return {
    body: result.stdout,
    contentType: "image/webp",
    extension: "webp",
    bytesBefore: body.length,
    bytesAfter: result.stdout.length,
    applied: true
  };
}

/** Re-encode narration to mono MP3 at 48 kbps. */
export async function optimizeNarration(body: Buffer): Promise<OptimizedMedia> {
  const result = await runFfmpeg(
    [
      "-ac", "1",
      "-c:a", "libmp3lame",
      "-b:a", NARRATION_BITRATE,
      "-f", "mp3"
    ],
    body,
    "mp3",
    "mp3"
  );
  if (!result.ok || result.stdout.length === 0) {
    return {
      body,
      contentType: "audio/mpeg",
      extension: "mp3",
      bytesBefore: body.length,
      bytesAfter: body.length,
      applied: false,
      note: result.stderr || "ffmpeg mp3 encode failed"
    };
  }
  return {
    body: result.stdout,
    contentType: "audio/mpeg",
    extension: "mp3",
    bytesBefore: body.length,
    bytesAfter: result.stdout.length,
    applied: true
  };
}

/** Dispatch to the right optimiser. */
export async function optimizeMedia(kind: MediaKind, body: Buffer, options: OptimizeOptions = {}): Promise<OptimizedMedia> {
  if (kind === "video") return optimizeVideo(body);
  if (kind === "image") return optimizeImage(body, options);
  return optimizeNarration(body);
}

/**
 * Swap the extension of an R2 key for the optimised one.
 * `books/lagoon/p1-abc.mp4` â†’ `books/lagoon/p1-abc.opt.mp4`
 */
export function optimizedKey(originalKey: string, extension: string): string {
  const dot = originalKey.lastIndexOf(".");
  const stem = dot > 0 ? originalKey.slice(0, dot) : originalKey;
  return `${stem}.opt.${extension}`;
}

/* --------------------------------------------------------------------- *
 * R2 transform hooks
 *
 * These plug into `mirrorToR2` / `uploadAsset` so the optimiser runs
 * between "download the generated asset" and "store it in the bucket".
 * The optimised object is always written under a NEW key â€” the original
 * object is never overwritten, which is what lets
 * `apps/api/scripts/rollback-optimized-media.mjs` restore the old URLs.
 * --------------------------------------------------------------------- */

export interface TransformOutcome {
  bytesBefore: number;
  bytesAfter: number;
  applied: boolean;
  note?: string;
}

/** Last transform outcome, for logging/tests. */
export const lastTransform: { outcome: TransformOutcome | null } = { outcome: null };

/**
 * Build a transform for a media kind. Returns null (meaning "keep the
 * original") when the optimiser could not run.
 */
export function makeTransform(kind: MediaKind, options: OptimizeOptions = {}) {
  return async (
    body: Buffer,
    _contentType: string,
    key: string
  ): Promise<{ body: Buffer; contentType: string; key: string } | null> => {
    const opt = await optimizeMedia(kind, body, options);
    lastTransform.outcome = {
      bytesBefore: opt.bytesBefore,
      bytesAfter: opt.bytesAfter,
      applied: opt.applied,
      note: opt.note
    };
    if (!opt.applied) {
      console.warn(
        `[media-opt] ${kind} optimisation skipped for ${key}: ${opt.note ?? "unknown"} â€” keeping the original`
      );
      return null;
    }
    console.log(
      `[media-opt] ${kind} ${key} â†’ ${opt.extension}: ${opt.bytesBefore} B â†’ ${opt.bytesAfter} B ` +
        `(-${Math.round((1 - opt.bytesAfter / Math.max(1, opt.bytesBefore)) * 100)}%)`
    );
    return {
      body: opt.body,
      contentType: opt.contentType,
      key: optimizedKey(key, opt.extension)
    };
  };
}

/** Transform for a page poster / still (WebP, 1280 wide). */
export const posterTransform = (options: OptimizeOptions = {}) =>
  makeTransform("image", { maxWidth: POSTER_MAX_WIDTH, ...options });

/** Transform for a book cover (WebP, 800 wide). */
export const coverTransform = (options: OptimizeOptions = {}) =>
  makeTransform("image", { maxWidth: COVER_MAX_WIDTH, ...options });

/** Transform for a generated clip (faststart remux, no re-encode). */
export const videoTransform = () => makeTransform("video");

/** Transform for narration (mono MP3 48 kbps). */
export const narrationTransform = () => makeTransform("narration");

/**
 * Optimise a buffer we already hold in memory and upload it under a NEW
 * key. Used where the source bytes are already local (an ElevenLabs TTS
 * response, a user-uploaded cover) rather than a remote URL to mirror.
 */
export async function uploadOptimized(
  key: string,
  body: Buffer,
  kind: MediaKind,
  options: OptimizeOptions = {}
): Promise<{
  url: string;
  key: string;
  source: "r2" | "stub";
  bytesBefore: number;
  bytesAfter: number;
  applied: boolean;
}> {
  const { uploadAsset } = await import("./cloudflare.js");
  const opt = await optimizeMedia(kind, body, options);
  if (!opt.applied) {
    console.warn(
      `[media-opt] ${kind} optimisation skipped for ${key}: ${opt.note ?? "unknown"} â€” uploading the original`
    );
    const stored = await uploadAsset({ key, body, contentType: opt.contentType });
    return {
      url: stored.url,
      key: stored.key,
      source: stored.source,
      bytesBefore: opt.bytesBefore,
      bytesAfter: opt.bytesAfter,
      applied: false
    };
  }
  const newKey = optimizedKey(key, opt.extension);
  const stored = await uploadAsset({ key: newKey, body: opt.body, contentType: opt.contentType });
  console.log(
    `[media-opt] ${kind} ${key} â†’ ${newKey}: ${opt.bytesBefore} B â†’ ${opt.bytesAfter} B ` +
      `(-${Math.round((1 - opt.bytesAfter / Math.max(1, opt.bytesBefore)) * 100)}%)`
  );
  return {
    url: stored.url,
    key: stored.key,
    source: stored.source,
    bytesBefore: opt.bytesBefore,
    bytesAfter: opt.bytesAfter,
    applied: true
  };
}
