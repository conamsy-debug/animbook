// Pure-logic tests for the AnimBook DREAM ambient synth recipes.
//
// The full integration (Web Audio API, AudioBufferSourceNode, LFO wiring)
// lives in `apps/web/src/lib/dreamAmbient.mjs` and requires a browser.
// This file pins the RECIPES so the recipes can be regression-tested
// in CI without an AudioContext:
//
//   - pink/brown/white noise generators stay bounded (RMS ≤ 1, no NaN)
//   - TRACK_RECIPES covers every track the API can return
//   - every track has a valid noise+filter combo
//   - LFO depth ≤ 1 (no clip distortion on the swell)
//
// Run with: `node --test apps/web/tests/dreamAmbient.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import {
  makePinkNoise,
  makeBrownNoise,
  makeWhiteNoise,
  TRACK_RECIPES,
  recipeFor,
  AMBIENT_BUFFER_SECONDS,
  AMBIENT_BUFFER_RATE
} from "../src/lib/dreamAmbient.mjs";

/** Deterministic PRNG for repeatable tests. */
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function rms(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
  return Math.sqrt(sum / arr.length);
}

test("makePinkNoise: bounded output (RMS in [0.05, 0.5])", () => {
  const rng = seededRng(42);
  const buf = makePinkNoise(8000, rng);
  assert.equal(buf.length, 8000);
  const r = rms(buf);
  assert.ok(r > 0.05, `pink RMS too low: ${r}`);
  assert.ok(r < 0.5, `pink RMS too high: ${r}`);
  for (let i = 0; i < buf.length; i++) {
    assert.ok(Number.isFinite(buf[i]));
    assert.ok(buf[i] >= -1.5 && buf[i] <= 1.5, `pink sample out of range: ${buf[i]}`);
  }
});

test("makeBrownNoise: bounded output (RMS in [0.05, 0.5])", () => {
  const rng = seededRng(42);
  const buf = makeBrownNoise(8000, rng);
  assert.equal(buf.length, 8000);
  const r = rms(buf);
  assert.ok(r > 0.05, `brown RMS too low: ${r}`);
  assert.ok(r < 0.5, `brown RMS too high: ${r}`);
  for (let i = 0; i < buf.length; i++) {
    assert.ok(Number.isFinite(buf[i]));
  }
});

test("makeWhiteNoise: bounded output (RMS ≈ 1/√3 ≈ 0.577)", () => {
  const rng = seededRng(42);
  const buf = makeWhiteNoise(8000, rng);
  assert.equal(buf.length, 8000);
  const r = rms(buf);
  assert.ok(r > 0.5 && r < 0.65, `white RMS out of expected range: ${r}`);
});

test("TRACK_RECIPES covers every track the API can return", () => {
  for (const t of ["ocean_waves", "rainforest", "fireplace", "river", "white_noise"]) {
    assert.ok(TRACK_RECIPES[t], `missing recipe: ${t}`);
  }
});

test("recipeFor returns the same object as TRACK_RECIPES", () => {
  assert.equal(recipeFor("ocean_waves"), TRACK_RECIPES.ocean_waves);
});

test("recipeFor returns null for an unknown track", () => {
  assert.equal(recipeFor("not_a_track"), null);
});

test("every recipe has a valid noise+filter combo", () => {
  for (const [name, recipe] of Object.entries(TRACK_RECIPES)) {
    assert.ok(["pink", "brown", "white"].includes(recipe.noise), `${name}: bad noise`);
    assert.ok(["lowpass", "highpass", "bandpass", "lowshelf", "highshelf", "peaking", "notch", "allpass"].includes(recipe.filter), `${name}: bad filter`);
    assert.ok(recipe.cutoffHz > 20 && recipe.cutoffHz < 22050, `${name}: cutoff out of range ${recipe.cutoffHz}`);
    assert.ok(recipe.gain > 0 && recipe.gain <= 1, `${name}: gain out of range ${recipe.gain}`);
    if (recipe.lfoHz) assert.ok(recipe.lfoHz > 0 && recipe.lfoHz < 5, `${name}: lfoHz ${recipe.lfoHz}`);
    if (recipe.lfoDepth) assert.ok(recipe.lfoDepth > 0 && recipe.lfoDepth <= 1, `${name}: lfoDepth ${recipe.lfoDepth}`);
    if (recipe.clickRate) assert.ok(recipe.clickRate > 0 && recipe.clickRate <= 8, `${name}: clickRate ${recipe.clickRate}`);
  }
});

test("ocean_waves recipe has slow LFO (one swell every 7s)", () => {
  // 1/0.14 ≈ 7.14s per cycle — that's the slow "wave" cadence.
  assert.equal(TRACK_RECIPES.ocean_waves.lfoHz, 0.14);
  assert.equal(TRACK_RECIPES.ocean_waves.lfoDepth, 0.45);
});

test("fireplace recipe uses brown noise (low-frequency body)", () => {
  assert.equal(TRACK_RECIPES.fireplace.noise, "brown");
  assert.ok(TRACK_RECIPES.fireplace.clickRate > 0, "fireplace should have crackles");
});

test("rainforest recipe has sparse clicks", () => {
  assert.equal(TRACK_RECIPES.rainforest.noise, "pink");
  assert.ok(TRACK_RECIPES.rainforest.clickRate < 2, "rainforest rain should be sparse");
});

test("white_noise recipe stays gentle (low gain, soft bandpass)", () => {
  assert.equal(TRACK_RECIPES.white_noise.noise, "white");
  assert.ok(TRACK_RECIPES.white_noise.gain <= 0.3, "white noise should be quiet");
});

test("buffer length math: AMBIENT_BUFFER_SECONDS * AMBIENT_BUFFER_RATE > 80k", () => {
  // 4 seconds * 22050 Hz = 88,200 samples — long enough that the loop
  // point stays inaudible (pink/brown noise is statistically stationary).
  assert.ok(AMBIENT_BUFFER_SECONDS * AMBIENT_BUFFER_RATE > 80000);
});

test("gain × (1 + lfoDepth) ≤ 1.0 so the swell never clips", () => {
  for (const [name, r] of Object.entries(TRACK_RECIPES)) {
    if (r.lfoDepth) {
      const peak = r.gain * (1 + r.lfoDepth);
      assert.ok(peak <= 1.0, `${name} peak gain ${peak} > 1.0`);
    }
  }
});
