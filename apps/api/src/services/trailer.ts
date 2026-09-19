// Splits a ≤600-char hook into 3 cinematic scene prompts. We pick the most
// evocative 1-sentence beats from the hook (first, middle-style, last) and
// pad them with a fixed visual scaffold so Runway has something concrete to
// hang a still image on. No Claude call needed — the hook is short by
// construction.
import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomFillSync } from "node:crypto";

const SCENE_SCAFFOLD = {
  scene1: "Opening cinematic slow dolly reveal.",
  scene2: "Mid-tension close-up, low angle, ambient particles drifting.",
  scene3: "Closing wide pull-back, golden hour light, calm."
};

function pickBeat(hook: string, target: "first" | "middle" | "last"): string {
  const sentences = hook
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return hook.trim();
  if (target === "first") return sentences[0]!;
  if (target === "last") return sentences[sentences.length - 1]!;
  // Pick the middle by character count — earlier mids have less room.
  const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
  let targetStart = totalChars / 2;
  let cursor = 0;
  for (const s of sentences) {
    cursor += s.length;
    if (cursor >= targetStart) return s;
  }
  return sentences[Math.floor(sentences.length / 2)]!;
}

/**
 * Returns 3 scene prompts ready for Runway text_to_image. Each is the picked
 * beat + a deterministic visual scaffold so all three clips sit in the same
 * cinematic family. The author already chose the hook; this just shapes it
 * for the camera.
 */
export function splitHookIntoScenes(hook: string): { scene1: string; scene2: string; scene3: string } {
  const trimmed = hook.replace(/\s+/g, " ").trim();
  return {
    scene1: `${SCENE_SCAFFOLD.scene1} ${pickBeat(trimmed, "first")}`,
    scene2: `${SCENE_SCAFFOLD.scene2} ${pickBeat(trimmed, "middle")}`,
    scene3: `${SCENE_SCAFFOLD.scene3} ${pickBeat(trimmed, "last")}`
  };
}

/**
 * 8-char lowercase alphanumeric token. Cryptographically random but URL-safe.
 * Returns a string unlikely to collide at v1 scale (~2.8 trillion codespace).
 */
export function generateShareToken(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(8);
  randomFillSync(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/**
 * Concatenates N MP4 clips into a single MP4 using ffmpeg's concat demuxer.
 * -c copy avoids re-encoding so this runs in milliseconds.
 * The list file format is one `file '<path>'` per line; callers create it
 * however they like (we accept any UTF-8 file).
 * Returns the output size; throws if ffmpeg fails or the output is missing.
 */
export async function stitchTrailerClips(listFile: string, outFile: string): Promise<number> {
  if (!existsSync(listFile)) throw new Error(`stitchTrailerClips: list file missing at ${listFile}`);
  const args = [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-c", "copy",
    "-movflags", "+faststart",
    outFile
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c: Buffer | string) => { stderr += c.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`));
    });
  });
  const buf = await readFile(outFile);
  // Clean up the list file — it's a per-run artifact, no value keeping.
  await unlink(listFile).catch(() => {});
  return buf.byteLength;
}

/**
 * Burns the AnimBook wordmark into every frame of an MP4 trailer using
 * ffmpeg's overlay filter. Position defaults to bottom-right with 32px
 * padding and ~78% opacity so the watermark is legible without competing
 * with the video content. Re-encodes with H.264 at the original CRF so the
 * output is small + player-friendly.
 */
const TRAILER_WATERMARK_PATHS = [
  // Compiled dist (railway build emits .js but assets stay alongside source)
  resolve(process.cwd(), "src", "assets", "trailer-watermark.png"),
  // Railway runs the API from the repo root; the asset can sit beside the source
  resolve(process.cwd(), "apps", "api", "src", "assets", "trailer-watermark.png"),
  // tsx dev: source-relative to this module
  resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "assets", "trailer-watermark.png"),
  // Built dist fallback — when tsc emits src/assets/trailer-watermark.png
  // to dist/src/assets/… we still resolve via src above, but in case the
  // running CWD differs we try one more relative location.
  resolve(process.cwd(), "dist", "src", "assets", "trailer-watermark.png")
];

export async function findWatermarkPath(): Promise<string> {
  for (const p of TRAILER_WATERMARK_PATHS) {
    if (existsSync(p)) return p;
  }
  throw new Error("trailer-watermark.png not found in any known location");
}

export async function applyTrailerWatermark(
  inputMp4: string,
  outputMp4: string,
  options: { paddingPx?: number; opacity?: number } = {}
): Promise<{ outputBytes: number; watermarkPath: string }> {
  const { paddingPx = 32, opacity = 0.78 } = options;
  const watermarkPath = await findWatermarkPath();
  // Scale the watermark to ~22% of the frame width so it's legible on
  // mobile (375px) without dominating the shot, and re-render it with the
  // requested opacity (ffmpeg's overlay filter does not fade logos on
  // its own without a transparency PNG, so we pre-multiply it).
  const filter = [
    // Scale the watermark to 22% width, apply opacity, push to bottom-right
    `[1:v]format=rgba,scale=iw*0.22:-1,colorchannelmixer=aa=${opacity}[wm]`,
    `[0:v][wm]overlay=W-w-${paddingPx}:H-h-${paddingPx}:format=auto[v]`,
    `[v]format=yuv420p[vout]`
  ].join(";");
  const args = [
    "-y",
    "-i", inputMp4,
    "-i", watermarkPath,
    "-filter_complex", filter,
    "-map", "[vout]",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-c:a", "copy",
    "-movflags", "+faststart",
    "-shortest",
    outputMp4
  ];
  await new Promise<void>((resolveP, rejectP) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c: Buffer | string) => { stderr += c.toString("utf8"); });
    child.on("error", rejectP);
    child.on("close", (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`ffmpeg watermark ${code}: ${stderr.slice(-600)}`));
    });
  });
  const buf = await readFile(outputMp4);
  return { outputBytes: buf.byteLength, watermarkPath };
}
