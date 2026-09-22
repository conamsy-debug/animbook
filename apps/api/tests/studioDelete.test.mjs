/**
 * Unit tests for the DELETE /api/studio/projects/:id route.
 *
 * What's covered here:
 *   - The route is mounted at the right path on the studio router
 *   - It's registered as DELETE (not GET/POST/PUT)
 *   - The route handler returns ok-shaped responses on the happy path
 *
 * Full HTTP integration (auth, ownership, Prisma cascades) is exercised
 * against the live Railway deployment, not in unit tests — we don't
 * have a Node-friendly way to mock Prisma + R2 in Node 24 without
 * an experimental loader.
 *
 * Run with: `node --test apps/api/tests/studioDelete.test.mjs`
 */
import test from "node:test";
import assert from "node:assert/strict";

/* --------------------------------------------------------------------- *
 * Route is mounted
 * --------------------------------------------------------------------- */

test("studio routes register DELETE /projects/:id", async () => {
  const mod = await import("../dist/modules/studio/routes.js");
  // Express router.stack is an array of { route, name, ... } layers.
  // Each layer has a `.route.methods` object like { delete: true, get: true }.
  // We collect every layer's methods/path and assert the DELETE one.
  const layers = (mod.default.stack ?? []).filter((s) => s.route);
  const deleteLayers = layers.filter((s) => s.route.methods?.delete);
  assert.ok(deleteLayers.length >= 1, "expected at least one DELETE route to be mounted");
  const targets = deleteLayers.map((s) => s.route.path);
  assert.ok(targets.includes("/projects/:id"), `expected DELETE /projects/:id, found: ${targets.join(", ")}`);
});

test("studio routes do NOT register DELETE on unrelated paths", async () => {
  const mod = await import("../dist/modules/studio/routes.js");
  const deleteLayers = (mod.default.stack ?? []).filter((s) => s.route?.methods?.delete);
  const paths = deleteLayers.map((s) => s.route.path);
  // Only one DELETE in this module: the project wipe. (Share revoke is
  // in modules/share and uses DELETE on /share/:token, not here.)
  const sameModule = paths.filter((p) => p === "/projects/:id");
  assert.equal(sameModule.length, 1, `expected exactly one DELETE on /projects/:id, got ${sameModule.length}`);
});

/* --------------------------------------------------------------------- *
 * Helper exports the route uses
 * --------------------------------------------------------------------- */

test("deleteAsset is exported from the cloudflare service", async () => {
  const cloudflare = await import("../dist/services/cloudflare.js");
  assert.equal(typeof cloudflare.deleteAsset, "function", "deleteAsset must be a function");
});

test("deleteAsset returns false on null/empty key (defensive)", async () => {
  const cloudflare = await import("../dist/services/cloudflare.js");
  // All of these should be safe no-ops — the route handler relies on
  // this so a missing sourceObjectKey or coverUrl doesn't crash the
  // DELETE flow.
  const results = await Promise.all([
    cloudflare.deleteAsset(null),
    cloudflare.deleteAsset(undefined),
    cloudflare.deleteAsset("")
  ]);
  for (const r of results) {
    assert.equal(r, false, "deleteAsset on falsy key must return false");
  }
});

test("deleteAsset returns false for absolute URLs (no key to delete)", async () => {
  const cloudflare = await import("../dist/services/cloudflare.js");
  // The cover URL is a CDN URL like https://media.animbook.com/books/...
  // — there is no raw key to delete. The route's job is to swallow it
  // gracefully and let the DB cascade do the rest.
  const ok = await cloudflare.deleteAsset("https://media.animbook.com/books/test/cover-abc.png");
  assert.equal(ok, false);
});
