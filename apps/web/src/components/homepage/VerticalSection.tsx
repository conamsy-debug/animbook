import { useMemo, useState } from "react";
import Link from "next/link";
import type { BookSummary } from "@/lib/api";
import { VERTICALS } from "@/lib/verticals";
import { VerticalCard } from "./VerticalCard";

interface Props {
  books: BookSummary[];
  loading: boolean;
}

/**
 * VerticalSection — twelve vertical cards in a 4-col grid.
 *
 * Hovering or focusing a card spreads its fan AND tints the section
 * background with the vertical's color at 20% alpha. The tint is
 * masked with a radial gradient so it fades toward the edges.
 */
export function VerticalSection({ books, loading }: Props) {
  // Index the books by vertical for fast lookup. Done once per render.
  const byVertical = useMemo(() => {
    const map = new Map<string, BookSummary[]>();
    for (const b of books) {
      const list = map.get(b.vertical) ?? [];
      list.push(b);
      map.set(b.vertical, list);
    }
    return map;
  }, [books]);

  // Currently-hovered vertical id. Pointer devices only (the CSS uses
  // :hover to drive the visual, so the JS state is just an extra layer
  // for the glow color). Touch / keyboard users still see the fan on
  // :focus-within but no glow (per the brief).
  const [hovered, setHovered] = useState<string | null>(null);
  const hoveredAccent = useMemo(() => {
    if (!hovered) return null;
    return VERTICALS.find((v) => v.id === hovered)?.accent ?? null;
  }, [hovered]);

  return (
    <section className="home-vsec" aria-labelledby="home-vsec-heading">
      <div
        className="home-glow"
        style={hoveredAccent ? { backgroundColor: `${hoveredAccent}33` } : undefined}
        aria-hidden
      />
      <div className="home-vsec-inner">
        <header className="home-vhead">
          <h2 id="home-vsec-heading" className="home-vh">Explore twelve verticals</h2>
          <Link href="/library" className="home-vall">
            All books
            <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </header>
        <div
          className="home-vgrid"
          onMouseLeave={() => setHovered(null)}
        >
          {VERTICALS.map((v) => {
            const list = byVertical.get(v.id) ?? [];
            const n = list.length;
            return (
              <div
                key={v.id}
                onMouseEnter={() => {
                  if (window.matchMedia("(hover: hover)").matches) setHovered(v.id);
                }}
              >
                <VerticalCard vertical={v} books={list} count={loading ? 0 : n} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
