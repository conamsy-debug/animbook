// Pure helpers for the homepage vertical card fan.

import type { BookSummary } from "@/lib/api";

/** One mini-cover in a vertical card's fan. Books without cover art
 *  are included with `coverUrl: null` — the caller renders the
 *  generated cover with only the vertical label / title. */
export interface FanCover {
  book: BookSummary;
  /** Whether the cover art is a real image URL or absent (null). */
  hasCover: boolean;
}

/**
 * Pick up to `max` newest books in a vertical that have cover art.
 * Books without cover art are returned AFTER the covers (they fill
 * empty slots if there aren't enough covers). Always returns at most
 * `max` entries. Returns an empty array if the vertical has no books.
 */
export function pickFanCovers(books: BookSummary[], verticalId: string, max = 3): FanCover[] {
  const inVertical = books.filter((b) => b.vertical === verticalId);
  if (inVertical.length === 0) return [];
  // Newest first — the books list is already loaded newest-first, so
  // a plain slice is enough. No new fetch, no client-side sort.
  const candidates = inVertical.slice(0, Math.max(max * 2, max + 2));
  const withCovers = candidates
    .filter((b) => Boolean(b.coverUrl))
    .slice(0, max);
  if (withCovers.length === max) return withCovers.map((b) => ({ book: b, hasCover: true }));
  // Top up with no-cover books (will render as generated frames).
  const remaining = candidates.filter((b) => !b.coverUrl).slice(0, max - withCovers.length);
  return [
    ...withCovers.map((b) => ({ book: b, hasCover: true })),
    ...remaining.map((b) => ({ book: b, hasCover: false }))
  ];
}

/**
 * Background tint for a vertical card. The brief gives 12 hex pairs
 * (label color / card background). For verticals the codebase already
 * defines (`lib/verticals.ts`), the accent is canonical — we mix it
 * toward ink (#070B12) at about 12% to derive the dark card surface.
 *
 * If a vertical is unknown to the codebase, fall back to a neutral
 * dark surface so the card still renders.
 */
export function verticalCardBackground(verticalAccent: string | undefined): string {
  if (!verticalAccent || !/^#[0-9a-fA-F]{6}$/.test(verticalAccent)) {
    return "#0D1420";
  }
  const ink = { r: 7, g: 11, b: 18 };
  const hex = verticalAccent.replace("#", "");
  const accent = {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
  // Mix 12% accent + 88% ink.
  const mix = (a: number, i: number) => Math.round(a * 0.12 + i * 0.88);
  const r = mix(accent.r, ink.r);
  const g = mix(accent.g, ink.g);
  const b = mix(accent.b, ink.b);
  return `rgb(${r}, ${g}, ${b})`;
}
