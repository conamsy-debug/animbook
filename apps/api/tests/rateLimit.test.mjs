/**
 * Unit tests for the in-memory rate-limit middleware.
 *
 * Verifies:
 * - The first N requests fall through to the next handler.
 * - Request N+1 returns 429 with Retry-After.
 * - The headers are stamped on every response.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { rateLimit, resetRateLimit } from "../dist/src/middleware/rateLimit.js";

function mockReqRes() {
  const req = { ip: "1.2.3.4", user: undefined, socket: { remoteAddress: "1.2.3.4" } };
  const headers = {};
  let status = 0;
  let body = null;
  let nextCalled = false;
  const res = {
    setHeader(name, value) { headers[name] = value; },
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; }
  };
  return {
    req,
    res,
    headers,
    get status() { return status; },
    get body() { return body; },
    next: () => { nextCalled = true; }
  };
}

test("rateLimit: passes through the first N requests", () => {
  const mw = rateLimit({ name: "test.passthrough", max: 3, windowSeconds: 60 });
  for (let i = 0; i < 3; i++) {
    const ctx = mockReqRes();
    mw(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.body, null, `request ${i + 1} should not 429`);
    assert.match(ctx.headers["X-RateLimit-Limit"], /^3$/);
    assert.match(ctx.headers["X-RateLimit-Remaining"], /^[0-9]+$/);
  }
});

test("rateLimit: blocks at limit + 1 with 429 + Retry-After", () => {
  resetRateLimit("test.block", "ip:9.9.9.9");
  const mw = rateLimit({ name: "test.block", max: 5, windowSeconds: 60 });
  for (let i = 0; i < 5; i++) {
    const ctx = mockReqRes();
    ctx.req.ip = "9.9.9.9";
    ctx.req.socket.remoteAddress = "9.9.9.9";
    mw(ctx.req, ctx.res, ctx.next);
  }
  const blocked = mockReqRes();
  blocked.req.ip = "9.9.9.9";
  blocked.req.socket.remoteAddress = "9.9.9.9";
  mw(blocked.req, blocked.res, blocked.next);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, "Too Many Requests");
  assert.ok(Number(blocked.headers["Retry-After"]) >= 1);
  assert.equal(blocked.headers["X-RateLimit-Remaining"], "0");
});

test("rateLimit: keyed by user when authed (overrides IP)", () => {
  resetRateLimit("test.userkey", "user:42");
  const mw = rateLimit({ name: "test.userkey", max: 2, windowSeconds: 60 });
  const ctx1 = mockReqRes();
  ctx1.req.user = { id: "42" };
  mw(ctx1.req, ctx1.res, ctx1.next);
  const ctx2 = mockReqRes();
  ctx2.req.user = { id: "42" };
  mw(ctx2.req, ctx2.res, ctx2.next);
  const ctx3 = mockReqRes();
  ctx3.req.user = { id: "42" };
  mw(ctx3.req, ctx3.res, ctx3.next);
  // User 42 is rate-limited at request 3, but user 99 is unaffected.
  assert.equal(ctx3.status, 429);
  const other = mockReqRes();
  other.req.user = { id: "99" };
  mw(other.req, other.res, other.next);
  assert.equal(other.status, 0, "user 99 not yet limited");
});
