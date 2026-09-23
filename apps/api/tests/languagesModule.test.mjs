/**
 * Tests for the AnimBook Languages backend scaffold (Patch 01).
 *
 * Pins:
 *   - the languages module compiles and exports a default Express router
 *   - the placeholder health route is mounted at /health (mounted under
 *     /api/lang in src/index.ts)
 *   - the Feature flag union now includes LANGUAGES and respects the
 *     LANGUAGES_ENABLED env var (read alongside the existing flags)
 *   - the APP_ROUTES catalogue lists the languages module so /api/docs
 *     surfaces it
 *
 * Full HTTP integration is exercised against the live Railway deploy
 * after each patch; this file pins the in-process shape.
 *
 * Run with: `node --test apps/api/tests/languagesModule.test.mjs`
 */
import test from "node:test";
import assert from "node:assert/strict";

/* --------------------------------------------------------------------- *
 * Module shape
 * --------------------------------------------------------------------- */

test("languages module exports a default Express router", async () => {
  const mod = await import("../dist/modules/languages/routes.js");
  assert.equal(typeof mod.default, "function", "default export must be the router function");
});

test("languages router exposes the placeholder /health route", async () => {
  const mod = await import("../dist/modules/languages/routes.js");
  const paths = (mod.default.stack ?? [])
    .map((s) => s.route?.path)
    .filter(Boolean);
  assert.ok(paths.includes("/health"), `expected /health, got: ${paths.join(", ")}`);
});

test("languages router exposes the Patches 01 + 04 + 05 routes (no leaks)", async () => {
  const mod = await import("../dist/modules/languages/routes.js");
  const paths = (mod.default.stack ?? [])
    .map((s) => s.route?.path)
    .filter(Boolean);
  // Patch 01 ships /health. Patch 04 adds /stories/:storyId.
  // Patch 05 adds /languages, /courses, /enrollments,
  // /enrollments/me, /courses/:courseId, /stories/:storyId/progress.
  // This guard prevents the module from silently growing routes
  // without updating the spec + the route catalogue.
  const expected = [
    "/health",
    "/stories/:storyId",
    "/languages",
    "/courses",
    "/enrollments",
    "/enrollments/me",
    "/courses/:courseId",
    "/stories/:storyId/progress"
  ];
  assert.equal(
    paths.length,
    expected.length,
    `expected exactly ${expected.length} routes, got ${paths.length}: ${paths.join(", ")}`
  );
  for (const exp of expected) {
    assert.ok(paths.includes(exp), `expected ${exp} in routes, got: ${paths.join(", ")}`);
  }
});

/* --------------------------------------------------------------------- *
 * Feature flag
 * --------------------------------------------------------------------- */

test("featureStatus exposes a `languages` boolean", async () => {
  const env = await import("../dist/config/env.js");
  assert.equal(typeof env.featureStatus.languages, "boolean", "featureStatus.languages must be a boolean");
});

test("isFeatureEnabled('LANGUAGES') mirrors env.LANGUAGES_ENABLED", async () => {
  const env = await import("../dist/config/env.js");
  const fromFlag = env.isFeatureEnabled("LANGUAGES");
  const fromStatus = env.featureStatus.languages;
  // Both code paths should agree — if they don't, the env loader
  // and the helper are out of sync.
  assert.equal(fromFlag, fromStatus, "isFeatureEnabled and featureStatus disagree on LANGUAGES");
});

/* --------------------------------------------------------------------- *
 * Route catalogue
 * --------------------------------------------------------------------- */

test("APP_ROUTES includes a languages module entry", async () => {
  const { APP_ROUTES } = await import("../dist/appRoutes.js");
  const languages = APP_ROUTES.find((m) => m.id === "languages");
  assert.ok(languages, "APP_ROUTES must have a languages module entry");
  assert.ok(languages.routes.length >= 1, "languages module should expose at least one route");
  const healthRoute = languages.routes.find((r) => r.path === "/api/lang/health");
  assert.ok(healthRoute, "/api/lang/health should be documented in APP_ROUTES");
});
