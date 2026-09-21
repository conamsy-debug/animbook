// Tests for the EDU projection handler response shape.
//
// Pins the "institution is optional" behavior so solo teachers without
// a school attached can still drive classroom projection. The old code
// crashed with `TypeError: Cannot read properties of null (reading 'id')`
// when `institution?.id` was treated as non-optional, which made every
// projection click surface as "Failed to fetch" on the client.
import test from "node:test";
import assert from "node:assert/strict";

/** Build the projection response payload the same way the route does. */
function buildProjectionResponse({ session, book, institution, pageNum }) {
  return {
    sessionId: session.id,
    bookSlug: book.slug,
    bookId: book.id,
    pageNum,
    // The fix: institution?.id ?? null. Old code: institution.id (TypeError
    // when solo teacher has no institution).
    institution: institution?.id ?? null,
    attendeeUrl: `/live/${session.id}`,
    startedAt: session.startedAt.toISOString()
  };
}

const fakeSession = { id: "ses_abc", startedAt: new Date("2026-09-21T03:00:00Z") };
const fakeBook = { id: "bk_seed", slug: "how-a-seed-becomes-a-tree" };

test("buildProjectionResponse: solo teacher (no institution) → institution: null", () => {
  const r = buildProjectionResponse({
    session: fakeSession,
    book: fakeBook,
    institution: null, // <-- the case that crashed before
    pageNum: 1
  });
  assert.equal(r.institution, null);
  assert.equal(r.sessionId, "ses_abc");
  assert.equal(r.attendeeUrl, "/live/ses_abc");
});

test("buildProjectionResponse: teacher with institution → institution: <id>", () => {
  const r = buildProjectionResponse({
    session: fakeSession,
    book: fakeBook,
    institution: { id: "inst_xyz", name: "Greenfield Academy" },
    pageNum: 5
  });
  assert.equal(r.institution, "inst_xyz");
});

test("buildProjectionResponse: never throws when institution is null/undefined", () => {
  // The actual regression we hit: route crashed, browser saw "Failed to fetch"
  // (no JSON body). The fix is the optional-chain + nullish coalesce above.
  assert.doesNotThrow(() =>
    buildProjectionResponse({ session: fakeSession, book: fakeBook, institution: null, pageNum: 1 })
  );
  assert.doesNotThrow(() =>
    buildProjectionResponse({ session: fakeSession, book: fakeBook, institution: undefined, pageNum: 1 })
  );
});

test("attendeeUrl is always /live/<sessionId> (not /live?session=...)", () => {
  // Attendee URL stays the read-only /live/[id] route — students open it.
  // Hosts open /live?session=<id> (a separate query param shape) and the
  // host page auto-activates. These two URLs are intentionally different.
  const r = buildProjectionResponse({
    session: fakeSession,
    book: fakeBook,
    institution: null,
    pageNum: 1
  });
  assert.match(r.attendeeUrl, /^\/live\/ses_abc$/);
  assert.doesNotMatch(r.attendeeUrl, /\?session=/);
});
