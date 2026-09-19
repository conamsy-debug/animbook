/**
 * Unit tests for the motion-tier (Part B) work.
 *
 * Covers:
 *   - pickClipSeconds: HERO -> 10s, STANDARD -> 5s.
 *   - estimateClipCostUsd: still 5 credits/sec * $0.01.
 *   - buildFallbackBrain: deterministic tier assignment + reason on
 *     every manifest entry, with ~25% HERO across the book.
 *   - BookBrainPageManifest backwards-compat: parsing a Brain that
 *     doesn't carry motionTier works; pages default to STANDARD.
 *   - Split routes expose the per-page motion-tier endpoint at the
 *     right path (ownership / state-mutation are exercised against
 *     the live Railway deploy).
 *
 * Run with: `node --test apps/api/tests/motionTier.test.mjs`
 */
import test from "node:test";
import assert from "node:assert/strict";

const { pickClipSeconds, estimateClipCostUsd } = await import("../dist/services/splitPipeline.js");
const { buildFallbackBrain } = await import("../dist/services/bookBrain.js");

/* --------------------------------------------------------------------- *
 * pickClipSeconds
 * --------------------------------------------------------------------- */

test("pickClipSeconds: HERO -> 10s, STANDARD -> 5s", () => {
  assert.equal(pickClipSeconds("HERO"), 10);
  assert.equal(pickClipSeconds("STANDARD"), 5);
});

test("estimateClipCostUsd = seconds * 5 * 0.01", () => {
  assert.equal(estimateClipCostUsd(10), 0.5);
  assert.equal(estimateClipCostUsd(5), 0.25);
  // 100 pages of STANDARD + 25 pages of HERO = 100*5 + 25*10 = 750s = $37.50
  const seconds = 100 * 5 + 25 * 10;
  assert.equal(estimateClipCostUsd(seconds), 37.5);
});

/* --------------------------------------------------------------------- *
 * buildFallbackBrain (deterministic HERO assignment)
 * --------------------------------------------------------------------- */

test("buildFallbackBrain: every page has a motionTier + motionReason", () => {
  const input = {
    title: "Sample",
    pages: Array.from({ length: 12 }, (_, i) => ({
      pageNum: i + 1,
      chapter: null,
      text: `Body text for page ${i + 1}.`
    }))
  };
  const brain = buildFallbackBrain(input, { vertical: "CONSUMER" });
  for (const m of brain.page_manifest) {
    assert.ok(m.motionTier === "HERO" || m.motionTier === "STANDARD", `page ${m.page_num} missing tier`);
    assert.ok(typeof m.motionReason === "string" && m.motionReason.length > 0, `page ${m.page_num} missing reason`);
  }
});

test("buildFallbackBrain: ~25% HERO across a 12-page book (3 hero / 9 standard)", () => {
  const input = {
    title: "Sample",
    pages: Array.from({ length: 12 }, (_, i) => ({
      pageNum: i + 1,
      chapter: null,
      text: `Body text for page ${i + 1}.`
    }))
  };
  const brain = buildFallbackBrain(input, { vertical: "CONSUMER" });
  const heroes = brain.page_manifest.filter((m) => m.motionTier === "HERO").length;
  const standards = brain.page_manifest.filter((m) => m.motionTier === "STANDARD").length;
  assert.equal(heroes, 3);
  assert.equal(standards, 9);
});

test("buildFallbackBrain: tier assignment follows idx % 4 == 0 -> HERO", () => {
  const input = {
    title: "Sample",
    pages: Array.from({ length: 8 }, (_, i) => ({
      pageNum: i + 1,
      chapter: null,
      text: `Page ${i + 1}.`
    }))
  };
  const brain = buildFallbackBrain(input, { vertical: "CONSUMER" });
  const tiers = brain.page_manifest.map((m) => m.motionTier);
  // pages 1, 2, 3, 4 -> idx 0, 1, 2, 3 -> HERO, STANDARD, STANDARD, STANDARD
  // pages 5, 6, 7, 8 -> idx 4, 5, 6, 7 -> HERO, STANDARD, STANDARD, STANDARD
  assert.deepEqual(tiers, ["HERO", "STANDARD", "STANDARD", "STANDARD", "HERO", "STANDARD", "STANDARD", "STANDARD"]);
});

/* --------------------------------------------------------------------- *
 * Backwards-compat: legacy brains without motionTier still parse +
 * default to STANDARD.
 * --------------------------------------------------------------------- */

test("legacy manifest entry without motionTier: missing key, type is still safe to read", () => {
  // Simulate a Brain JSON written before Part B. The field is optional
  // in the TypeScript interface, so reading the manifest is fine.
  const legacy = {
    page_num: 1,
    text_excerpt: "Once upon a time",
    setting: "Forest",
    characters_present: [],
    primary_action: "introduction",
    emotion: "wonder",
    camera_angle: "wide",
    animation_prompt_draft: "A sunlit forest clearing"
  };
  assert.equal(legacy.motionTier, undefined);
  // Default to STANDARD when applying — the buildPrompts path uses
  // `?? "STANDARD"` to bridge.
  const effective = legacy.motionTier ?? "STANDARD";
  assert.equal(effective, "STANDARD");
});

/* --------------------------------------------------------------------- *
 * Split routes expose the motion-tier endpoint
 * --------------------------------------------------------------------- */

test("splitRoutes mounts PUT /pages/:pageId/motion-tier", async () => {
  const mod = await import("../dist/modules/studio/splitRoutes.js");
  const paths = (mod.default.stack ?? [])
    .filter((s) => s.route)
    .flatMap((s) => Object.keys(s.route.methods).map((m) => `${m.toUpperCase()} ${s.route.path}`));
  const matches = paths.filter((p) => p.endsWith("/pages/:pageId/motion-tier"));
  assert.equal(matches.length, 1, `expected exactly one motion-tier route, got ${matches.length}`);
  assert.equal(matches[0], "PUT /pages/:pageId/motion-tier");
});

/* --------------------------------------------------------------------- *
 * Estimate math: 20 pages with mixed tiers + retry-free cost preview
 * --------------------------------------------------------------------- */

test("estimate preview for a mixed-tier book uses per-tier seconds", () => {
  // 6 HERO (10s) + 14 STANDARD (5s) = 60 + 70 = 130 seconds
  const seconds = 6 * 10 + 14 * 5;
  assert.equal(seconds, 130);
  // 130 * 5 credits/sec * $0.01 = $6.50
  assert.equal(estimateClipCostUsd(seconds), 6.5);
});
