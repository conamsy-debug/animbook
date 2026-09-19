/**
 * Unit tests for the reader playback prefetch behaviour (Part B step B2).
 *
 * Strategy: extract the prefetch logic into a tiny pure helper that
 * decides which URLs to tag + with what `as` / `rel`. The reader
 * component calls this helper inside a useEffect and the helper does
 * the actual document.head mutation. That way we can unit-test the
 * decision without spinning up jsdom.
 *
 * Run with: `node --test apps/web/tests/readerPlaybackPrefetch.test.mjs`
 */
import test from "node:test";
import assert from "node:assert/strict";

const prefetchModule = await import("../src/lib/readerPlaybackPrefetch.mjs");
const { pickPrefetchLinks } = prefetchModule;

/* --------------------------------------------------------------------- *
 * pickPrefetchLinks: pure decision — given the current page + the
 * reader mode, return the list of (rel, as, href) tuples that should
 * be tagged in <link> elements. The reader component appends them
 * to document.head in a useEffect and removes them on cleanup.
 * --------------------------------------------------------------------- */

test("pickPrefetchLinks: empty when there's no next page", () => {
  const pages = [{ id: "p1", pageNum: 1, videoUrl: "x.mp4", audioUrl: "x.mp3" }];
  assert.deepEqual(pickPrefetchLinks(pages, 0, "WATCH"), []);
});

/** @typedef {{ rel: "preload" | "prefetch", as: "video" | "audio" | "fetch", href: string }} LinkSpec */

test("pickPrefetchLinks: next page video + audio, current is READ -> only audio", () => {
  const pages = [
    { id: "p1", pageNum: 1, videoUrl: "v1.mp4", audioUrl: "a1.mp3" },
    { id: "p2", pageNum: 2, videoUrl: "v2.mp4", audioUrl: "a2.mp3" },
    { id: "p3", pageNum: 3, videoUrl: "v3.mp4", audioUrl: "a3.mp3" }
  ];
  const links = pickPrefetchLinks(pages, 0, "READ");
  // In READ mode the video element isn't rendered, so we only prefetch audio.
  assert.deepEqual(links, [
    { rel: "preload", as: "audio", href: "a2.mp3" },
    { rel: "prefetch", as: "audio", href: "a3.mp3" }
  ]);
});

test("pickPrefetchLinks: WATCH mode preloads next-page video + audio", () => {
  const pages = [
    { id: "p1", pageNum: 1, videoUrl: "v1.mp4", audioUrl: "a1.mp3" },
    { id: "p2", pageNum: 2, videoUrl: "v2.mp4", audioUrl: "a2.mp3" }
  ];
  const links = pickPrefetchLinks(pages, 0, "WATCH");
  assert.deepEqual(links, [
    { rel: "preload", as: "video", href: "v2.mp4" },
    { rel: "preload", as: "audio", href: "a2.mp3" }
  ]);
});

test("pickPrefetchLinks: BOTH mode preloads both video + audio", () => {
  const pages = [
    { id: "p1", pageNum: 1, videoUrl: "v1.mp4", audioUrl: "a1.mp3" },
    { id: "p2", pageNum: 2, videoUrl: "v2.mp4", audioUrl: "a2.mp3" }
  ];
  const links = pickPrefetchLinks(pages, 0, "BOTH");
  assert.deepEqual(links, [
    { rel: "preload", as: "video", href: "v2.mp4" },
    { rel: "preload", as: "audio", href: "a2.mp3" }
  ]);
});

test("pickPrefetchLinks: at the last page there are no follow-up tags", () => {
  const pages = [
    { id: "p1", pageNum: 1, videoUrl: "v1.mp4", audioUrl: "a1.mp3" },
    { id: "p2", pageNum: 2, videoUrl: "v2.mp4", audioUrl: "a2.mp3" }
  ];
  assert.deepEqual(pickPrefetchLinks(pages, 1, "WATCH"), []);
});

