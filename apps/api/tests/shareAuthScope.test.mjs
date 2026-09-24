/**
 * Tests for the fix that scopes the share-auth router's auth to per-route,
 * instead of mounting `authMiddleware` at the router level.
 *
 * Background:
 *   `src/modules/share/routes.ts` exports `shareAuthedRouter` as the default.
 *   That router was previously wrapped with `shareAuthedRouter.use(authMiddleware)`,
 *   AND `src/index.ts` mounts it at the bare `/api` prefix:
 *     `app.use("/api", share);`  (line 113)
 *   `router.use(authMiddleware)` fires for EVERY request entering the router,
 *   including paths that no inner route matches. With no later `app.use` for
 *   those paths, the request would fall through. But because `app.use` only
 *   invokes `next()` when the inner router has no matching route, and because
 *   `router.use(authMiddleware)` is middleware (not a route handler) that fires
 *   before any route matching, the 401 was sent before the route resolution
 *   had a chance to miss and call `next()`.
 *
 *   Languages Phase 1 added `app.use("/api/lang", languages)` at line 132,
 *   registered AFTER line 113. So every `/api/lang/*` request entered the
 *   share authed router first, hit the router-level `authMiddleware`, and
 *   got 401'd before ever reaching the languages router.
 *
 * Fix:
 *   Removed `shareAuthedRouter.use(authMiddleware)`.
 *   Added `authMiddleware` per route inside shareAuthedRouter (3 routes).
 *   Unmatched paths under `/api` now fall through to the next middleware,
 *   so languages / health, the 404 catch-all, and any other later mount work.
 *
 * What this file pins:
 *   1. Every share-authed route still returns 401 with no token.
 *   2. /api/lang/health returns 200 (was 401 before fix).
 *   3. /api/lang/nope returns 404 (NOT 401).
 *   4. legal + docs public routes do not 401.
 *
 * Run with: `node --test apps/api/tests/shareAuthScope.test.mjs`
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import helmet from "helmet";
import cors from "cors";

// Set env BEFORE importing modules that read process.env at module load.
// Clerk "on" + ALLOW_DEMO_AUTH off + languages flag on means:
//   - authMiddleware short-circuits with 401 on missing token (no DB hit)
//   - The languages router will be mounted under /api/lang in our test app
process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "sk_test_fake_for_unit_tests";
process.env.ALLOW_DEMO_AUTH = "false";
process.env.LANGUAGES_ENABLED = "true";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@127.0.0.1:1/test";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:1";

const shareMod = await import("../dist/modules/share/routes.js");
const languagesMod = await import("../dist/modules/languages/routes.js");
const legalMod = await import("../dist/modules/legal/routes.js");
const docsMod = await import("../dist/modules/docs/routes.js");

const shareAuthedRouter = shareMod.default;
const sharePublicRouter = shareMod.sharePublicRouter;
const languages = languagesMod.default;
const legal = legalMod.default;
const docs = docsMod.default;

/* --------------------------------------------------------------------- *
 * Build a minimal Express app that mirrors src/index.ts mounting for
 * just the routes we want to verify. We don't bring in helmet / cors
 * policies that would 4xx the probes.
 * --------------------------------------------------------------------- */
function buildApp() {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "8mb" }));
  // Health endpoint so we can sanity-check the test server itself.
  app.get("/", (_req, res) => res.json({ ok: true }));
  app.use("/api/health", (_req, res) => res.json({ status: "ready" }));

  // Mirror the order from src/index.ts:
  //   line 112: app.use("/api/share", sharePublicRouter);
  //   line 113: app.use("/api",       share);                 <-- the previously-bad mount
  //   line 124: app.use("/api",       legal);
  //   line 125: app.use("/api/docs",  docs);
  //   line 132: app.use("/api/lang",  languages);
  app.use("/api/share", sharePublicRouter);
  app.use("/api", shareAuthedRouter);
  app.use("/api", legal);
  app.use("/api/docs", docs);
  app.use("/api/lang", languages);

  // Mirror the catch-all from src/index.ts line 135.
  app.use((req, res) => res.status(404).json({ error: "Not found", path: req.path }));
  return app;
}

function startServer() {
  return new Promise((resolve, reject) => {
    const app = buildApp();
    const server = app.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port });
    });
    server.on("error", reject);
  });
}

