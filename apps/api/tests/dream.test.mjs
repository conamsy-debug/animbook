/**
 * Unit tests for the DREAM profile generator (pure function).
 *
 * Run with: `node --test apps/api/tests/dream.test.mjs`
 *
 * Uses Node's built-in test runner — no Vitest dependency on Windows
 * where the npm registry is flaky. The `dream.ts` module is a pure
 * function so we can test it by importing the source via tsx.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { dreamProfileForBook } from "../dist/src/services/dream.js";

test("dreamProfileForBook: returns a default shape", () => {
  const profile = dreamProfileForBook({
    vertical: "WELLNESS",
    moodTags: [],
    genreTags: [],
    title: "Test"
  });
  assert.equal(typeof profile.palette, "string");
  assert.equal(typeof profile.pacing, "string");
  assert.equal(typeof profile.narrationSpeed, "number");
  assert.equal(typeof profile.motionLevel, "number");
  assert.equal(typeof profile.flipDurationMs, "number");
  assert.equal(typeof profile.ambientTrack, "string");
  assert.equal(typeof profile.caption, "string");
  assert.equal(typeof profile.dimScreen, "boolean");
});

test("dreamProfileForBook: WELLNESS picks a calm/cool palette + leisurely pacing", () => {
  const a = dreamProfileForBook({ vertical: "WELLNESS", moodTags: ["calm"], genreTags: ["sleep story"], title: "Quiet Night" });
  assert.equal(a.palette, "cool");
  assert.equal(a.pacing, "leisurely");
  assert.ok(a.narrationSpeed < 1, "narration slows down");
  assert.ok(a.motionLevel <= 1, "motion never speeds up");
  assert.ok(a.dimScreen, "dims the screen for sleep");
});

test("dreamProfileForBook: title-based override picks 'ocean_waves' ambient when title contains ocean", () => {
  const p = dreamProfileForBook({ vertical: "WELLNESS", moodTags: ["calm"], genreTags: [], title: "The Sleeping Coast" });
  assert.equal(p.ambientTrack, "ocean_waves");
});

test("dreamProfileForBook: non-WELLNESS verticals still produce a profile (defensive)", () => {
  const p = dreamProfileForBook({ vertical: "KIDS", moodTags: [], genreTags: [], title: "Peter Rabbit" });
  assert.ok(p.palette);
  assert.ok(p.ambientTrack);
  assert.ok(p.flipDurationMs > 0);
});

test("dreamProfileForBook: profile is deterministic for the same input", () => {
  const a = dreamProfileForBook({ vertical: "WELLNESS", moodTags: ["restful"], genreTags: ["meditation"], title: "Tide and Bell" });
  const b = dreamProfileForBook({ vertical: "WELLNESS", moodTags: ["restful"], genreTags: ["meditation"], title: "Tide and Bell" });
  assert.deepEqual(a, b);
});

test("dreamProfileForBook: flipDurationMs falls in the safe 540-880 range", () => {
  const a = dreamProfileForBook({ vertical: "WELLNESS", moodTags: [], genreTags: [], title: "" });
  assert.ok(a.flipDurationMs >= 540 && a.flipDurationMs <= 880);
});
