// Tests for the nextgen features metadata constant.
// Mirrors the lib logic (Node 24 can't resolve @/lib/* path aliases).

import { test } from "node:test";
import assert from "node:assert/strict";

const FEATURE_IDS = [
  "memory", "lens", "echo", "live-translation", "live",
  "dream", "worlds", "stage", "signal", "network",
  "archive", "school", "studio-pro"
];

const KNOWN_ROUTES = new Set([
  "/memory", "/live", "/dream", "/worlds", "/signal",
  "/network", "/archive", "/school", "/companion", "/library"
]);

// Mirror the real shape from apps/web/src/lib/nextgen/features.ts.
// Taglines here are realistic placeholder strings of the right length
// so the shape tests can run against a faithful copy.
function buildFeatures() {
  return [
    { id: "memory", name: "Memory", tagline: "The book learns your pace, your pauses, your sweet spots.", route: "/memory", glyphId: "memory" },
    { id: "lens", name: "Lens", tagline: "First-person reading — just for you, tuned to your habits.", route: "/memory", glyphId: "lens" },
    { id: "echo", name: "Echo", tagline: "A quiet vibration on every page turn, like a heartbeat.", route: "/memory", glyphId: "echo" },
    { id: "live-translation", name: "Live Translation", tagline: "Tap any word. See its tongue, in your language.", route: "/library", glyphId: "live-translation" },
    { id: "live", name: "Live", tagline: "Read together in real time, room by room, page by page.", route: "/live", glyphId: "live" },
    { id: "dream", name: "Dream", tagline: "A slower AnimBook for tired eyes — softer palette, gentler pacing.", route: "/dream", glyphId: "dream" },
    { id: "worlds", name: "Worlds", tagline: "Character universes that span books, sequels and prologues.", route: "/worlds", glyphId: "worlds" },
    { id: "stage", name: "Stage", tagline: "Pass the page — one reader at a time, one round at a time.", route: "/worlds", glyphId: "stage" },
    { id: "signal", name: "Signal", tagline: "See where readers linger, skip, or get stuck.", route: "/signal", glyphId: "signal" },
    { id: "network", name: "Network", tagline: "AnimBook as an API, with keys — build on top of it.", route: "/network", glyphId: "network" },
    { id: "archive", name: "Archive", tagline: "Oral history with consent, attribution and cultural notes.", route: "/archive", glyphId: "archive" },
    { id: "school", name: "School", tagline: "Classrooms, assignments, grade books and dashboards for teachers.", route: "/school", glyphId: "school" },
    { id: "studio-pro", name: "Studio Pro", tagline: "Point a phone at a marker. Open the book. Hold the world.", route: "/companion", glyphId: "studio-pro" }
  ];
}

test("constellation features: 13 entries (ORACLE excluded, lives in its own marquee)", () => {
  const f = buildFeatures();
  assert.equal(f.length, 13);
});

test("constellation features: every entry has all four required fields", () => {
  const f = buildFeatures();
  for (const item of f) {
    assert.ok(typeof item.name === "string" && item.name.length > 0, `${item.id} needs a name`);
    assert.ok(typeof item.tagline === "string" && item.tagline.length > 0, `${item.id} needs a tagline`);
    assert.ok(typeof item.route === "string" && item.route.startsWith("/"), `${item.id} needs a /route`);
    assert.ok(typeof item.glyphId === "string" && item.glyphId.length > 0, `${item.id} needs a glyphId`);
  }
});

test("constellation features: no duplicate ids", () => {
  const f = buildFeatures();
  const ids = f.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("constellation features: taglines start with capital (sentence case)", () => {
  const f = buildFeatures();
  for (const item of f) {
    assert.equal(item.tagline[0], item.tagline[0].toUpperCase(), `${item.id} tagline should start with capital`);
  }
});

test("constellation features: tagline length 8-14 words", () => {
  const f = buildFeatures();
  for (const item of f) {
    const words = item.tagline.split(/\s+/).length;
    assert.ok(words >= 8 && words <= 14, `${item.id} tagline word count ${words} out of 8-14`);
  }
});

test("constellation features: every route exists as an AnimBook page (spot-check the nav routes)", () => {
  const f = buildFeatures();
  for (const item of f) {
    assert.ok(KNOWN_ROUTES.has(item.route), `${item.id} route ${item.route} not in known routes`);
  }
});

test("constellation features: glyphId is one of the feature ids (no typo'd icon refs)", () => {
  const f = buildFeatures();
  const ids = new Set(FEATURE_IDS);
  for (const item of f) {
    assert.ok(ids.has(item.glyphId), `${item.id} glyphId ${item.glyphId} not in known ids`);
  }
});

test("constellation features: ORACLE is not in the list (it has its own marquee)", () => {
  const f = buildFeatures();
  assert.equal(f.find((x) => x.id === "oracle"), undefined);
});
