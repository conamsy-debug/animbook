/**
 * Reader playback prefetch decision (Part B step B2).
 *
 * Pure helper — the reader component calls this from a useEffect with
 * the current page index + the full page list + the reader mode. It
 * returns a list of `<link rel="preload" | "prefetch" as="..." href>` tuples
 * that the caller inserts into `document.head` (and removes on cleanup).
 *
 * Lives in .mjs (plain ES module) so the unit test in
 * `apps/web/tests/readerPlaybackPrefetch.test.mjs` can import it
 * directly with `node --test`. The Next.js reader imports it via
 * NodeNext's `.mjs` resolution.
 *
 * Decisions:
 *   - next page (i + 1): `rel="preload"` for video + audio — warming the
 *     decoder is worth the bandwidth because the reader is almost
 *     certainly going to flip here.
 *   - page after next (i + 2): `rel="prefetch"` for video + audio —
 *     speculative; only loaded if the browser has spare bandwidth.
 *   - 3 pages ahead (i + 3): `rel="prefetch"` for audio only. A 5-10 MB
 *     MP4 is too costly to speculatively warm three pages deep; the
 *     ~100-300 KB audio fetch is cheap and covers talky books where the
 *     reader is moving fast through the page stream.
 *   - In READ mode the video element isn't rendered, so we skip the
 *     video tag at every depth — preloading a clip nobody watches is
 *     wasted bytes. Audio is preloaded regardless of mode; even in READ
 *     mode the reader may press Play at any moment.
 */

/**
 * @typedef {{ rel: "preload" | "prefetch", as: "video" | "audio" | "fetch", href: string }} LinkSpec
 */

/**
 * @param {Array<{ id: string, pageNum: number, videoUrl?: string | null, audioUrl?: string | null }>} pages
 * @param {number} pageIndex
 * @param {string} readerMode  "READ" | "WATCH" | "BOTH" | any other label
 * @returns {LinkSpec[]}
 */
export function pickPrefetchLinks(pages, pageIndex, readerMode) {
  const next = pages[pageIndex + 1];
  const after = pages[pageIndex + 2];
  const way = pages[pageIndex + 3];
  const links = [];
  const skipVideo = readerMode === "READ";
  if (next?.videoUrl && !skipVideo) {
    links.push({ rel: "preload", as: "video", href: next.videoUrl });
  }
  if (next?.audioUrl) {
    links.push({ rel: "preload", as: "audio", href: next.audioUrl });
  }
  if (after?.videoUrl && !skipVideo) {
    links.push({ rel: "prefetch", as: "video", href: after.videoUrl });
  }
  if (after?.audioUrl) {
    links.push({ rel: "prefetch", as: "audio", href: after.audioUrl });
  }
  // 3-deep: audio-only. Video is too costly to speculatively warm three
  // pages ahead; audio fetch is cheap and covers talky books.
  if (way?.audioUrl) {
    links.push({ rel: "prefetch", as: "audio", href: way.audioUrl });
  }
  return links;
}
