import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tModule = await import("../dist/services/trailer.js");

test("splitHookIntoScenes: 3 sentences → distinct beats + scaffold on each", () => {
  const hook = "A spark ignites. The world listens. Hope survives.";
  const scenes = tModule.splitHookIntoScenes(hook);
  assert.ok(scenes.scene1.startsWith("Opening cinematic slow dolly reveal."));
  assert.ok(scenes.scene2.startsWith("Mid-tension close-up"));
  assert.ok(scenes.scene3.startsWith("Closing wide pull-back"));
  assert.match(scenes.scene1, /A spark ignites\.$/);
  assert.match(scenes.scene2, /The world listens\.$/);
  assert.match(scenes.scene3, /Hope survives\.$/);
});

test("splitHookIntoScenes: one big run-on sentence → 3 picks land on the same beat (no crash)", () => {
  const hook = "Every cell in your body is listening to a story you've been telling yourself with every meal.";
  const scenes = tModule.splitHookIntoScenes(hook);
  assert.equal(typeof scenes.scene1, "string");
  assert.equal(typeof scenes.scene2, "string");
  assert.equal(typeof scenes.scene3, "string");
  assert.ok(scenes.scene1.length > 0 && scenes.scene3.length > 0);
});

test("splitHookIntoScenes: empty input → empty scenes with scaffold", () => {
  const scenes = tModule.splitHookIntoScenes("   ");
  for (const v of Object.values(scenes)) {
    assert.equal(typeof v, "string");
    assert.ok(v.length > 0);
  }
});

test("splitHookIntoScenes: newline-flush hook is whitespace-cleaned", () => {
  const scenes = tModule.splitHookIntoScenes("One.\n\nTwo.\n\nThree.");
  assert.match(scenes.scene1, /One\.$/);
  assert.match(scenes.scene2, /Two\.$/);
  assert.match(scenes.scene3, /Three\.$/);
});

test("generateShareToken: 8 lowercase alphanumerics, deterministic-style randomness (high collision-resistance)", () => {
  const a = tModule.generateShareToken();
  const b = tModule.generateShareToken();
  assert.equal(a.length, 8);
  assert.match(a, /^[a-z0-9]{8}$/);
  // Two tokens should differ with overwhelming probability on a 36^8
  // space; keep this loose to avoid CI flakes.
  assert.notEqual(a, b);
});

/* --------------------------------------------------------------------- *
 * renderCoverOverlayPng — feeds a real local PNG through ffmpeg and
 * asserts the output is a valid PNG. Skipped on hosts without ffmpeg.
 * The cover-with-title banner is rendered by the drawtext filter; this
 * test pins the contract: same input → non-zero PNG → file magic 89 50
 * 4E 47.
 * --------------------------------------------------------------------- */

function makeCoverPng(file, label) {
  // Synthesise a tiny "valid PNG" via ffmpeg — keeps the test free of
  // binary fixtures in the repo. 160×240 in either brand-gold (warm) or
  // brand-green (cool) so the cover is recognisable as a stand-in.
  const synth = spawnSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=0x${label === "warm" ? "C49A1C" : "1A6B3C"}:s=160x240`,
    "-frames:v", "1",
    file
  ], { stdio: ["ignore", "ignore", "pipe"] });
  if (synth.status !== 0) {
    throw new Error(`ffmpeg synth failed: ${synth.stderr?.toString().slice(-200) ?? ""}`);
  }
}

test("renderCoverOverlayPng: emits a valid PNG with the title overlay (skipped without ffmpeg)", async () => {
  const which = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (which.status !== 0) return; // host without ffmpeg
  const dir = mkdtempSync(join(tmpdir(), "animbook-thumb-test-"));
  try {
    const coverFile = join(dir, "cover.png");
    makeCoverPng(coverFile, "warm");
    const { pngBytes } = await tModule.renderCoverOverlayPng(coverFile, "The Hidden Mountain");
    assert.ok(pngBytes.byteLength > 1024, `expected non-trivial PNG, got ${pngBytes.byteLength} bytes`);
    // PNG file magic: 89 50 4E 47 0D 0A 1A 0A
    assert.deepEqual(Array.from(pngBytes.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderCoverOverlayPng: handles drawtext-special characters in the title without breaking ffmpeg", async () => {
  const which = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (which.status !== 0) return;
  const dir = mkdtempSync(join(tmpdir(), "animbook-thumb-test-"));
  try {
    const coverFile = join(dir, "cover.png");
    makeCoverPng(coverFile, "cool");
    // Colons, backslashes, single quotes, and percent signs are the four
    // characters drawtext treats specially. Real book titles
    // occasionally contain colons ("X: Y") so this is a real-world case.
    const { pngBytes } = await tModule.renderCoverOverlayPng(coverFile, "Time's Arrow: 50% Off \\Now");
    assert.ok(pngBytes.byteLength > 1024);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("generateShareToken: 1000 tokens do not collide on 36^8 codespace", () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) set.add(tModule.generateShareToken());
  assert.equal(set.size, 1000);
});

// Stitcher tests — exercise the actual ffmpeg invocation we use at runtime.
// Skipped if ffmpeg isn't on PATH (e.g. CI boxes without it).
function ensureFfmpeg() {
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return r.status === 0;
}

test("stitchTrailerClips: ffmpeg concat produces a playable MP4 (skipped if no ffmpeg)", async () => {
  if (!ensureFfmpeg()) return; // soft skip — local devs / Windows may not have it
  const { stitchTrailerClips } = tModule;
  const work = mkdtempSync(join(tmpdir(), "trailer-stitch-"));
  try {
    // Build two 1-second clips at 320x240 from a synthetic source.
    for (const i of [1, 2, 3]) {
      const out = join(work, `c${i}.mp4`);
      const r = spawnSync("ffmpeg", [
        "-y",
        "-f", "lavfi",
        "-i", `testsrc=duration=1:size=320x240:rate=24${i === 2 ? ",format=yuv420p" : ""}`,
        "-pix_fmt", "yuv420p",
        out
      ], { encoding: "utf8" });
      if (r.status !== 0) {
        console.warn("ffmpeg clip build failed (skipping):", r.stderr.slice(0, 200));
        return;
      }
    }
    const listFile = join(work, "list.txt");
    writeFileSync(listFile, ["c1.mp4", "c2.mp4", "c3.mp4"].map((f) => `file '${join(work, f)}'`).join("\n"));
    const out = join(work, "trailer.mp4");
    await stitchTrailerClips(listFile, out);
    const stat = readFileSync(out).slice(0, 12);
    // Quick sanity: an MP4 file has an "ftyp" box near the start.
    const head = stat.toString("latin1");
    assert.ok(head.includes("ftyp"), `expected MP4 ftyp header in trailer, got: ${head}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