function probe(port, method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: { Accept: "application/json" }
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function withServer(fn) {
  const { server, port } = await startServer();
  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/* --------------------------------------------------------------------- *
 * Pin: no router-level authMiddleware remains
 * --------------------------------------------------------------------- */

test("shareAuthScope: shareAuthedRouter has NO router-level authMiddleware", () => {
  // The router-level middleware (functions, not route handlers) sits at
  // `shareAuthedRouter.stack[*].handle` where there is no `.route`. After
  // the fix, no stack entry without a route should be authMiddleware.
  const routerLevelMiddleware = (shareAuthedRouter.stack ?? [])
    .filter((layer) => !layer.route)
    .map((layer) => layer.name);
  assert.deepEqual(
    routerLevelMiddleware,
    [],
    `shareAuthedRouter has unexpected router-level middleware: ${routerLevelMiddleware.join(", ")}`
  );
});

test("shareAuthScope: each share-authed route has authMiddleware applied per-route", () => {
  const routes = (shareAuthedRouter.stack ?? [])
    .filter((l) => l.route)
    .map((l) => {
      const methods = Object.keys(l.route.methods).join(",").toUpperCase();
      const stack = (l.route.stack ?? []).map((s) => s.name).join(" -> ");
      return `${methods} ${l.route.path}  |  stack: [${stack}]`;
    });
  // Expect exactly 3 routes, each with authMiddleware in its handler stack.
  assert.equal(routes.length, 3, `expected 3 routes, got ${routes.length}: ${routes.join(" | ")}`);
  for (const line of routes) {
    assert.match(
      line,
      /authMiddleware/,
      `route missing authMiddleware: ${line}`
    );
  }
});

/* --------------------------------------------------------------------- *
 * Pin: each share-authed route returns 401 with no token
 * --------------------------------------------------------------------- */

test("shareAuthScope: POST /api/books/:id/share returns 401 without token", async () => {
  const r = await withServer((port) =>
    probe(port, "POST", "/api/books/test-book/share")
  );
  assert.equal(r.status, 401, `body: ${r.body}`);
});

test("shareAuthScope: GET /api/books/:id/shares returns 401 without token", async () => {
  const r = await withServer((port) =>
    probe(port, "GET", "/api/books/test-book/shares")
  );
  assert.equal(r.status, 401, `body: ${r.body}`);
});

test("shareAuthScope: DELETE /api/books/:id/share/:token returns 401 without token", async () => {
  const r = await withServer((port) =>
    probe(port, "DELETE", "/api/books/test-book/share/abc123")
  );
  assert.equal(r.status, 401, `body: ${r.body}`);
});

/* --------------------------------------------------------------------- *
 * Pin: /api/lang/* no longer gated by share's auth
 * --------------------------------------------------------------------- */

test("shareAuthScope: /api/lang/health returns 200 (was 401 before the fix)", async () => {
  const r = await withServer((port) => probe(port, "GET", "/api/lang/health"));
  assert.equal(r.status, 200, `body: ${r.body}`);
  const body = JSON.parse(r.body);
  assert.equal(body.ok, true);
  assert.equal(body.feature, "languages");
});

test("shareAuthScope: /api/lang/nope falls through to 404 (NOT 401)", async () => {
  const r = await withServer((port) => probe(port, "GET", "/api/lang/nope"));
  assert.equal(r.status, 404, `body: ${r.body}`);
  const body = JSON.parse(r.body);
  assert.equal(body.error, "Not found");
});

test("shareAuthScope: /api/lang/ (trailing slash, no segment) falls through to 404", async () => {
  // /api/lang → strip prefix → / (empty) inside the languages router. No
  // matching route. Falls through to the catch-all 404.
  const r = await withServer((port) => probe(port, "GET", "/api/lang/"));
  assert.equal(r.status, 404, `body: ${r.body}`);
});

/* --------------------------------------------------------------------- *
 * Pin: other bare-/api mounts (legal, docs) still respond without 401
 * --------------------------------------------------------------------- */

test("shareAuthScope: /api/legal/pricing does NOT 401 (legal public route)", async () => {
  const r = await withServer((port) => probe(port, "GET", "/api/legal/pricing"));
  assert.notEqual(
    r.status,
    401,
    `legal/pricing should not 401, got ${r.status}: ${r.body}`
  );
});

test("shareAuthScope: /api/docs does NOT 401 (docs public route)", async () => {
  const r = await withServer((port) => probe(port, "GET", "/api/docs"));
  assert.notEqual(
    r.status,
    401,
    `docs should not 401, got ${r.status}: ${r.body}`
  );
});

/* --------------------------------------------------------------------- *
 * Pin: share public landing still works (sanity — regression guard)
 * --------------------------------------------------------------------- */

test("shareAuthScope: GET /api/share/<public token path> does NOT 401 (public router is separate)", async () => {
  // Public share router handles /api/share/<token>. Mounted at line 112,
  // before the share-authed router. With Clerk on + no token, this should
  // still hit the public handler (which validates the token format, not auth).
  // We use a token that doesn't pass the format regex to avoid a DB lookup.
  const r = await withServer((port) => probe(port, "GET", "/api/share/XX"));
  assert.notEqual(
    r.status,
    401,
    `/api/share/XX should not 401, got ${r.status}: ${r.body}`
  );
  // Bad-format token returns 404 from the public handler.
  assert.equal(r.status, 404);
});
