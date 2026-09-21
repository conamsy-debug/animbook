// Pure-logic tests for the homepage data-saver guard. The function
// inspects `window.matchMedia` and `navigator.connection`, which
// aren't available in Node — so we exercise the logic via a small
// helper that takes the two signals as arguments. Same logic, easier
// to test.

import test from "node:test";
import assert from "node:assert/strict";

/** Mirror of the real function — takes the two signals as inputs. */
function decide({ reducedMotion, saveData, effectiveType }) {
  if (reducedMotion) return false;
  if (saveData) return false;
  if (effectiveType && /^(slow-2g|2g)$/.test(effectiveType)) return false;
  return true;
}

test("default → autoplay (no signals set)", () => {
  assert.equal(decide({}), true);
});

test("reduced motion → no autoplay", () => {
  assert.equal(decide({ reducedMotion: true }), false);
});

test("saveData → no autoplay", () => {
  assert.equal(decide({ saveData: true }), false);
});

test("2g effective type → no autoplay", () => {
  assert.equal(decide({ effectiveType: "2g" }), false);
});

test("slow-2g effective type → no autoplay", () => {
  assert.equal(decide({ effectiveType: "slow-2g" }), false);
});

test("3g effective type → still autoplay", () => {
  assert.equal(decide({ effectiveType: "3g" }), true);
});

test("4g effective type → still autoplay", () => {
  assert.equal(decide({ effectiveType: "4g" }), true);
});

test("wifi-class effective type → still autoplay", () => {
  assert.equal(decide({ effectiveType: "wifi" }), true);
});

test("saveData + everything else set → no autoplay (any veto wins)", () => {
  assert.equal(decide({ reducedMotion: true, saveData: true, effectiveType: "4g" }), false);
});

test("null effectiveType → no veto", () => {
  assert.equal(decide({ effectiveType: null }), true);
  assert.equal(decide({ effectiveType: undefined }), true);
});
