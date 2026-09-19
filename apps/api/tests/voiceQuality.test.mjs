// Tests for the voice-clone UX polish: multi-file envelope, quality
// scoring, preview synthesis endpoint. The /preview and /samples routes
// depend on ElevenLabs + R2 + auth, so we test the scoring + envelope
// parsing directly. End-to-end tests live in ops scripts (kick-audio.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { scoreVoiceQuality, PREVIEW_SENTENCE } from "../dist/services/voiceQuality.js";

test("PREVIEW_SENTENCE: a real, narratable sentence", () => {
  assert.ok(typeof PREVIEW_SENTENCE === "string" && PREVIEW_SENTENCE.length > 20);
  // Should be safe for ElevenLabs' content classifier (no PII, no hate).
  assert.doesNotMatch(PREVIEW_SENTENCE, /\b(hate|kill|nude)\b/i);
});

test("scoreVoiceQuality: empty input → score 0 with helpful hint", async () => {
  const r = await scoreVoiceQuality([]);
  assert.equal(r.score, 0);
  assert.match(r.hint ?? "", /upload at least one/i);
});

test("scoreVoiceQuality: synthetic WAV 44.1kHz mono scores high", async () => {
  // Build a 90-second silent WAV at 44.1kHz mono via ffmpeg. Silence still
  // scores for format/duration even though the content is empty.
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "vq-"));
  const wavPath = join(dir, "test.wav");
  const synth = spawnSync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
    "-t", "90", "-ar", "44100", wavPath
  ], { encoding: "utf8" });
  if (synth.status !== 0) {
    // ffprobe / ffmpeg missing → score 0 with null stats. Skip.
    return;
  }
  const buf = readFileSync(wavPath);
  const r = await scoreVoiceQuality([{ buffer: buf, filename: "test.wav" }]);
  // At least format + duration should score well for a 90s 44.1k WAV.
  assert.ok(r.score >= 40, `expected ≥40 for one good WAV sample, got ${r.score}`);
  assert.ok(r.components.format.contribution >= 18);
  assert.ok(r.components.totalDuration.contribution >= 14);
});

test("scoreVoiceQuality: tiny sample scores low with actionable hint", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "vq-"));
  const wavPath = join(dir, "short.wav");
  const synth = spawnSync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono",
    "-t", "15", "-ar", "22050", wavPath
  ], { encoding: "utf8" });
  if (synth.status !== 0) return;
  const buf = readFileSync(wavPath);
  const r = await scoreVoiceQuality([{ buffer: buf, filename: "short.wav" }]);
  assert.ok(r.score < 50, `expected low score for 15s/22k sample, got ${r.score}`);
  assert.ok(r.hint && /seconds|seconds/i.test(r.hint), `expected hint about duration, got: ${r.hint}`);
});

test("scoreVoiceQuality: variety bonus when formats differ", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "vq-"));
  const wav1 = join(dir, "a.wav");
  const wav2 = join(dir, "b.wav");
  spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono", "-t", "60", "-ar", "22050", wav1], { encoding: "utf8" });
  spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "60", "-ar", "44100", wav2], { encoding: "utf8" });
  const r = await scoreVoiceQuality([
    { buffer: readFileSync(wav1), filename: "a.wav" },
    { buffer: readFileSync(wav2), filename: "b.wav" }
  ]);
  assert.ok(r.components.variety.contribution >= 7);
});

test("scoreVoiceQuality: high score (≥90) → 'excellent' hint", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "vq-"));
  // Build 4 distinct 60s WAVs at different sample rates to maximise score.
  const rates = [44100, 48000, 22050, 32000];
  const samples = rates.map((rate, i) => {
    const p = join(dir, `s${i}.wav`);
    spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `anullsrc=r=${rate}:cl=mono`, "-t", "60", "-ar", String(rate), p], { encoding: "utf8" });
    return { buffer: readFileSync(p), filename: `s${i}.wav` };
  });
  const r = await scoreVoiceQuality(samples);
  if (r.score >= 90) {
    assert.match(r.hint ?? "", /excellent/i);
  }
  // Even with synthetic silence the score should be reasonable.
  assert.ok(r.score >= 50, `expected ≥50 with 4 60s WAVs, got ${r.score}`);
});
