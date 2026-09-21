import { useCallback, useEffect, useRef, useState } from "react";
import { LibraryPosterCard } from "./LibraryPosterCard";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import type { LibraryRow as Row } from "@/lib/library/rowDerivation";

interface Props {
  row: Row;
  /** Apply the row's filter via the library's URL mechanism. */
  onExplore: (filter: { kind: Row["kind"]; series?: string; filterLabel: string }) => void;
}

/**
 * LibraryRow — horizontal scrolling track of poster cards.
 *
 *  - Track has `scroll-snap-type: x proximity`, hidden scrollbar, 14px gaps
 *    between cards, and 30px vertical padding so scaled hover cards aren't
 *    clipped.
 *  - Left/right scroll arrows appear on row hover (pointer devices only);
 *    clicking scrolls by ~85% of the visible width.
 *  - The "Explore all" link is hidden until the row is hovered or focused.
 *  - Below the fold, rows use `content-visibility: auto` (CSS).
 */
export function LibraryRow({ row, onExplore }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  /** Refresh arrow visibility based on current scroll position. */
  const updateArrows = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanLeft(scrollLeft > 4);
    setCanRight(scrollLeft + clientWidth < scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, [updateArrows]);

  function nudge(direction: 1 | -1) {
    const el = trackRef.current;
    if (!el) return;
    const amount = Math.max(0, el.clientWidth * 0.85);
    el.scrollBy({ left: direction * amount, behavior: "smooth" });
  }

  return (
    <section className="lib-row" id={row.id} aria-label={row.title}>
      <header className="lib-rhead">
        <h2 className="lib-rtitle">{row.title}</h2>
        <button
          type="button"
          className="lib-all"
          onClick={() => onExplore({ kind: row.kind, series: row.series, filterLabel: row.filterLabel })}
        >
          Explore all <ChevronRightIcon width={14} height={14} />
        </button>
      </header>

      <div className="lib-rbody">
        {canLeft && (
          <button
            type="button"
            className="lib-arrow left"
            aria-label={`Scroll ${row.title} back`}
            onClick={() => nudge(-1)}
          >
            <ChevronLeftIcon />
          </button>
        )}
        {canRight && (
          <button
            type="button"
            className="lib-arrow right"
            aria-label={`Scroll ${row.title} forward`}
            onClick={() => nudge(1)}
          >
            <ChevronRightIcon />
          </button>
        )}

        <div className="lib-track" ref={trackRef} tabIndex={0}>
          {row.books.map((book) => (
            <LibraryPosterCard key={book.id} book={book} />
          ))}
        </div>
      </div>
    </section>
  );
}
