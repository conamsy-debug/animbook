// Pure-logic tests for the library series/title splitter and imprint
// detection. Run with: `node --test apps/web/tests/librarySeries.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { splitTitle, isOriginals } from "../src/lib/library/series.ts";

test("splitTitle: detects 'Lagos Nights · The Lagoon' as series + title", () => {
  const r = splitTitle("Lagos Nights · The Lagoon");
  assert.deepEqual(r, { series: "Lagos Nights", title: "The Lagoon" });
});

test("splitTitle: trims surrounding whitespace", () => {
  const r = splitTitle("  Lagos Nights   ·   The Lagoon  ");
  assert.deepEqual(r, { series: "Lagos Nights", title: "The Lagoon" });
});

test("splitTitle: returns null series for plain titles", () => {
  const r = splitTitle("The Quiet Hour");
  assert.deepEqual(r, { series: null, title: "The Quiet Hour" });
});

test("splitTitle: rejects multi-dot titles (more than 2 parts)", () => {
  const r = splitTitle("Series · Sub · Title");
  assert.deepEqual(r, { series: null, title: "Series · Sub · Title" });
});

test("splitTitle: rejects when one side is purely punctuation", () => {
  const r = splitTitle("· The Lagoon");
  // After filter, only one non-empty part remains → series null.
  assert.deepEqual(r, { series: null, title: "· The Lagoon" });
});

test("splitTitle: rejects when one side is empty", () => {
  const r = splitTitle("Lagos Nights · ");
  // Empty trailing part → series is null. Title is the trimmed input.
  assert.equal(r.series, null);
  assert.equal(r.title, "Lagos Nights ·");
});

test("splitTitle: rejects absurdly long series names (>60 chars)", () => {
  const longSeries = "A".repeat(70);
  const r = splitTitle(`${longSeries} · The Lagoon`);
  assert.equal(r.series, null);
});

test("splitTitle: accepts unicode titles (中文 · 标题)", () => {
  const r = splitTitle("中文 · 标题");
  assert.deepEqual(r, { series: "中文", title: "标题" });
});

test("splitTitle: empty input returns empty title", () => {
  assert.deepEqual(splitTitle(""), { series: null, title: "" });
});

test("splitTitle: null/undefined-safe", () => {
  // @ts-expect-error — defensive test, not type-correct
  assert.deepEqual(splitTitle(undefined), { series: null, title: "" });
  // @ts-expect-error — defensive test, not type-correct
  assert.deepEqual(splitTitle(null), { series: null, title: "" });
});

test("isOriginals: vertical === ORIGINALS → true", () => {
  assert.equal(isOriginals({ vertical: "ORIGINALS" }), true);
});

test("isOriginals: any other vertical → false", () => {
  for (const v of ["CONSUMER", "KIDS", "EDU", "FAITH", "DOCS", "VERSE", "COMICS", "BUSINESS", "WELLNESS", "LAW", "TRAVEL"]) {
    assert.equal(isOriginals({ vertical: v }), false, `${v} should not be Originals`);
  }
});
