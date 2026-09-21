// Tests for the hero book selection. Mirrors the helper in
// apps/web/src/lib/library/heroSelection.ts. Keep both in sync.
import test from "node:test";
import assert from "node:assert/strict";

function pickFeaturedBook(books) {
  if (!Array.isArray(books) || books.length === 0) return null;
  const withCoverAndSynopsis = books.find((b) => Boolean(b.coverUrl) && Boolean((b.synopsis ?? "").trim()));
  if (withCoverAndSynopsis) return withCoverAndSynopsis;
  const withCover = books.find((b) => Boolean(b.coverUrl));
  if (withCover) return withCover;
  return books[0];
}

const A = { id: "a", slug: "a", title: "A", coverUrl: "x", synopsis: "An A book." };
const B = { id: "b", slug: "b", title: "B", coverUrl: "x", synopsis: "" };
const C = { id: "c", slug: "c", title: "C", coverUrl: null, synopsis: "A C book with a description." };
const D = { id: "d", slug: "d", title: "D", coverUrl: null, synopsis: "" };

test("pickFeaturedBook: empty input → null", () => {
  assert.equal(pickFeaturedBook([]), null);
  assert.equal(pickFeaturedBook(null), null);
  assert.equal(pickFeaturedBook(undefined), null);
});

test("pickFeaturedBook: prefers cover + synopsis", () => {
  // Order: cover+synopsis (A) > cover only (B) > synopsis only (C) > neither (D)
  const chosen = pickFeaturedBook([D, C, B, A]);
  assert.equal(chosen.id, "a");
});

test("pickFeaturedBook: first in list wins among ties", () => {
  const a1 = { ...A, id: "a1" };
  const a2 = { ...A, id: "a2" };
  const chosen = pickFeaturedBook([a1, a2]);
  assert.equal(chosen.id, "a1");
});

test("pickFeaturedBook: falls back to cover-only when no synopsis matches", () => {
  const chosen = pickFeaturedBook([B, C, D]);
  assert.equal(chosen.id, "b");
});

// Add `weird` to the available fixtures used by the next test.
const weird = { id: "e", slug: "e", title: "E", coverUrl: "x", synopsis: "   \t\n  " };

test("pickFeaturedBook: falls back to first book when nothing has a cover", () => {
  const chosen = pickFeaturedBook([C, D]);
  assert.equal(chosen.id, "c");
});

test("pickFeaturedBook: synopsis with only whitespace is treated as empty", () => {
  const weird = { id: "e", slug: "e", title: "E", coverUrl: "x", synopsis: "   \t\n  " };
  // A has a real synopsis → wins, even though weird appears first.
  const chosen = pickFeaturedBook([weird, A]);
  assert.equal(chosen.id, "a");
});

test("pickFeaturedBook: whitespace-only synopsis is its own fallback when nothing else qualifies", () => {
  // No book has a real synopsis. weird has cover + whitespace synopsis.
  // It must still be picked as the best "cover" candidate before the
  // no-cover fallback.
  const chosen = pickFeaturedBook([weird, C]);
  assert.equal(chosen.id, "e");
});
