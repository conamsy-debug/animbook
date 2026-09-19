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
  assert.notEqual(a, b);
  // 1000 tokens — none collide (codespace is 36^8 ≈ 2.8 trillion)
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
