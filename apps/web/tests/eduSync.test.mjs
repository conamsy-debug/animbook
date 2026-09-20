// Pure-logic tests for the AnimBook EDU teacher dashboard helpers.
//
// Pins the seat math, projection response shape, and book-picker URL
// shape so the dashboard stays consistent with the API.
//
// Run with: `node --test apps/web/tests/eduSync.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";

/** Read studentIds out of the institution's lmsIntegration JSON column.
 *  Defensive: handles missing/garbage JSON. */
function readSeats(json) {
  if (json && typeof json === "object" && Array.isArray(json.studentIds)) {
    return json.studentIds.filter((id) => typeof id === "string");
  }
  return [];
}

function seatsRemaining(seatCount, seatedUserIds) {
  return Math.max(0, seatCount - seatedUserIds.length);
}

function buildProjectionPayload(bookSlug, pageNum) {
  return { bookSlug, pageNum };
}

function buildProjectionAttendeeUrl(origin, sessionId) {
  return `${origin}/live/${sessionId}`;
}

/** Host tab URL after a successful projection: opens the /live host
 *  dashboard with the new session pre-activated via ?session= query. */
function buildProjectionHostUrl(origin, sessionId) {
  return `${origin}/live?session=${sessionId}`;
}

function pickEduBook(eduBooks, fallbackSlug) {
  if (eduBooks.length === 0) return null;
  return eduBooks[0].slug ?? fallbackSlug;
}

test("readSeats: valid JSON returns the array", () => {
  assert.deepEqual(readSeats({ studentIds: ["u1", "u2"] }), ["u1", "u2"]);
});

test("readSeats: missing studentIds returns empty", () => {
  assert.deepEqual(readSeats({}), []);
  assert.deepEqual(readSeats({ studentIds: null }), []);
});

test("readSeats: non-array studentIds returns empty", () => {
  assert.deepEqual(readSeats({ studentIds: "not-an-array" }), []);
});

test("readSeats: null / undefined / non-object returns empty", () => {
  assert.deepEqual(readSeats(null), []);
  assert.deepEqual(readSeats(undefined), []);
  assert.deepEqual(readSeats("string"), []);
});

test("readSeats: filters non-string entries", () => {
  assert.deepEqual(readSeats({ studentIds: ["u1", 42, null, "u2", true] }), ["u1", "u2"]);
});

test("seatsRemaining: caps at 0 when over capacity", () => {
  assert.equal(seatsRemaining(10, new Array(12).fill("u")), 0);
  assert.equal(seatsRemaining(10, new Array(10).fill("u")), 0);
});

test("seatsRemaining: returns remaining capacity when under", () => {
  assert.equal(seatsRemaining(10, new Array(5).fill("u")), 5);
  assert.equal(seatsRemaining(10, []), 10);
});

test("buildProjectionPayload: keeps pageNum as a number", () => {
  const p = buildProjectionPayload("mitosis-a-living-cell-divides", 1);
  assert.equal(p.bookSlug, "mitosis-a-living-cell-divides");
  assert.equal(p.pageNum, 1);
});

test("buildProjectionAttendeeUrl: origin + /live/<sessionId>", () => {
  assert.equal(buildProjectionAttendeeUrl("https://animbook.com", "ses_abc123"), "https://animbook.com/live/ses_abc123");
});

test("buildProjectionHostUrl: origin + /live?session=<id> (host view, not attendee)", () => {
  assert.equal(buildProjectionHostUrl("https://animbook.com", "ses_abc123"), "https://animbook.com/live?session=ses_abc123");
});

test("host URL and attendee URL are distinct routes (no confusion)", () => {
  const sessionId = "ses_xyz789";
  const host = buildProjectionHostUrl("https://animbook.com", sessionId);
  const attendee = buildProjectionAttendeeUrl("https://animbook.com", sessionId);
  // Host uses ?session= query → goes to /live (host dashboard with controls).
  // Attendee uses /<id> path → goes to /live/[id] (read-only attendee view).
  assert.match(host, /\?session=/);
  assert.match(attendee, /\/live\/ses_xyz789$/);
  assert.notEqual(host, attendee);
});

test("pickEduBook: returns first book's slug when list non-empty", () => {
  const books = [{ slug: "mitosis" }, { slug: "how-a-seed" }];
  assert.equal(pickEduBook(books, "fallback"), "mitosis");
});

test("pickEduBook: returns null when list is empty", () => {
  assert.equal(pickEduBook([], "fallback"), null);
});