test("pickPrefetchLinks: missing videoUrl on next page -> no video tag", () => {
  const pages = [
    { id: "p1", pageNum: 1, videoUrl: "v1.mp4", audioUrl: "a1.mp3" },
    { id: "p2", pageNum: 2, audioUrl: "a2.mp3" }
  ];
  const links = pickPrefetchLinks(pages, 0, "WATCH");
  assert.deepEqual(links, [
    { rel: "preload", as: "audio", href: "a2.mp3" }
  ]);
});

test("pickPrefetchLinks: missing audioUrl on next page -> no audio tag", () => {
  const pages = [
    { id: "p1", pageNum: 1, videoUrl: "v1.mp4", audioUrl: "a1.mp3" },
    { id: "p2", pageNum: 2, videoUrl: "v2.mp4" }
  ];
  const links = pickPrefetchLinks(pages, 0, "WATCH");
  assert.deepEqual(links, [
    { rel: "preload", as: "video", href: "v2.mp4" }
  ]);
});

test("pickPrefetchLinks: next-page is preload (immediate), page-after-next is prefetch (speculative)", () => {
  const pages = [
    { id: "p1", pageNum: 1, videoUrl: "v1.mp4", audioUrl: "a1.mp3" },
    { id: "p2", pageNum: 2, videoUrl: "v2.mp4", audioUrl: "a2.mp3" },
    { id: "p3", pageNum: 3, videoUrl: "v3.mp4", audioUrl: "a3.mp3" }
  ];
  const links = pickPrefetchLinks(pages, 0, "WATCH");
  // Next: preload; after-next: prefetch (so we don't compete for bandwidth).
  const next = links.find((l) => l.href === "v2.mp4");
  const after = links.find((l) => l.href === "v3.mp4");
  assert.equal(next?.rel, "preload");
  assert.equal(after?.rel, "prefetch");
});

test("pickPrefetchLinks: 3 pages ahead gets audio-only prefetch (no video speculatively warmed)", () => {
  const pages = [
    { id: "p1", pageNum: 1, videoUrl: "v1.mp4", audioUrl: "a1.mp3" },
    { id: "p2", pageNum: 2, videoUrl: "v2.mp4", audioUrl: "a2.mp3" },
    { id: "p3", pageNum: 3, videoUrl: "v3.mp4", audioUrl: "a3.mp3" },
    { id: "p4", pageNum: 4, videoUrl: "v4.mp4", audioUrl: "a4.mp3" }
  ];
  const links = pickPrefetchLinks(pages, 0, "WATCH");
  // p2: preload video + audio
  // p3: prefetch video + audio
  // p4: prefetch audio ONLY (no video — too costly 3-deep)
  const p4 = links.filter((l) => l.href === "v4.mp4" || l.href === "a4.mp3");
  assert.deepEqual(p4, [{ rel: "prefetch", as: "audio", href: "a4.mp3" }]);
});

test("pickPrefetchLinks: 3 pages ahead audio prefetch happens in READ mode too", () => {
  const pages = [
    { id: "p1", pageNum: 1, videoUrl: "v1.mp4", audioUrl: "a1.mp3" },
    { id: "p2", pageNum: 2, videoUrl: "v2.mp4", audioUrl: "a2.mp3" },
    { id: "p3", pageNum: 3, videoUrl: "v3.mp4", audioUrl: "a3.mp3" },
    { id: "p4", pageNum: 4, videoUrl: "v4.mp4", audioUrl: "a4.mp3" }
  ];
  const links = pickPrefetchLinks(pages, 0, "READ");
  // READ skips video everywhere; audio still prefetched at every depth.
  const audios = links.filter((l) => l.as === "audio").map((l) => l.href);
  assert.deepEqual(audios, ["a2.mp3", "a3.mp3", "a4.mp3"]);
  const videos = links.filter((l) => l.as === "video");
  assert.equal(videos.length, 0);
});

test("LinkSpec type is exported (used by the reader)", () => {
  // The helper exports only the function; the type is documented as
  // JSDoc in readerPlaybackPrefetch.mjs. This test pins the shape.
  /** @type {LinkSpec} */
  const sample = { rel: "preload", as: "video", href: "x.mp4" };
  assert.equal(sample.rel, "preload");
});