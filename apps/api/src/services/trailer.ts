// Splits a ≤600-char hook into 3 cinematic scene prompts. We pick the most
// evocative 1-sentence beats from the hook (first, middle-style, last) and
// pad them with a fixed visual scaffold so Runway has something concrete to
// hang a still image on. No Claude call needed — the hook is short by
// construction.
import { spawn } from "node:child_process";
import { readFile, rm, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomFillSync } from "node:crypto";
import { join } from "node:path";

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

/* --------------------------------------------------------------------- *
 * Cover-with-title-overlay thumbnail
 *
 * The trailer pipeline produces a 30s MP4, but social previews (OG
 * images, Twitter Card thumbnails, Slack unfurls) need a STATIC image.
 * This composites the book's coverUrl with the title in a translucent
 * banner at the bottom — the same look readers see when they open the
 * trailer link.
 *
 * Used as `BookShare.thumbnailUrl` and as `og:image` for /share/<token>.
 *
 * Falls back gracefully:
 *   - If the cover URL is empty / 404s: returns null (caller uses the
 *     bare coverUrl for the og:image, no overlay).
 *   - If no system font is available: skips the title overlay and just
 *     re-uploads the cover at share/<bookId>-thumb.png — still better
 *     than the inline `<img>` fallback because the share row gets a
 *     persistent R2 URL to point at.
 * --------------------------------------------------------------------- */

const CANDIDATE_FONT_PATHS = [
  // Common Linux locations on nixpacks / Debian / Ubuntu.
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "C:/Windows/Fonts/arialbd.ttf"
];

function pickFontPath(): string | null {
  for (const p of CANDIDATE_FONT_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Render a single PNG frame of the cover with a title banner.
 * Returns the raw PNG bytes. Caller uploads to R2 + updates BookShare.
 *
 * `coverUrl` is fetched via ffmpeg's HTTP input support, so no Node-side
 * download dance is needed. `title` is escaped for ffmpeg's drawtext
 * filter (which uses ":" and "\\" as syntax chars).
 */
export async function renderCoverOverlayPng(
  coverUrl: string,
  title: string
): Promise<{ pngBytes: Buffer; usedFont: boolean }> {
  const fontPath = pickFontPath();
  // drawtext is fine without a fontfile (uses ffmpeg's built-in default),
  // but if a font is available we use it for cross-platform consistency.
  // On Windows the drive colon (e.g. C:) needs to be escaped as C\: so
  // ffmpeg's filter parser doesn't treat it as an option separator.
  const safeFontPath = fontPath ? fontPath.replace(/^([A-Za-z]):/, "$1\\:") : null;
  const fontArg = safeFontPath ? `fontfile='${safeFontPath}':` : "";

  // Use a tempdir so multiple concurrent generations don't collide.
  const workDir = await mkdtemp(join(tmpdir(), "animbook-thumb-"));
  const outputPng = join(workDir, "thumb.png");

  // Write the title to a text file and pass it via `textfile=`. This
  // sidesteps drawtext's painful escape rules — no backslash, colon,
  // percent or quote escaping is needed because ffmpeg reads the literal
  // bytes from disk. Title is hard-capped at 120 chars so a runaway input
  // can't fill the work dir.
  const titlePath = join(workDir, "title.txt");
  await writeFile(titlePath, title.slice(0, 120), "utf8");

  // Probe the cover's dimensions first so we can size the banner, title
  // and subtitle with absolute pixel values. drawtext expressions don't
  // expose the input frame's width/height (only text_w, text_h, line_h,
  // n, pts, r, time_base) so we can't do relative scaling inside the
  // filter — must compute it on this side and bake it in.
  const dims = await probeCoverDims(coverUrl).catch(() => null);

  // If we couldn't probe (rare — broken cover URL, no ffprobe, etc.) fall
  // back to sane defaults. Real covers are 512–2048 wide and 720–2880 tall.
  const W = dims?.width ?? 1024;
  const H = dims?.height ?? 1440;
  const bannerH = Math.round(W * 0.30);            // 30% of cover width
  const bannerY = H - bannerH;                     // pinned to bottom
  const titleSize = Math.max(28, Math.round(W * 0.07));    // ~7% of width, floor 28
  const subtitleSize = Math.max(14, Math.round(W * 0.025)); // ~2.5% of width, floor 14
  // Absolute y values for drawtext (which has no access to ih). The text
  // sits inside the banner: title at ~20% from banner top, subtitle at
  // ~70% from banner top (i.e. near the bottom edge of the banner).
  const titleY = bannerY + Math.round(bannerH * 0.18);
  const subtitleY = bannerY + Math.round(bannerH * 0.62);

  // Two separate filter chains with an explicit label handoff. The chain
  // order is intentional: banner first, title on top of it, subtitle
  // below the title. We use `textfile=` for the title so we don't have
  // to escape backslash / colon / quote / percent chars — ffmpeg reads
  // the literal bytes from disk. The subtitle is hard-coded so we can
  // pass it as `text=` without worrying.
  // POSIX-style path + drive-colon escape so ffmpeg's parser doesn't
  // split on either backslashes or the `C:` colon.
  const safeTitlePath = titlePath.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");
  const filter = [
    // Chain 1: black banner + title, output labeled [v1].
    `[0:v]drawbox=x=0:y=ih-${bannerH}:w=iw:h=${bannerH}:color=black@0.55:t=fill,drawtext=textfile='${safeTitlePath}':${fontArg}fontcolor=white:fontsize=${titleSize}:x=(w-text_w)/2:y=${titleY}[v1]`,
    // Chain 2: subtitle on top of [v1], output labeled [vout].
    `[v1]drawtext=text='WATCH THE TRAILER':${fontArg}fontcolor=0xC49A1C:fontsize=${subtitleSize}:x=(w-text_w)/2:y=${subtitleY}[vout]`
  ].join(";");

  const args = [
    "-y",
    "-i", coverUrl,
    "-filter_complex", filter,
    "-map", "[vout]",
    "-frames:v", "1",
    outputPng
  ];

  try {
    await new Promise<void>((resolveP, rejectP) => {
      const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (c: Buffer | string) => { stderr += c.toString("utf8"); });
      child.on("error", rejectP);
      child.on("close", (code) => {
        if (code === 0) resolveP();
        else rejectP(new Error(`ffmpeg overlay ${code}: ${stderr.slice(-600)}`));
      });
    });

    const buf = await readFile(outputPng);
    return { pngBytes: buf, usedFont: fontPath !== null };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Use ffprobe to read the cover image's dimensions. Returns null if
 * ffprobe isn't available or the cover URL is unreachable. Used by
 * renderCoverOverlayPng to compute absolute pixel sizes since the
 * drawtext filter can't read the input frame's dimensions at expression
 * time.
 */
async function probeCoverDims(coverUrl: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolveP) => {
    const args = ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", coverUrl];
    const child = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (c: Buffer | string) => { stdout += c.toString("utf8"); });
    child.on("error", () => resolveP(null));
    child.on("close", (code) => {
      if (code !== 0) return resolveP(null);
      const cleaned = stdout.trim().replace(/[^\dx]/gi, "");
      const [w, h] = cleaned.split("x").map((s) => parseInt(s, 10));
      if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) return resolveP(null);
      resolveP({ width: w, height: h });
    });
  });
}
