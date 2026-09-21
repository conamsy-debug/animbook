// Pure-logic helpers for deriving the cinematic row layout from a flat
// list of books. No React, no DOM — easy to unit-test.

import type { BookSummary } from "@/lib/api";
import { splitTitle, isOriginals } from "@/lib/library/series";
import { verticalById } from "@/lib/verticals";

export type RowKind = "originals" | "series" | "vertical";

export interface LibraryRow {
  /** Stable id used as React key + DOM id. */
  id: string;
  /** Display title ("AnimBook Originals", "Lagos Nights", "Kids"). */
  title: string;
  /** Short label used for "Explore all" → applies the matching filter. */
  filterLabel: string;
  /** What kind of row this is — drives what filter the link applies. */
  kind: RowKind;
  /** Optional series name when kind === "series". */
  series?: string;
  /** Books to render in this row, in stable order. */
  books: BookSummary[];
}

export interface DeriveRowsInput {
  books: BookSummary[];
  /** Maximum books per row. Brief says "up to about 12 cards". */
  maxPerRow?: number;
}

/** Build the row list for the cinematic library.
 *
 *  Order:
 *    1. AnimBook Originals (vertical === "ORIGINALS")
 *    2. Series rows (one per series that has ≥ 2 books)
 *    3. One row per vertical (skipped if zero books)
 *  Each row may appear in more than one row (intended, per the brief).
 *  Rows with zero books are skipped entirely.
 *  Vertical rows are ordered by count desc, label asc as tie-break.
 */
export function deriveRows(input: DeriveRowsInput): LibraryRow[] {
  const { books, maxPerRow = 12 } = input;
  const rows: LibraryRow[] = [];

  // 1) AnimBook Originals.
  const originals = books.filter(isOriginals);
  if (originals.length > 0) {
    rows.push({
      id: "row-originals",
      title: "AnimBook Originals",
      filterLabel: "Originals",
      kind: "originals",
      books: originals.slice(0, maxPerRow)
    });
  }

  // 2) Series rows — group books that have a detected series, only
  //    groups with ≥ 2 books become a row (the brief says "when two or
  //    more books share a series name, one row per series").
  const bySeries = new Map<string, BookSummary[]>();
  for (const book of books) {
    const { series } = splitTitle(book.title);
    if (!series) continue;
    const list = bySeries.get(series) ?? [];
    list.push(book);
    bySeries.set(series, list);
  }
  const seriesEntries = [...bySeries.entries()]
    .filter(([, list]) => list.length >= 2)
    // Largest series first, then alphabetical.
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [series, list] of seriesEntries) {
    rows.push({
      id: `row-series-${series}`,
      title: series,
      filterLabel: series,
      kind: "series",
      series,
      books: list.slice(0, maxPerRow)
    });
  }

  // 3) Vertical rows — one per vertical with at least one book.
  //    Order: count desc, then label asc as tie-break.
  const byVertical = new Map<string, BookSummary[]>();
  for (const book of books) {
    const list = byVertical.get(book.vertical) ?? [];
    list.push(book);
    byVertical.set(book.vertical, list);
  }
  const verticalEntries = [...byVertical.entries()]
    .filter(([, list]) => list.length > 0)
    .sort((a, b) => {
      const cmp = b[1].length - a[1].length;
      if (cmp !== 0) return cmp;
      const al = verticalById(a[0])?.label ?? a[0];
      const bl = verticalById(b[0])?.label ?? b[0];
      return al.localeCompare(bl);
    });
  for (const [verticalId, list] of verticalEntries) {
    const meta = verticalById(verticalId);
    const title = meta?.label ?? verticalId;
    rows.push({
      id: `row-vertical-${verticalId}`,
      title,
      filterLabel: title,
      kind: "vertical",
      books: list.slice(0, maxPerRow)
    });
  }

  return rows;
}
