// Hero book selection. Pure logic — easy to test.

import type { BookSummary } from "@/lib/api";

/** Pick the featured book for the hero.
 *  - Prefer the first book that has both coverUrl and a non-empty synopsis.
 *  - Fall back to the first book that has a coverUrl.
 *  - Fall back to the first book at all.
 *  - Returns null if the input is empty.
 *  "First" means the order the API returns books in (currently newest first).
 */
export function pickFeaturedBook(books: BookSummary[]): BookSummary | null {
  if (!Array.isArray(books) || books.length === 0) return null;
  const withCoverAndSynopsis = books.find((b) => Boolean(b.coverUrl) && Boolean((b.synopsis ?? "").trim()));
  if (withCoverAndSynopsis) return withCoverAndSynopsis;
  const withCover = books.find((b) => Boolean(b.coverUrl));
  if (withCover) return withCover;
  return books[0]!;
}
