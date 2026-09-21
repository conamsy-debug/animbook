// Pure-logic tests for the homepage fan-covers helper. Run with:
// `node --test apps/web/tests/homepageFanCovers.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";

function pickFanCovers(books, verticalId, max = 3) {
  const inVertical = books.filter((b) => b.vertical === verticalId);
  if (inVertical.length === 0) return [];
  const candidates = inVertical.slice(0, Math.max(max * 2, max + 2));
  const withCovers = candidates.filter((b) => Boolean(b.coverUrl)).slice(0, max);
  if (withCovers.length === max) return withCovers.map((b) => ({ book: b, hasCover: true }));
  const remaining = candidates.filter((b) => !b.coverUrl).slice(0, max - withCovers.length);
  return [
    ...withCovers.map((b) => ({ book: b, hasCover: true })),
    ...remaining.map((b) => ({ book: b, hasCover: false }))
  ];
}

function verticalCardBackground(accent) {
  if (!accent || !/^#[0-9a-fA-F]{6}$/.test(accent)) return "#0D1420";
  const ink = { r: 7, g: 11, b: 18 };
  const hex = accent.replace("#", "");
  const a = {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
  const mix = (x, i) => Math.round(x * 0.12 + i * 0.88);
  return `rgb(${mix(a.r, ink.r)}, ${mix(a.g, ink.g)}, ${mix(a.b, ink.b)})`;
}

const BOOKS = [
  { id: "1", title: "Quiet Hour",      slug: "qh",  vertical: "WELLNESS", coverUrl: "x1" },
  { id: "2", title: "Sleep Easy",      slug: "se",  vertical: "WELLNESS", coverUrl: "x2" },
  { id: "3", title: "Yoga Daily",      slug: "yd",  vertical: "WELLNESS", coverUrl: "x3" },
  { id: "4", title: "Morning Pages",   slug: "mp",  vertical: "WELLNESS", coverUrl: "x4" },
  { id: "5", title: "Mindful Walk",    slug: "mw",  vertical: "WELLNESS", coverUrl: null },
  { id: "6", title: "Deep Breath",     slug: "db",  vertical: "WELLNESS", coverUrl: null },
  { id: "7", title: "How a Seed",      slug: "hs",  vertical: "EDU",     coverUrl: "x1" },
  { id: "8", title: "Mitosis",         slug: "mi",  vertical: "EDU",     coverUrl: "x2" }
];

test("pickFanCovers: empty input → empty array", () => {
  assert.deepEqual(pickFanCovers([], "WELLNESS"), []);
});

test("pickFanCovers: unknown vertical → empty array", () => {
  assert.deepEqual(pickFanCovers(BOOKS, "FAITH"), []);
});

test("pickFanCovers: returns up to 3 covers, newest first", () => {
  const fan = pickFanCovers(BOOKS, "WELLNESS", 3);
  assert.equal(fan.length, 3);
  // Newest-first means the IDs should be 1, 2, 3 (in input order).
  assert.deepEqual(fan.map((f) => f.book.id), ["1", "2", "3"]);
  assert.ok(fan.every((f) => f.hasCover));
});

test("pickFanCovers: tops up with no-cover books when fewer than max covers", () => {
  // Remove covers from two books so only 2 with-cover remain in WELLNESS.
  const limited = BOOKS.map((b) => b.id === "3" || b.id === "4" ? { ...b, coverUrl: null } : b);
  const fan = pickFanCovers(limited, "WELLNESS", 3);
  assert.equal(fan.length, 3);
  assert.equal(fan.filter((f) => f.hasCover).length, 2);
  assert.equal(fan.filter((f) => !f.hasCover).length, 1);
});

test("pickFanCovers: one-book vertical returns that book", () => {
  const fan = pickFanCovers(BOOKS, "EDU", 3);
  assert.equal(fan.length, 2); // both EDU books
  assert.equal(fan[0].book.id, "7");
  assert.equal(fan[1].book.id, "8");
});

test("pickFanCovers: respects max", () => {
  const fan = pickFanCovers(BOOKS, "WELLNESS", 2);
  assert.equal(fan.length, 2);
});

test("pickFanCovers: all-no-cover vertical returns generated-frame fallback", () => {
  const noCovers = BOOKS.map((b) => b.vertical === "WELLNESS" ? { ...b, coverUrl: null } : b);
  const fan = pickFanCovers(noCovers, "WELLNESS", 3);
  assert.equal(fan.length, 3);
  assert.ok(fan.every((f) => !f.hasCover));
});

test("verticalCardBackground: well-known accent → rgb(...)", () => {
  // The wellness accent is #3F8172 in lib/verticals.ts.
  const bg = verticalCardBackground("#3F8172");
  // 12% of (63, 129, 114) + 88% of (7, 11, 18) = (13.72, 25.16, 29.64) ≈ (14, 25, 30).
  // We assert a couple of properties rather than exact values (rounding can shift).
  assert.match(bg, /^rgb\(\d+, \d+, \d+\)$/);
  // The mixed color should be very dark — close to ink, slightly tinted.
  const rgbMatch = bg.match(/(\d+), (\d+), (\d+)/);
  const r = +rgbMatch[1], g = +rgbMatch[2], b = +rgbMatch[3];
  assert.ok(r < 30 && g < 40 && b < 50, `expected dark surface, got rgb(${r},${g},${b})`);
});

test("verticalCardBackground: undefined accent → fallback", () => {
  assert.equal(verticalCardBackground(undefined), "#0D1420");
  assert.equal(verticalCardBackground("not-a-color"), "#0D1420");
});

test("verticalCardBackground: preserves ink-dominant character", () => {
  // For a strong blue (#1B6B8A), the result should still be much darker
  // than the accent (because ink dominates the mix).
  const bg = verticalCardBackground("#1B6B8A");
  const m = bg.match(/(\d+), (\d+), (\d+)/);
  const r = +m[1], g = +m[2], b = +m[3];
  // Accent RGB is (27, 107, 138). Mixed → must be much darker than that.
  assert.ok(r < 27 && g < 107 && b < 138);
});
