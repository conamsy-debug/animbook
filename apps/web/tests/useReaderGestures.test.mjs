// Pure-logic tests for the Reader gesture decision rules.
//
// The full hook (`apps/web/src/lib/useReaderGestures.ts`) lives in React
// and uses real touch events, so we can't unit-test it without a
// browser. This file pins the DECISION rules the hook encodes so the
// behaviour can be regression-tested in CI:
//   - tap-zone side → prev / next
//   - swipe direction → prev / next
//   - high vertical drift disqualifies the swipe
//   - small movement isn't a tap
// Each block mirrors the relevant lines in useReaderGestures.ts. If the
// production rules change, change both files together.
//
// Run with: `node --test apps/web/tests/useReaderGestures.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";

const SWIPE_THRESHOLD_PX = 50;
const FLICK_VELOCITY_PX_MS = 0.4;
const MAX_VERTICAL_DRIFT = 0.6;
const TAP_MAX_DRIFT_PX = 8;
const TAP_MAX_VERTICAL_PX = 12;
const TAP_MAX_DURATION_MS = 350;

/** Decide prev/next from the touchstart side, used by the tap-zone path. */
function decideTap(side) {
  return side === "left" ? "prev" : "next";
}

/** Decide prev/next from swipe/flick horizontal delta (positive = rightward). */
function decideSwipe(dx) {
  return dx > 0 ? "prev" : "next";
}

/** True iff the touch motion qualifies as a swipe or flick (horizontal,
 *  not too much vertical drift). dx in px (positive = right), dy in px,
 *  dt in ms. */
function isSwipeOrFlick(dx, dy, dt) {
  const horizAbs = Math.abs(dx);
  const vertAbs = Math.abs(dy);
  // Fast flick bypasses the distance threshold — quick finger snap of
  // 25px in 50ms (0.5 px/ms) still counts even though 25 < 50.
  const isFastFlick = dt > 0 && Math.abs(dx / dt) >= FLICK_VELOCITY_PX_MS;
  if (!isFastFlick && horizAbs < SWIPE_THRESHOLD_PX) return false;
  if (vertAbs > horizAbs * MAX_VERTICAL_DRIFT) return false;
  return true;
}

/** True iff the touch motion is a quick tap (no real movement, short
 *  duration). */
function isTap(dx, dy, dt) {
  return Math.abs(dx) < TAP_MAX_DRIFT_PX
    && Math.abs(dy) < TAP_MAX_VERTICAL_PX
    && dt < TAP_MAX_DURATION_MS;
}

test("tap zone: left half of screen → prev", () => {
  assert.equal(decideTap("left"), "prev");
});

test("tap zone: right half of screen → next", () => {
  assert.equal(decideTap("right"), "next");
});

test("swipe direction: positive dx (right) → prev (Western read direction)", () => {
  assert.equal(decideSwipe(80), "prev");
});

test("swipe direction: negative dx (left) → next", () => {
  assert.equal(decideSwipe(-80), "next");
});

test("swipe: horizontal travel above threshold counts", () => {
  assert.equal(isSwipeOrFlick(80, 0, 100), true);
  assert.equal(isSwipeOrFlick(120, 30, 200), true);
});

test("swipe: travel below threshold AND below flick velocity disqualifies", () => {
  // 40px in 100ms = 0.4 px/ms = exactly the flick threshold. Use a slower
  // drag so velocity is below threshold AND distance is below threshold.
  assert.equal(isSwipeOrFlick(40, 0, 200), false);  // 0.2 px/ms
  assert.equal(isSwipeOrFlick(20, 0, 100), false);  // 0.2 px/ms
});

test("swipe: high vertical drift disqualifies", () => {
  // 80px right, 60px down → 60 > 80 * 0.6 = 48 → disqualified
  assert.equal(isSwipeOrFlick(80, 60, 100), false);
  // 80px right, 40px down → 40 ≤ 48 → still a swipe
  assert.equal(isSwipeOrFlick(80, 40, 100), true);
});

test("swipe: fast flick with small distance still triggers", () => {
  // 30px in 50ms = 0.6 px/ms ≥ 0.4 → flick
  assert.equal(isSwipeOrFlick(30, 0, 50), true);
  // 20px in 100ms = 0.2 px/ms → not enough
  assert.equal(isSwipeOrFlick(20, 0, 100), false);
});

test("tap: small movement, short duration → tap", () => {
  assert.equal(isTap(2, 3, 100), true);
});

test("tap: large movement → not a tap", () => {
  assert.equal(isTap(50, 0, 100), false);
  assert.equal(isTap(0, 30, 100), false);
});

test("tap: long duration → not a tap", () => {
  assert.equal(isTap(2, 3, 500), false);
});
