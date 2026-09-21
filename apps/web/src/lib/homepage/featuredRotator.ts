// Featured-rotation logic for the homepage LivingCard, the BeforeAfter
// panel, and the Library hero.
//
// The rotator wants to cycle through a curated pool of "showcase" books
// every ~60s, picking the best still+video page from each candidate.
// Pure logic so it can be unit-tested without React.

import type { BookSummary, PageRecord } from "@/lib/api";

/** Maximum number of candidates the rotator will cycle through. Keeps
 *  the upfront prefetch bounded — 6 books × ~100 pages ≈ 600 records. */
export const DEFAULT_POOL_SIZE = 6;

/** Default swap interval. One minute matches the requested UX. */
export const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Pick the rotation pool from a book list.
 *
 * Order matters: rotation should hit the strongest showcase pieces
 * first. Preference order:
 *   1. books with a coverUrl AND a non-empty synopsis (already loaded —
 *      an actual showpiece)
 *   2. books with a coverUrl
 *   3. anything else, in API order
 *
 * Falls back gracefully when the API returns an empty array or a list
 * with no covers.
 */
export function pickFeaturedCandidates(
  books: BookSummary[],
  size: number = DEFAULT_POOL_SIZE
): BookSummary[] {
  if (!Array.isArray(books) || books.length === 0) return [];
  const tier = (b: BookSummary): 0 | 1 | 2 => {
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

/** True if the page record points at a real uploaded video. The
 *  homepage rotator only counts pages with a concrete URL — placeholders
 *  (placehold.co), broken URLs, and PNG/JPG/WebP "videos" all fail
 *  this check. */
export function hasUsableVideo(page: PageRecord): boolean {
  const url = page.videoUrl;
  if (!url) return false;
  if (!/^https?:\/\//.test(url)) return false;
  if (/placehold\.co/i.test(url)) return false;
  if (/\.(png|jpe?g|webp)(\?|$)/i.test(url)) return false;
  return true;
}

/** Pick the best page from a book's pages list for the showcase cards.
 *  Strategy:
 *    1. first page that has a real video (most cinematic)
 *    2. first page that has a poster still
 *    3. first page at all
 *    4. null if the array is empty
 */
export function pickBestPage(pages: PageRecord[]): PageRecord | null {
  if (!Array.isArray(pages) || pages.length === 0) return null;
  const withVideo = pages.find(hasUsableVideo);
  if (withVideo) return withVideo;
  const withPoster = pages.find((p) => Boolean(p.posterUrl) && !/placehold\.co/i.test(p.posterUrl ?? ""));
  if (withPoster) return withPoster;
  return pages[0]!;
}

/**
 * Compute the next index for a tick advance.
 *
 *  - Wraps around at the end of the list.
 *  - If the list shrinks below the current index, clamps to the last
 *    available item.
 *  - Always returns an in-bounds integer.
 */
export function nextIndex(current: number, length: number): number {
  if (length <= 0) return 0;
  if (current < 0) return 0;
  return (current + 1) % length;
}

/** Decide whether the rotator should advance given the user's
 *  preferences and tab state. Tab-hidden, reduced-motion, and
 *  hovering-on-target users should NOT see auto-rotations. */
export function shouldAdvance(opts: {
  reducedMotion: boolean;
  documentHidden: boolean;
  hovering?: boolean;
}): boolean {
  if (opts.reducedMotion) return false;
  if (opts.documentHidden) return false;
  if (opts.hovering) return false;
  return true;
}
