import { useEffect, useRef, useState } from "react";
import { ConstellationTile } from "./ConstellationTile";
import { NEXTGEN_FEATURES } from "@/lib/nextgen/features";

/**
 * ConstellationStrip — the 13 next-gen features as a horizontal
 * scroll track below the VerticalSection. Pure presentational; no
 * data fetched. The track uses content-visibility: auto so the
 * tiles don't render until they approach the viewport.
 *
 * Scroll arrows appear on hover of the track (touch devices: hidden)
 * and nudge the track by ~85% of its client width.
 */
export function ConstellationStrip() {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const updateArrows = () => {
    const el = trackRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

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
  }, []);

  const nudge = (direction: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    const delta = el.clientWidth * 0.85 * direction;
    el.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <section className="home-constellation" aria-labelledby="home-constellation-heading">
      <header className="home-constellation-head">
        <h2 id="home-constellation-heading" className="home-constellation-h">
          More than a book.
        </h2>
        <p className="home-constellation-meta">
          (13 ways AnimBook reads back.)
        </p>
      </header>

      <div className="home-constellation-track">
        <button
          type="button"
          className="home-constellation-arrow-btn home-constellation-arrow-prev"
          aria-label="Scroll constellation left"
          onClick={() => nudge(-1)}
          data-visible={canPrev ? "true" : "false"}
        >
          <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>

        <div className="home-constellation-track-inner" ref={trackRef} tabIndex={0}>
          {NEXTGEN_FEATURES.map((feature) => (
            <ConstellationTile key={feature.id} feature={feature} />
          ))}
        </div>

        <button
          type="button"
          className="home-constellation-arrow-btn home-constellation-arrow-next"
          aria-label="Scroll constellation right"
          onClick={() => nudge(1)}
          data-visible={canNext ? "true" : "false"}
        >
          <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </section>
  );
}
