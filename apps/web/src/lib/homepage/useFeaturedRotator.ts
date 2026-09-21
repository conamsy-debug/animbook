// Featured rotator hook.
//
// Cycles through a curated pool of books at a fixed interval. Used by:
//   - The homepage LivingCard + BeforeAfter (full version with pages)
//   - The library hero (book rotation only — no page fetcher)
//
// Behavior:
//   - Picks a stable rotation pool from `books` (top candidates by
//     cover + synopsis, capped at `poolSize`).
//   - Advances the rotation index every `intervalMs` while the page is
//     visible and the user hasn't requested reduced motion.
//   - When `pageFetcher` is provided, prefetches the pages for every
//     pool member once on mount, then resolves the "best" page per book
//     on demand so swaps have zero blank-flash.
//   - Cleans up timers and fetchers on unmount.

import { useEffect, useMemo, useRef, useState } from "react";
import type { BookSummary, PageRecord } from "@/lib/api";
import {
  DEFAULT_INTERVAL_MS,
  DEFAULT_POOL_SIZE,
  nextIndex,
  pickBestPage,
  pickFeaturedCandidates
} from "./featuredRotator";

export interface UseFeaturedRotatorOpts {
  /** Full list of books. The hook curates a stable pool from this. */
  books: BookSummary[];
  /** Swap interval in ms. Defaults to 60s. Pass 0 to disable auto-advance. */
  intervalMs?: number;
  /** Max number of books to cycle through. Defaults to 6. */
  poolSize?: number;
  /** Optional async loader for a book's pages. When provided, the
   *  hook prefetches pages for every pool member on mount and
   *  resolves the best page so crossfades have no blank-flash.
   *  When omitted, only `book` is populated (library-style usage). */
  pageFetcher?: (slug: string) => Promise<PageRecord[]>;
}

export interface RotatorResult {
  /** The currently shown book. Null only before the first candidate
   *  resolves, or when the book list is empty. */
  book: BookSummary | null;
  /** The current book's best page. Null until pages arrive, or when no
   *  fetcher was supplied. */
  page: PageRecord | null;
  /** Current rotation index. Useful for showing a tiny "1 of 6"
   *  progress dot if desired. */
  index: number;
  /** True only while the current book's pages are still being
   *  fetched. False when no fetcher was passed or pages have arrived. */
  loading: boolean;
}

export function useFeaturedRotator({
  books,
  intervalMs = DEFAULT_INTERVAL_MS,
  poolSize = DEFAULT_POOL_SIZE,
  pageFetcher
}: UseFeaturedRotatorOpts): RotatorResult {
  const pool = useMemo(() => pickFeaturedCandidates(books, poolSize), [books, poolSize]);

  const [index, setIndex] = useState(0);
  // We hold the index in a ref so the timer callback reads the latest
  // value without being part of its closure (closure capture is why
  // classic `setInterval` rotations tend to advance by 1 forever
  // instead of wrapping).
  const indexRef = useRef(0);

  // Read the latest fetcher through a ref so callers can pass an
  // unmemoized function without re-triggering the prefetch effect.
  const fetcherRef = useRef(pageFetcher);
  useEffect(() => {
    fetcherRef.current = pageFetcher;
  }, [pageFetcher]);

  // Reset the rotation cursor if the pool shrinks or empties.
  useEffect(() => {
    if (indexRef.current >= pool.length) {
      indexRef.current = 0;
      setIndex(0);
    }
  }, [pool.length]);

  // Rotation timer. Skipped on reduced-motion, when the pool has fewer
  // than two candidates (no point), and when intervalMs is 0/disabled.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!intervalMs || intervalMs <= 0) return;
    if (pool.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      indexRef.current = nextIndex(indexRef.current, pool.length);
      setIndex(indexRef.current);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [pool.length, intervalMs]);

  const currentBook = pool[index] ?? null;

  // Page cache + prefetch. We keep a ref of slugs we've already kicked
  // off (or completed) so the effect can be safely re-run when the
  // pool changes without spawning duplicate fetchers.
  const [pagesBySlug, setPagesBySlug] = useState<Record<string, PageRecord[]>>({});
  const fetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fetcher = fetcherRef.current;
    if (!fetcher || pool.length === 0) return;
    for (const book of pool) {
      if (fetchedRef.current.has(book.slug)) continue;
      // We optimistically claim the slug so a race with the
      // pagesBySlug snapshot below can't double-fetch, and so re-runs
      // while the fetch is in flight won't re-trigger it.
      fetchedRef.current.add(book.slug);
      const slug = book.slug;
      fetcher(slug)
        .then((pages) => {
          if (!Array.isArray(pages)) return;
          setPagesBySlug((prev) => (prev[slug] ? prev : { ...prev, [slug]: pages }));
        })
        .catch(() => {
          // Drop the claim on failure so a pool with a retry later
          // (e.g. after the API recovers) gets another shot.
          fetchedRef.current.delete(slug);
        });
    }
  }, [pool]);

  const pages = currentBook ? pagesBySlug[currentBook.slug] ?? null : null;
  const page = pages ? pickBestPage(pages) : null;
  const loading = Boolean(currentBook && !pages && fetcherRef.current);

  return { book: currentBook, page, index, loading };
}
