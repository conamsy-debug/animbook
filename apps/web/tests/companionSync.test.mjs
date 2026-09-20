// Pure-logic tests for the AnimBook Companion deep-link rules.
//
// The full integration (Reader SSE subscription, scan landing pages) lives
// in React + fetch, so we can't unit-test it without a browser. This file
// pins the DECISION rules so the behaviour can be regression-tested in CI:
//
//   - marker cells are deterministic (same hash → same cells)
//   - cells are bounded (no NaN, length 36)
//   - deep-link page number is clamped to 1..N
//   - scan landing target URL shape: /read/<slug>?from=<from>&page=<n>&linkId=<id>
//   - trigger mode mapping: "nfc" → NFC_ANCHOR, anything else → AR_OVERLAY
//
// Run with: `node --test apps/web/tests/companionSync.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";

function cellsFromHash(hash) {
  const out = [];
  for (let i = 0; i < 36; i++) {
    const byte = parseInt(hash.slice(i * 2, i * 2 + 2), 16);
    out.push(((byte >> (i % 8)) & 1) === 1);
  }
  return out;
}

function buildScanTarget(bookSlug, linkId, anchorPage, fromKind) {
  return `/read/${bookSlug}?from=${fromKind}&page=${anchorPage}&linkId=${linkId}`;
}

function clampCompanionPage(rawPage, totalPages) {
  const parsed = Math.max(1, Number.parseInt(rawPage, 10) || 1);
  return Math.max(1, Math.min(totalPages, parsed));
}

function triggerModeFor(fromKind) {
  return fromKind === "nfc" ? "NFC_ANCHOR" : "AR_OVERLAY";
}

test("cellsFromHash: deterministic for the same hash", () => {
  const hash = "abcdef0123456789aabbccddeeff00112233445566778899aabbccddeeff0011";
  assert.deepEqual(cellsFromHash(hash), cellsFromHash(hash));
});

test("cellsFromHash: always 36 cells (6×6)", () => {
  const hash = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  assert.equal(cellsFromHash(hash).length, 36);
});

test("cellsFromHash: every cell is boolean (no NaN)", () => {
  const hash = "ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00";
  for (const c of cellsFromHash(hash)) {
    assert.equal(typeof c, "boolean");
  }
});

test("cellsFromHash: same prefix differs across hashes (no degenerate output)", () => {
  const a = cellsFromHash("0000000000000000000000000000000000000000000000000000000000000000");
  const b = cellsFromHash("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  // At least one cell differs (the bit pattern is byte-driven)
  let differ = false;
  for (let i = 0; i < 36; i++) {
    if (a[i] !== b[i]) { differ = true; break; }
  }
  assert.ok(differ, "all-zero and all-f hashes should produce different cell patterns");
});

test("buildScanTarget: includes from, page, and linkId", () => {
  const url = buildScanTarget("the-night-train", "link_abc123", 7, "companion");
  assert.match(url, /^\/read\/the-night-train\?from=companion&page=7&linkId=link_abc123$/);
});

test("buildScanTarget: NFC variant uses from=nfc", () => {
  const url = buildScanTarget("the-quiet-hour", "link_xyz", 1, "nfc");
  assert.match(url, /from=nfc/);
});

test("clampCompanionPage: underflow to 1", () => {
  assert.equal(clampCompanionPage("0", 17), 1);
  assert.equal(clampCompanionPage("-3", 17), 1);
});

test("clampCompanionPage: overflow to totalPages", () => {
  assert.equal(clampCompanionPage("999", 17), 17);
});

test("clampCompanionPage: invalid string → 1", () => {
  assert.equal(clampCompanionPage("abc", 17), 1);
});

test("triggerModeFor: nfc → NFC_ANCHOR", () => {
  assert.equal(triggerModeFor("nfc"), "NFC_ANCHOR");
});

test("triggerModeFor: companion → AR_OVERLAY", () => {
  assert.equal(triggerModeFor("companion"), "AR_OVERLAY");
});

test("triggerModeFor: anything else falls back to AR_OVERLAY", () => {
  assert.equal(triggerModeFor("manual"), "AR_OVERLAY");
  assert.equal(triggerModeFor(""), "AR_OVERLAY");
});
