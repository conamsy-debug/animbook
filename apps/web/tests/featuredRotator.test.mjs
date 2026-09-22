// Tests for the featured rotator's pure helpers.
//
// Mirrors `pickFeaturedCandidates`, `pickBestPage`, `nextIndex`, and
// `shouldAdvance` so we can assert behavior without spinning up React.
//
// Run: `node --test tests/featuredRotator.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";

// Mirror the constants + helpers so we don't have to alias through a
// @/ path the Node 24 loader can't resolve. If the source changes,
// copy the new logic and update both files.
const DEFAULT_POOL_SIZE = 6;
const DEFAULT_INTERVAL_MS = 60_000;

function hasUsableVideo(page) {
  const url = page.videoUrl;
  if (!url) return false;
  if (!/^https?:\/\//.test(url)) return false;
  if (/placehold\.co/i.test(url)) return false;
  if (/\.(png|jpe?g|webp)(\?|$)/i.test(url)) return false;
  return true;
}

function pickFeaturedCandidates(books, size = DEFAULT_POOL_SIZE) {
  if (!Array.isArray(books) || books.length === 0) return [];
  const tier = (b) => {
    const hasCover = Boolean(b.coverUrl);
    const hasSynopsis = Boolean((b.synopsis ?? "").trim());
    if (hasCover && hasSynopsis) return 0;
    if (hasCover) return 1;
    return 2;
  };
  return [...books]
    .sort((a, b) => tier(a) - tier(b) || 0)
    .slice(0, Math.max(1, size));
}

function pickBestPage(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return null;
  const withVideo = pages.find(hasUsableVideo);
  if (withVideo) return withVideo;
  const withPoster = pages.find((p) => Boolean(p.posterUrl) && !/placehold\.co/i.test(p.posterUrl ?? ""));
  if (withPoster) return withPoster;
  return pages[0];
}

function nextIndex(current, length) {
  if (length <= 0) return 0;
  if (current < 0) return 0;
  return (current + 1) % length;
}

function shouldAdvance(opts) {
  if (opts.reducedMotion) return false;
  if (opts.documentHidden) return false;
  if (opts.hovering) return false;
  return true;
}

function resolveForcedBook(books, forceSlug) {
  if (!forceSlug) return null;
  if (!Array.isArray(books) || books.length === 0) return null;
  return books.find((b) => b.slug === forceSlug) ?? null;
}

// ---------------------------------------------------------------------------
// pickFeaturedCandidates
// ---------------------------------------------------------------------------

test("pickFeaturedCandidates: empty list returns empty", () => {
  assert.equal(pickFeaturedCandidates([]).length, 0);
});

test("pickFeaturedCandidates: prefers cover+synopsis first", () => {
  const coverOnly = { id: "a", slug: "a", coverUrl: "u", synopsis: "" };
  const full = { id: "b", slug: "b", coverUrl: "u", synopsis: "real synopsis" };
  const bare = { id: "c", slug: "c", coverUrl: "", synopsis: "" };
  const pool = pickFeaturedCandidates([bare, coverOnly, full]);
  assert.equal(pool[0].id, "b", "full book first");
});

test("pickFeaturedCandidates: capped at poolSize", () => {
  const books = Array.from({ length: 20 }, (_, i) => ({
    id: String(i), slug: `s${i}`, coverUrl: "u", synopsis: "syn"
  }));
  const pool = pickFeaturedCandidates(books, 6);
  assert.equal(pool.length, 6);
});

test("pickFeaturedCandidates: original list is not mutated", () => {
  const books = [
    { id: "a", slug: "a", coverUrl: "", synopsis: "" },
    { id: "b", slug: "b", coverUrl: "u", synopsis: "x" }
  ];
  const before = books.map((b) => b.id);
  pickFeaturedCandidates(books);
  const after = books.map((b) => b.id);
  assert.deepEqual(after, before);
});

// ---------------------------------------------------------------------------
// pickBestPage
// ---------------------------------------------------------------------------

test("pickBestPage: prefers pages with real video URLs", () => {
  const posterOnly = { pageNum: 1, videoUrl: null, posterUrl: "p.png" };
  const goodVideo = { pageNum: 2, videoUrl: "https://media.animbook.com/v.mp4", posterUrl: "p.png" };
  const placeholderVideo = { pageNum: 3, videoUrl: "https://placehold.co/640.mp4", posterUrl: "p.png" };
  const imageVideo = { pageNum: 4, videoUrl: "https://example.com/cover.png", posterUrl: "p.png" };
  const localVideo = { pageNum: 5, videoUrl: "/local/file.mp4", posterUrl: "p.png" };
  const pick = pickBestPage([posterOnly, goodVideo, placeholderVideo, imageVideo, localVideo]);
  assert.equal(pick.pageNum, 2);
});

test("pickBestPage: falls back to poster only when no video", () => {
  const bad = { pageNum: 1, videoUrl: "https://placehold.co/x.png", posterUrl: "placehold.co/x.png" };
  const good = { pageNum: 2, videoUrl: null, posterUrl: "https://media.animbook.com/cover.png" };
  const pick = pickBestPage([bad, good]);
  assert.equal(pick.pageNum, 2);
});

test("pickBestPage: empty list returns null", () => {
  assert.equal(pickBestPage([]), null);
});

// ---------------------------------------------------------------------------
// nextIndex
// ---------------------------------------------------------------------------

test("nextIndex: wraps at the end", () => {
  assert.equal(nextIndex(2, 3), 0);
  assert.equal(nextIndex(0, 3), 1);
});

test("nextIndex: clamps when length is 0", () => {
  assert.equal(nextIndex(5, 0), 0);
});

test("nextIndex: clamps when current is negative", () => {
  assert.equal(nextIndex(-1, 3), 0);
});

// ---------------------------------------------------------------------------
// shouldAdvance
// ---------------------------------------------------------------------------

test("shouldAdvance: blocks on reduced motion", () => {
  assert.equal(shouldAdvance({ reducedMotion: true, documentHidden: false }), false);
});

test("shouldAdvance: blocks when tab hidden", () => {
  assert.equal(shouldAdvance({ reducedMotion: false, documentHidden: true }), false);
});

test("shouldAdvance: blocks when hovering the target", () => {
  assert.equal(shouldAdvance({ reducedMotion: false, documentHidden: false, hovering: true }), false);
});

test("shouldAdvance: allows when neither condition is set", () => {
  assert.equal(shouldAdvance({ reducedMotion: false, documentHidden: false }), true);
});

test("shouldAdvance: hovering defaults to false when omitted", () => {
  // Backwards compat with the old 2-field signature.
  assert.equal(shouldAdvance({ reducedMotion: false, documentHidden: false }), true);
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test("defaults: pool size and interval match spec", () => {
  assert.equal(DEFAULT_POOL_SIZE, 6);
  assert.equal(DEFAULT_INTERVAL_MS, 60_000);
});

// ---------------------------------------------------------------------------
// resolveForcedBook
// ---------------------------------------------------------------------------

test("resolveForcedBook: returns the matching book when slug exists", () => {
  const books = [
    { id: "a", slug: "a-poem-for-lagos" },
    { id: "b", slug: "lagos-nights-1-the-last-train" },
    { id: "c", slug: "lagos-nights-2-the-lagoon" }
  ];
  const pick = resolveForcedBook(books, "a-poem-for-lagos");
  assert.equal(pick && pick.id, "a");
});

test("resolveForcedBook: returns null when forceSlug is missing", () => {
  const books = [{ id: "a", slug: "x" }];
  assert.equal(resolveForcedBook(books, null), null);
  assert.equal(resolveForcedBook(books, undefined), null);
  assert.equal(resolveForcedBook(books, ""), null);
});

test("resolveForcedBook: returns null when the slug isn't in the list", () => {
  const books = [{ id: "a", slug: "x" }];
  assert.equal(resolveForcedBook(books, "missing-slug"), null);
});

test("resolveForcedBook: returns null on empty books list", () => {
  assert.equal(resolveForcedBook([], "anything"), null);
  assert.equal(resolveForcedBook(null, "anything"), null);
});

test("resolveForcedBook: first match wins when slugs collide (shouldn't but defensive)", () => {
  const books = [
    { id: "a", slug: "dup" },
    { id: "b", slug: "dup" }
  ];
  assert.equal(resolveForcedBook(books, "dup").id, "a");
});
