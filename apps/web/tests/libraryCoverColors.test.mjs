// Cover-color picker tests for the library's generated cover fallback.
// Run with: `node --test apps/web/tests/libraryCoverColors.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { coverColorFor } from "../src/lib/library/coverColors.ts";

test("WELLNESS maps to the first palette (#12363A / #A9D9CB)", () => {
  const p = coverColorFor("WELLNESS");
  assert.equal(p.background, "#12363A");
  assert.equal(p.foreground, "#A9D9CB");
});

test("DOCS maps to the second palette (Fitness & Movement)", () => {
  const p = coverColorFor("DOCS");
  assert.equal(p.background, "#1B2B4A");
  assert.equal(p.foreground, "#B7C8EA");
});

test("VERSE maps to the third palette (City Poems in the brief)", () => {
  const p = coverColorFor("VERSE");
  assert.equal(p.background, "#4A1C36");
  assert.equal(p.foreground, "#F0B7CF");
});

test("TRAVEL maps to the fourth palette (City Journeys in the brief)", () => {
  const p = coverColorFor("TRAVEL");
  assert.equal(p.background, "#0F3B40");
  assert.equal(p.foreground, "#BFE3E3");
});

test("Unknown verticals pick a deterministic palette via hash", () => {
  const a1 = coverColorFor("CONSUMER");
  const a2 = coverColorFor("CONSUMER");
  assert.deepEqual(a1, a2, "same input must produce same output");
  // Must be a valid palette tuple (one of the eight).
  const known = ["#12363A", "#1B2B4A", "#4A1C36", "#0F3B40", "#4A3712", "#16341F", "#2A2350", "#4A2016"];
  assert.ok(known.includes(a1.background), `background ${a1.background} is from the palette table`);
});

test("Unknown verticals with a custom fallback accent override the palette", () => {
  // The app's existing accent for CONSUMER is #1B6B8A (not in the brief's
  // palette table) — it should be preferred over the palette hash.
  const p = coverColorFor("CONSUMER", "#1B6B8A");
  assert.equal(p.background, "#1B6B8A");
  // Dark blue → light foreground.
  assert.equal(p.foreground, "#F2EEE6");
});

test("Empty / unknown vertical with no fallback → palette hash", () => {
  const a = coverColorFor("");
  const b = coverColorFor("");
  assert.deepEqual(a, b);
});

test("Fallback accent that already lives in the table is ignored", () => {
  // If the caller passes an accent that matches a table entry, the
  // explicit vertical override (WELLNESS) wins instead of the fallback.
  const p = coverColorFor("WELLNESS", "#4A3712");
  assert.equal(p.background, "#12363A");
});
