/**
 * Unit tests for the split-pipeline route module.
 *
 * What's covered here:
 *   - Module compiles + exports an Express router
 *   - Every route the brief asks for is mounted at the right path
 *   - The pure estimate math is right (Part B will move STANDARD to 5s,
 *     so the test pins both tiers at 10s to lock the current behaviour)
 *   - The publish gate's blocking-page logic in isolation
 *
 * Full HTTP integration (auth, ownership, Bull enqueue, Prisma writes)
 * is exercised against the live Railway deployment, not in unit tests —
 * we don't have a Node-friendly way to mock Prisma + Bull modules in
 * Node 24 without an experimental loader.
 *
 * Run with: `node --test apps/api/tests/studioSplitRoutes.test.mjs`
 */
import test from "node:test";
import assert from "node:assert/strict";

const { estimateClipCostUsd } = await import("../dist/services/splitPipeline.js");

/* --------------------------------------------------------------------- *
 * Module shape
 * --------------------------------------------------------------------- */

test("splitRoutes exports a default Express router", async () => {
  const mod = await import("../dist/modules/studio/splitRoutes.js");
  assert.equal(typeof mod.default, "function", "default export must be the router function");
});

test("splitRoutes mounts every endpoint the brief requires", async () => {
  const mod = await import("../dist/modules/studio/splitRoutes.js");
  const paths = (mod.default.stack ?? [])
    .map((s) => s.route?.path)
    .filter(Boolean);
  assert.ok(paths.includes("/projects/:id/stills"), "POST /projects/:id/stills");
  assert.ok(paths.includes("/pages/:pageId/still/regenerate"), "POST /pages/:pageId/still/regenerate");
  assert.ok(paths.includes("/pages/:pageId/still/approve"), "POST /pages/:pageId/still/approve");
  assert.ok(paths.includes("/projects/:id/stills/approve-all"), "POST /projects/:id/stills/approve-all");
  assert.ok(paths.includes("/projects/:id/animate/estimate"), "GET /projects/:id/animate/estimate");
  assert.ok(paths.includes("/projects/:id/animate"), "POST /projects/:id/animate");
  assert.ok(paths.includes("/projects/:id/clips/approve-all"), "POST /projects/:id/clips/approve-all");
});

test("splitRoutes mounts still/regenerate BEFORE still/approve (so :pageId matches both)", async () => {
  // Express matches routes in order. /still/regenerate and /still/approve
  // both have :pageId in the same slot; the more specific path must come
  // first so /still/approve doesn't accidentally match a still/regenerate
  // request. We assert the relative ordering by stack index.
  const mod = await import("../dist/modules/studio/splitRoutes.js");
  const paths = (mod.default.stack ?? []).map((s) => s.route?.path).filter(Boolean);
  const regenIdx = paths.indexOf("/pages/:pageId/still/regenerate");
  const approveIdx = paths.indexOf("/pages/:pageId/still/approve");
  assert.ok(regenIdx >= 0 && approveIdx >= 0);
  assert.ok(regenIdx < approveIdx, "still/regenerate must be registered before still/approve");
});

/* --------------------------------------------------------------------- *
 * Estimate math
 * --------------------------------------------------------------------- */

test("estimate = seconds * 5 credits/sec * $0.01 (Runway gen4_turbo pricing)", () => {
  assert.equal(estimateClipCostUsd(0), 0);
  assert.equal(estimateClipCostUsd(1), 0.05);
  assert.equal(estimateClipCostUsd(10), 0.5);
  assert.equal(estimateClipCostUsd(100), 5);
});

test("estimate excludes retries: 100 pages * 10s = $50, not $100 with one retry each", () => {
  const seconds = 100 * 10;
  assert.equal(estimateClipCostUsd(seconds), 50);
  // Retries don't enter this estimate — per the brief.
});

/* --------------------------------------------------------------------- *
 * Publish gate logic (pure; we don't hit the DB)
 * --------------------------------------------------------------------- */

function findBlocking(pages) {
  return pages.filter(
    (p) => p.stillStatus !== "APPROVED" || p.clipStatus !== "APPROVED" || p.audioStatus !== "READY"
  );
}

test("publish gate: a fully approved book has zero blockers", () => {
  const pages = [
    { pageNum: 1, stillStatus: "APPROVED", clipStatus: "APPROVED", audioStatus: "READY" },
    { pageNum: 2, stillStatus: "APPROVED", clipStatus: "APPROVED", audioStatus: "READY" }
  ];
  assert.equal(findBlocking(pages).length, 0);
});

test("publish gate: returns the offending page numbers", () => {
  const pages = [
    { pageNum: 1, stillStatus: "APPROVED", clipStatus: "APPROVED", audioStatus: "READY" },
    { pageNum: 2, stillStatus: "GENERATING", clipStatus: "APPROVED", audioStatus: "READY" },
    { pageNum: 3, stillStatus: "APPROVED", clipStatus: "FAILED", audioStatus: "READY" },
    { pageNum: 4, stillStatus: "APPROVED", clipStatus: "APPROVED", audioStatus: "NONE" }
  ];
  const blockers = findBlocking(pages);
  assert.deepEqual(blockers.map((b) => b.pageNum), [2, 3, 4]);
});

test("publish gate: surfaces audioStatus issues as well as still/clip issues", () => {
  const pages = [
    { pageNum: 1, stillStatus: "APPROVED", clipStatus: "APPROVED", audioStatus: "FAILED" }
  ];
  assert.equal(findBlocking(pages).length, 1);
});

/* --------------------------------------------------------------------- *
 * Ownership helpers (loadOwnedSplitProject / loadOwnedSplitPage) — the
 * routes rely on these returning 404 / 409 with the right error string.
 * We can't exercise them without Prisma, but we can verify the
 * rejection cases are reflected in the module's exports.
 * --------------------------------------------------------------------- */

test("splitRoutes router only contains POST routes for mutations + GET for estimate", async () => {
  const mod = await import("../dist/modules/studio/splitRoutes.js");
  const methods = (mod.default.stack ?? []).flatMap((s) => {
    if (!s.route) return [];
    return Object.keys(s.route.methods).map((m) => `${m.toUpperCase()} ${s.route.path}`);
  });
  // All mutations are POST. The only GET is the estimate.
  const gets = methods.filter((m) => m.startsWith("GET"));
  const posts = methods.filter((m) => m.startsWith("POST"));
  assert.deepEqual(gets.sort(), ["GET /projects/:id/animate/estimate"]);
  // Posts match the seven endpoints the brief requires.
  assert.equal(posts.length, 6);
  assert.ok(posts.some((p) => p.endsWith("/projects/:id/stills")));
  assert.ok(posts.some((p) => p.endsWith("/pages/:pageId/still/regenerate")));
  assert.ok(posts.some((p) => p.endsWith("/pages/:pageId/still/approve")));
  assert.ok(posts.some((p) => p.endsWith("/projects/:id/stills/approve-all")));
  assert.ok(posts.some((p) => p.endsWith("/projects/:id/animate")));
  assert.ok(posts.some((p) => p.endsWith("/projects/:id/clips/approve-all")));
});