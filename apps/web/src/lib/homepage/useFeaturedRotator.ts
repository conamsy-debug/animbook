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
//   - Pauses when the cursor is over `pauseOnHoverRef.current`, when
//     `paused` is true, when the tab is hidden, or when prefers-
//     reduced-motion is on. Resumes from where it left off.
//   - When `pageFetcher` is provided, prefetches the pages for every
//     pool member once on mount, then resolves the "best" page per book
//     on demand so swaps have zero blank-flash.
//   - Cleans up timers and fetchers on unmount.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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
  /** Ref to a DOM element. When the cursor is over this element (or
   *  one of its CSS hover descendants), the rotation timer pauses;
   *  when the cursor leaves, the timer resumes from where it stopped.
   *  Checked via `el.matches(':hover')` so there's no listener to
   *  register or teardown. */
  pauseOnHoverRef?: RefObject<HTMLElement>;
  /** Force a paused state. Overrides everything else. Useful for
   *  tests, storybook, or callers that want their own pause logic
   *  (e.g. video open, modal visible). */
  paused?: boolean;
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
  pageFetcher,
  pauseOnHoverRef,
  paused
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

  // Read the latest pauseOnHoverRef through a ref so callers can
  // pass a stable-but-not-already-rendered ref object without
  // re-running the timer effect (the ref's `.current` is what we
  // actually check at tick time anyway).
  const hoverRefRef = useRef(pauseOnHoverRef);
  useEffect(() => {
    hoverRefRef.current = pauseOnHoverRef;
  }, [pauseOnHoverRef]);

  // Read the latest `paused` flag through a ref for the same reason.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Reset the rotation cursor if the pool shrinks or empties.
  useEffect(() => {
    if (indexRef.current >= pool.length) {
      indexRef.current = 0;
      setIndex(0);
    }
  }, [pool.length]);

  // Rotation timer. Skipped on reduced-motion, when the pool has fewer
  // than two candidates (no point), when explicitly paused, and when
  // intervalMs is 0/disabled. Reads the cursor hover state via the
  // CSS pseudo-class at tick time, which means there's nothing to
  // attach or detach for pause-on-hover — the timer keeps running at
  // its cadence, but the tick is a no-op while the target is hovered.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!intervalMs || intervalMs <= 0) return;
    if (pool.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (pausedRef.current) return;
      if (document.hidden) return;
      const target = hoverRefRef.current?.current;
      if (target && target.matches(":hover")) return;
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
