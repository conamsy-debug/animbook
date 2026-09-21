// Tests for the OracleMarquee selection logic. Mirrors the lib logic
// inline (Node 24 can't resolve @/lib/* path aliases).

import { test } from "node:test";
import assert from "node:assert/strict";

// Mirror the type and the selector logic from apps/web/src/components/nextgen/OracleMarquee.tsx
function pickVerseSlug(books) {
  const verse = books.find((b) => b.vertical === "VERSE" && typeof b.slug === "string" && b.slug.length > 0);
  return verse ? verse.slug : null;
}

function buildLink(books) {
  const slug = pickVerseSlug(books);
  return slug ? `/read/${slug}?from=oracle` : null;
}

const SAMPLE = [
  { slug: "the-lagos-trilogy-1", vertical: "CONSUMER" },
  { slug: "verse-1", vertical: "VERSE" },
  { slug: "verse-2", vertical: "VERSE" },
  { slug: "kids-1", vertical: "KIDS" }
];

test("oracle marquee: picks the FIRST Verse book", () => {
  const slug = pickVerseSlug(SAMPLE);
  assert.equal(slug, "verse-1");
});

test("oracle marquee: skips non-Verse books even if listed first", () => {
  const reordered = [
    { slug: "kids-1", vertical: "KIDS" },
    { slug: "verse-1", vertical: "VERSE" }
  ];
  assert.equal(pickVerseSlug(reordered), "verse-1");
});

test("oracle marquee: returns null when no Verse book exists", () => {
  const noVerse = [
    { slug: "kids-1", vertical: "KIDS" },
    { slug: "consumer-1", vertical: "CONSUMER" }
  ];
  assert.equal(pickVerseSlug(noVerse), null);
});

test("oracle marquee: returns null for empty books list", () => {
  assert.equal(pickVerseSlug([]), null);
});

test("oracle marquee: skips Verse book with empty slug", () => {
  const withEmpty = [
    { slug: "", vertical: "VERSE" },
    { slug: "verse-2", vertical: "VERSE" }
  ];
  assert.equal(pickVerseSlug(withEmpty), "verse-2");
});

test("oracle marquee: link shape is /read/<slug>?from=oracle", () => {
  assert.equal(buildLink(SAMPLE), "/read/verse-1?from=oracle");
});

test("oracle marquee: no link when no Verse book (null, not undefined)", () => {
  const result = buildLink([]);
  assert.equal(result, null);
});

test("oracle marquee: handles 31-book books list without crashing (smoke)", () => {
  // 30 CONSUMER books, then one VERSE book at the end. The marquee
  // should pick the FIRST Verse book it finds — there is exactly one,
  // so it's the last item.
  const many = Array.from({ length: 30 }, (_, i) => ({
    slug: `book-${i}`,
    vertical: "CONSUMER"
  }));
  many.push({ slug: "real-verse", vertical: "VERSE" });
  assert.equal(buildLink(many), "/read/real-verse?from=oracle");
});
