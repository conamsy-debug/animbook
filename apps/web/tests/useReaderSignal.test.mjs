// Pure-logic tests for the reader signal tracking rules. The full hook
// (`apps/web/src/lib/useReaderSignal.ts`) lives in React + DOM and runs
// in the browser, so we test the decision rules via pure functions
// mirrored from the hook. If the production rules change, change both
// files together.
//
// Decisions under test:
//   - When the buffer reaches ADAPT_THRESHOLD events, fire /adapt.
//   - When ≥2 events have accumulated AND the last adapt is older than
//     ADAPT_MIN_INTERVAL_MS, fire /adapt (catches the "slow reader"
//     case where they linger on a few pages for minutes).
//   - Buffer is capped at 60 entries (older events shift off).
//   - prevDwellMs < 100 is treated as a no-op (mount-time /
//     programmatic flips shouldn't pollute signal data).

const ADAPT_THRESHOLD = 6;
const ADAPT_MIN_INTERVAL_MS = 60_000;
const BUFFER_CAP = 60;
const MIN_USEFUL_DWELL_MS = 100;

/**
 * Decide whether to fire /adapt given the current buffer length and the
 * wall-clock time since the last adapt.
 */
function shouldAdapt(bufferLength, sinceLastAdaptMs) {
  if (bufferLength >= ADAPT_THRESHOLD) return true;
  if (bufferLength >= 2 && sinceLastAdaptMs >= ADAPT_MIN_INTERVAL_MS) return true;
  return false;
}

/** Cap a buffer in place: oldest entries shift off when over capacity. */
function capBuffer(buffer) {
  while (buffer.length > BUFFER_CAP) buffer.shift();
}

/** Filter events below the useful-dwell threshold. */
function isUsefulEvent(dwellMs) {
  return dwellMs >= MIN_USEFUL_DWELL_MS;
}

import test from "node:test";
import assert from "node:assert/strict";

test("shouldAdapt: empty buffer → false", () => {
  assert.equal(shouldAdapt(0, 999_999), false);
  assert.equal(shouldAdapt(0, 0), false);
});

test("shouldAdapt: 1 event, no time passed → false", () => {
  assert.equal(shouldAdapt(1, 0), false);
});

test("shouldAdapt: 1 event, 60s passed → false (need ≥2)", () => {
  assert.equal(shouldAdapt(1, 60_000), false);
});

test("shouldAdapt: 2 events, 60s passed → true (slow reader)", () => {
  assert.equal(shouldAdapt(2, 60_000), true);
});

test("shouldAdapt: 2 events, 30s passed → false (too soon)", () => {
  assert.equal(shouldAdapt(2, 30_000), false);
});

test("shouldAdapt: 6 events, no time passed → true (threshold hit)", () => {
  assert.equal(shouldAdapt(6, 0), true);
});

test("shouldAdapt: 5 events, 120s passed → true (slow reader + 2 events)", () => {
  assert.equal(shouldAdapt(5, 120_000), true);
});

test("shouldAdapt: 5 events, 30s passed → false (under threshold AND under interval)", () => {
  assert.equal(shouldAdapt(5, 30_000), false);
});

test("capBuffer: trims oldest entries when over capacity", () => {
  const buf = Array.from({ length: 65 }, (_, i) => ({ pageNum: i }));
  capBuffer(buf);
  assert.equal(buf.length, BUFFER_CAP);
  // First remaining entry should be the one that was at index 5
  // (indices 0-4 shifted off).
  assert.equal(buf[0].pageNum, 5);
  assert.equal(buf[buf.length - 1].pageNum, 64);
});

test("capBuffer: leaves a small buffer alone", () => {
  const buf = [{ pageNum: 1 }, { pageNum: 2 }];
  capBuffer(buf);
  assert.equal(buf.length, 2);
});

test("isUsefulEvent: programmatic flips (under 100ms) are dropped", () => {
  assert.equal(isUsefulEvent(0), false);
  assert.equal(isUsefulEvent(50), false);
  assert.equal(isUsefulEvent(99), false);
  assert.equal(isUsefulEvent(100), true);
  assert.equal(isUsefulEvent(45_000), true);
});
