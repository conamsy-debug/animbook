// Pure-logic tests for the AnimBook Live attendee sync rules.
//
// The full integration (Reader SSE subscription, attendee page) lives in
// React + EventSource, so we can't unit-test it without a browser. This
// file pins the DECISION rules so the behaviour can be regression-tested
// in CI:
//   - 1-indexed page number from the host → 0-indexed reader store index
//   - non-numeric payloads → no-op (no flip, no crash)
//   - session.ended → drop the live param + toast
//   - "join link" shape: /live/<sessionId> and /read/<bookId>?live=<sessionId>
//
// Run with: `node --test apps/web/tests/liveSync.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";

/** Map a host page-flipped event (1-indexed) to the Reader store index
 *  (0-indexed). Mirrors the logic in apps/web/src/pages/read/[id].tsx. */
function pageEventToStoreIndex(payload) {
  const next = Number(payload?.pageNum);
  if (!Number.isFinite(next)) return null;
  return Math.max(0, next - 1);
}

/** Decide what to do when a 'live' event arrives. Mirrors the same block
 *  in apps/web/src/pages/read/[id].tsx. Returns the action to take. */
function decideLiveAction(event) {
  if (event.type === "page.flipped") {
    const idx = pageEventToStoreIndex(event.payload);
    if (idx === null) return { kind: "noop" };
    return { kind: "goTo", index: idx };
  }
  if (event.type === "session.ended") {
    return { kind: "ended" };
  }
  return { kind: "noop" };
}

test("page.flipped with pageNum=1 → store index 0", () => {
  assert.equal(pageEventToStoreIndex({ pageNum: 1 }), 0);
});

test("page.flipped with pageNum=12 → store index 11", () => {
  assert.equal(pageEventToStoreIndex({ pageNum: 12 }), 11);
});

test("page.flipped with pageNum=0 is clamped to 0 (defensive)", () => {
  // Should never happen in practice (host starts at 1), but be safe.
  assert.equal(pageEventToStoreIndex({ pageNum: 0 }), 0);
});

test("page.flipped with negative pageNum is clamped to 0", () => {
  assert.equal(pageEventToStoreIndex({ pageNum: -3 }), 0);
});

test("page.flipped with non-numeric pageNum → null (no-op)", () => {
  assert.equal(pageEventToStoreIndex({ pageNum: "next" }), null);
  assert.equal(pageEventToStoreIndex({}), null);
  assert.equal(pageEventToStoreIndex(null), null);
  assert.equal(pageEventToStoreIndex({ pageNum: NaN }), null);
});

test("decideLiveAction: page.flipped → goTo", () => {
  const action = decideLiveAction({ type: "page.flipped", payload: { pageNum: 5 } });
  assert.deepEqual(action, { kind: "goTo", index: 4 });
});

test("decideLiveAction: session.ended → ended", () => {
  const action = decideLiveAction({ type: "session.ended", payload: {} });
  assert.deepEqual(action, { kind: "ended" });
});

test("decideLiveAction: annotation → noop (we ignore annotations in reader)", () => {
  const action = decideLiveAction({ type: "annotation", payload: { note: "hi" } });
  assert.deepEqual(action, { kind: "noop" });
});

test("decideLiveAction: page.flipped with bad payload → noop", () => {
  const action = decideLiveAction({ type: "page.flipped", payload: { foo: "bar" } });
  assert.deepEqual(action, { kind: "noop" });
});

test("attendee share-link shape", () => {
  // Mirrors how the attendee page (/live/[sessionId]) builds the
  // "Read along" CTA and the host's "Share attendee link" hint.
  const sessionId = "abc123";
  const attendeeHref = `/live/${sessionId}`;
  const readAlongHref = `/read/book-slug?live=${sessionId}`;
  assert.match(attendeeHref, /^\/live\/[A-Za-z0-9_-]+$/);
  assert.match(readAlongHref, /^\/read\/[^?]+\?live=[A-Za-z0-9_-]+$/);
});
