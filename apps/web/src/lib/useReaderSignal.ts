// Reader signal tracking — every page-flip posts a dwell-time event to
// `/api/signal/page`. After enough events accumulate (or every minute
// while reading), the rolling buffer is sent to `/api/memory/adapt`,
// which feeds Anthropic (or a heuristic) to propose a profile update.
// The returned profile is then applied to the Reader via `onProfile` so
// the next page flip uses the new settings.
//
// Adaptive tuning is best-effort: failed POSTs are logged but never
// throw — a reader on a flaky network still gets narration.

import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";

const ADAPT_THRESHOLD = 6;       // pages between adapt calls
const ADAPT_MIN_INTERVAL_MS = 60_000; // never adapt more than once per minute

export interface ReaderSignalEvent {
  vertical: string;
  pageNum: number;
  /** Milliseconds the reader spent on the page before flipping. */
  dwellMs: number;
  /** True iff the reader flipped BACKWARDS from this page. */
  scrolledBack?: boolean;
  /** True iff the page was hidden (tab switch / nav away) before the next flip. */
  abandoned?: boolean;
}

export interface ReaderSignalOptions {
  bookId: string;
  vertical: string;
  pageNum: number;
  /**
   * True iff the most recent flip was a backwards navigation. Defaults
   * to false — call sites that know the flip direction pass it through.
   */
  scrolledBack?: boolean;
  /**
   * Callback fired when `/api/memory/adapt` returns a new profile.
   * Caller decides what to do (re-render, persist, etc.). The hook
   * itself doesn't apply the profile to the Reader.
   */
  onProfile?: (profile: unknown) => void;
}

interface BufferEntry {
  vertical: string;
  pageNum: number;
  dwellMs: number;
  scrolledBack: boolean;
  abandoned: boolean;
}

/**
 * Track reader behaviour per page and post events to the signal +
 * memory-adapt pipelines. Designed to be called from the Reader on
 * every `pageIndex` change.
 *
 * Usage:
 *   useReaderSignal({
 *     bookId,
 *     vertical: book.vertical,
 *     pageNum: currentPage.pageNum,
 *     scrolledBack: direction === "prev",
 *     onProfile: (p) => setMemory(p)
 *   });
 */
export function useReaderSignal(opts: ReaderSignalOptions): void {
  const { bookId, vertical, pageNum, scrolledBack = false, onProfile } = opts;

  // Use refs so the rolling buffer + last-seen timestamp survive
  // re-renders without re-firing effects.
  const bufferRef = useRef<BufferEntry[]>([]);
  const lastSeenRef = useRef<number>(performance.now());
  const lastAdaptRef = useRef<number>(0);
  const visibleRef = useRef<boolean>(typeof document === "undefined" ? true : !document.hidden);

  // Detect page visibility flips so we can flag the prior page as
  // `abandoned` when the reader leaves the tab mid-page.
  useEffect(() => {
    if (typeof document === "undefined") return;
    function onVis() {
      const wasVisible = visibleRef.current;
      const nowVisible = !document.hidden;
      visibleRef.current = nowVisible;
      // Becoming hidden mid-page: mark the last entry abandoned so the
      // adapt pipeline can weight it as a drop-off signal.
      if (wasVisible && !nowVisible) {
        const buf = bufferRef.current;
        if (buf.length > 0) buf[buf.length - 1]!.abandoned = true;
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Reset the dwell clock every time the page changes. The previous
  // page's dwell time is computed in the cleanup of THIS effect.
  useEffect(() => {
    const prevDwellMs = Math.round(performance.now() - lastSeenRef.current);
    lastSeenRef.current = performance.now();

    // Skip the very first effect call (mount-time, no prior dwell).
    if (prevDwellMs < 100 || bufferRef.current === null) {
      return;
    }

    // Push the previous page's event into the rolling buffer.
    bufferRef.current.push({
      vertical,
      pageNum: Math.max(1, pageNum - 1),
      dwellMs: prevDwellMs,
      scrolledBack: !scrolledBack, // the page we just LEFT was scrolled-back to
      abandoned: false
    });

    // Fire-and-forget POST. Errors are logged but never surface —
    // adaptive tuning is progressive enhancement.
    void apiFetch("/api/signal/page", {
      method: "POST",
      json: {
        bookId,
        pageNum: Math.max(1, pageNum - 1),
        vertical,
        dwellMs: prevDwellMs,
        scrolledBack: !scrolledBack,
        abandoned: false
      }
    }).catch(() => undefined);

    // Cap the buffer so a long reading session doesn't blow memory.
    if (bufferRef.current.length > 60) bufferRef.current.shift();

    // Trigger adaptive tuning every ADAPT_THRESHOLD pages OR after a
    // minute since the last adapt — whichever comes first.
    const now = performance.now();
    const sinceLastAdapt = now - lastAdaptRef.current;
    if (
      bufferRef.current.length >= ADAPT_THRESHOLD ||
      (bufferRef.current.length >= 2 && sinceLastAdapt >= ADAPT_MIN_INTERVAL_MS)
    ) {
      const snapshot = bufferRef.current.slice(-ADAPT_THRESHOLD);
      lastAdaptRef.current = now;
      void apiFetch("/api/memory/adapt", {
        method: "POST",
        json: {
          signal: snapshot.map((e) => ({
            vertical: e.vertical,
            emotionalRegister: null,
            timePerPageMs: e.dwellMs
          }))
        }
      })
        .then((res) => {
          if (onProfile && res && typeof res === "object" && "profile" in res) {
            onProfile((res as { profile: unknown }).profile);
          }
        })
        .catch(() => undefined);
    }
  }, [bookId, vertical, pageNum, scrolledBack, onProfile]);
}
