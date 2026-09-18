// Splits a ≤600-char hook into 3 cinematic scene prompts. We pick the most
// evocative 1-sentence beats from the hook (first, middle-style, last) and
// pad them with a fixed visual scaffold so Runway has something concrete to
// hang a still image on. No Claude call needed — the hook is short by
// construction.
import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

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
  // process is always defined in Node.
  process.stdout; // touch to satisfy bundlers that strip process
  const nodeCrypto = require("node:crypto") as typeof import("node:crypto");
  nodeCrypto.randomFillSync(bytes);
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
