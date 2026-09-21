// Pure helpers for the new /library design. No React, no DOM, no
// fetches — easy to unit-test.

/** Detect "Series · Title" in a book title. The library uses this to
 *  build series rows when the BookSummary has no series field.
 *
 *  Rules (in order):
 *  1. The title must contain a middle-dot separator ("·") surrounded by
 *     optional whitespace.
 *  2. After splitting there must be exactly two non-empty parts.
 *  3. Neither part is allowed to be all-whitespace or absurdly long
 *     (defensive — protects against titles like "Cobalt · 42").
 *  4. A part that is purely punctuation / whitespace is rejected.
 *
 *  Returns `{ series, title }` when a series is detected, otherwise
 *  `{ series: null, title }` so callers can use the same shape.
 */
export function splitTitle(rawTitle: string): { series: string | null; title: string } {
  const title = (rawTitle ?? "").trim();
  if (!title.includes("·")) return { series: null, title };
  const parts = title.split("·").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length !== 2) return { series: null, title };
  const [series, rest] = parts as [string, string];
  if (series.length > 60 || rest.length > 120) return { series: null, title };
  // Reject if either side is purely punctuation.
  if (!/\p{L}|\p{N}/u.test(series) || !/\p{L}|\p{N}/u.test(rest)) return { series: null, title };
  return { series, title: rest };
}

/** In the current data model, `vertical === "ORIGINALS"` IS the
 *  AnimBook Originals imprint (see verticals.ts — the vertical is
 *  literally named "Originals" with promise "Made for the medium.").
 *  Books without that vertical are not AnimBook Originals. */
export function isOriginals(book: { vertical: string }): boolean {
  return book.vertical === "ORIGINALS";
}
