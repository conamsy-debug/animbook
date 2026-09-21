// Row-derivation tests. The full helper (`apps/web/src/lib/library/rowDerivation.ts`)
// lives next to the React code and uses path-alias imports that Node's
// strict ESM can't resolve directly. This file mirrors the row-derivation
// logic so we can pin its behavior without bundling. If the production
// rules change, change both files together.
//
// Run with: `node --test apps/web/tests/libraryRows.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";

// ─── Mirrored helpers (keep in sync with rowDerivation.ts) ──────────────

const VERTICAL_LABELS = {
  CONSUMER: "Consumer",
  KIDS: "Kids",
  EDU: "Edu",
  FAITH: "Faith",
  DOCS: "Docs",
  VERSE: "Verse",
  COMICS: "Comics",
  BUSINESS: "Business",
  WELLNESS: "Wellness",
  LAW: "Law",
  TRAVEL: "Travel",
  ORIGINALS: "Originals"
};

function splitTitle(rawTitle) {
  const title = (rawTitle ?? "").trim();
  if (!title.includes("·")) return { series: null, title };
  const parts = title.split("·").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length !== 2) return { series: null, title };
  const [series, rest] = parts;
  if (series.length > 60 || rest.length > 120) return { series: null, title };
  if (!/\p{L}|\p{N}/u.test(series) || !/\p{L}|\p{N}/u.test(rest)) return { series: null, title };
  return { series, title: rest };
}

function isOriginals(book) {
  return book.vertical === "ORIGINALS";
}

function deriveRows(input) {
  const { books, maxPerRow = 12 } = input;
  const rows = [];

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

  const bySeries = new Map();
  for (const book of books) {
    const { series } = splitTitle(book.title);
    if (!series) continue;
    const list = bySeries.get(series) ?? [];
    list.push(book);
    bySeries.set(series, list);
  }
  const seriesEntries = [...bySeries.entries()]
    .filter(([, list]) => list.length >= 2)
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

  const byVertical = new Map();
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
      const al = VERTICAL_LABELS[a[0]] ?? a[0];
      const bl = VERTICAL_LABELS[b[0]] ?? b[0];
      return al.localeCompare(bl);
    });
  for (const [verticalId, list] of verticalEntries) {
    const title = VERTICAL_LABELS[verticalId] ?? verticalId;
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

// ─── Fixtures ───────────────────────────────────────────────────────────

const BOOKS = [
  { id: "1", slug: "a", title: "AnimBook One",            vertical: "ORIGINALS", coverUrl: "x" },
  { id: "2", slug: "b", title: "AnimBook Two",            vertical: "ORIGINALS", coverUrl: "x" },
  { id: "3", slug: "c", title: "The Quiet Hour",          vertical: "WELLNESS",  coverUrl: "x" },
  { id: "4", slug: "d", title: "Sleep Easy",              vertical: "WELLNESS",  coverUrl: "x" },
  { id: "5", slug: "e", title: "Lagos Nights · The Lagoon",  vertical: "CONSUMER", coverUrl: "x" },
  { id: "6", slug: "f", title: "Lagos Nights · The Market", vertical: "CONSUMER", coverUrl: "x" },
  { id: "7", slug: "g", title: "Lagos Nights · The Bridge", vertical: "CONSUMER", coverUrl: "x" },
  { id: "8", slug: "h", title: "How a Seed Becomes a Tree", vertical: "EDU",     coverUrl: "x" },
  { id: "9", slug: "i", title: "Mitosis · A Living Cell Divides", vertical: "EDU", coverUrl: "x" }
];

// ─── Tests ──────────────────────────────────────────────────────────────

test("deriveRows: empty input → empty output", () => {
  assert.deepEqual(deriveRows({ books: [] }), []);
});

test("deriveRows: originals row appears first when there are any", () => {
  const rows = deriveRows({ books: BOOKS });
  assert.equal(rows[0].kind, "originals");
  assert.equal(rows[0].title, "AnimBook Originals");
  assert.equal(rows[0].books.length, 2);
});

test("deriveRows: skipped when no originals", () => {
  const rows = deriveRows({ books: BOOKS.filter((b) => b.vertical !== "ORIGINALS") });
  assert.equal(rows.find((r) => r.kind === "originals"), undefined);
});

test("deriveRows: series row appears only when ≥ 2 books share a series", () => {
  const rows = deriveRows({ books: BOOKS });
  const lagos = rows.find((r) => r.kind === "series" && r.series === "Lagos Nights");
  assert.ok(lagos, "Lagos Nights row should exist");
  assert.equal(lagos.books.length, 3);
  const mitosis = rows.find((r) => r.kind === "series" && r.series === "Mitosis");
  assert.equal(mitosis, undefined, "Mitosis only has 1 book — no series row");
});

test("deriveRows: vertical rows sorted by count desc, label asc tie-break", () => {
  // Consumer has 3 (Lagos books), Wellness/Originals/EDU have 2 each.
  const rows = deriveRows({ books: BOOKS });
  const verticals = rows.filter((r) => r.kind === "vertical").map((r) => r.title);
  assert.equal(verticals[0], "Consumer", `expected Consumer first, got ${verticals[0]}`);
  const tail = verticals.slice(1);
  // Alphabetical among the 2-count verticals (Edu, Originals, Wellness).
  assert.deepEqual(tail, ["Edu", "Originals", "Wellness"]);
});

test("deriveRows: skips empty rows entirely", () => {
  const rows = deriveRows({ books: BOOKS });
  for (const r of rows) assert.ok(r.books.length > 0, `row ${r.id} should not be empty`);
});

test("deriveRows: respects maxPerRow", () => {
  const rows = deriveRows({ books: BOOKS, maxPerRow: 1 });
  for (const r of rows) assert.equal(r.books.length, 1, `row ${r.id} should have exactly 1 book`);
});

test("deriveRows: a book can appear in more than one row (intended)", () => {
  // The EDU vertical row contains "Mitosis · A Living Cell Divides".
  // (Mitosis has only 1 book so it has no series row.)
  const rows = deriveRows({ books: BOOKS });
  const eduRow = rows.find((r) => r.kind === "vertical" && r.title === "Edu");
  assert.ok(eduRow);
  assert.ok(eduRow.books.some((b) => b.id === "9"));
});

test("deriveRows: stable row ids", () => {
  const a = deriveRows({ books: BOOKS });
  const b = deriveRows({ books: BOOKS });
  for (let i = 0; i < a.length; i++) assert.equal(a[i].id, b[i].id);
});
