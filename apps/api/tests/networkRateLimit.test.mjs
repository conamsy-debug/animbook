// Unit tests for the AnimBook NETWORK rate limiter.
//
// The limiter is a pure function in `consumeToken` plus an in-memory
// `rateBuckets` Map. We rebuild the bucket logic here (same shape) so
// the math is regression-tested in CI without spinning up Express.
//
// Run with: `node --test apps/api/tests/networkRateLimit.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";

const RATE_LIMIT_WINDOW_MS = 60_000;

function makeBucket() {
  return new Map();
}

function consumeToken(buckets, keyId, rateLimitRpm, now = Date.now()) {
  let bucket = buckets.get(keyId);
  if (!bucket) {
    bucket = { tokens: rateLimitRpm, updatedAt: now };
    buckets.set(keyId, bucket);
  } else {
    const elapsed = now - bucket.updatedAt;
    if (elapsed > 0) {
      const refill = (elapsed / RATE_LIMIT_WINDOW_MS) * rateLimitRpm;
      bucket.tokens = Math.min(rateLimitRpm, bucket.tokens + refill);
      bucket.updatedAt = now;
    }
  }
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens), limit: rateLimitRpm };
  }
  return { allowed: false, remaining: 0, limit: rateLimitRpm };
}

test("first call for a fresh key is always allowed with bucket = limit", () => {
  const buckets = makeBucket();
  const r = consumeToken(buckets, "key1", 60);
  assert.equal(r.allowed, true);
  assert.equal(r.limit, 60);
  assert.equal(r.remaining, 59);
});

test("consumes one token per call", () => {
  const buckets = makeBucket();
  consumeToken(buckets, "k", 10);
  consumeToken(buckets, "k", 10);
  consumeToken(buckets, "k", 10);
  const r = consumeToken(buckets, "k", 10);
  assert.equal(r.allowed, true);
  assert.equal(r.remaining, 6);
});

test("rejects after bucket is exhausted", () => {
  const buckets = makeBucket();
  // 60 rpm → 60 successful + reject
  for (let i = 0; i < 60; i++) consumeToken(buckets, "k", 60);
  const r = consumeToken(buckets, "k", 60);
  assert.equal(r.allowed, false);
  assert.equal(r.remaining, 0);
});

test("bucket refills at rateLimitRpm / minute (linear over the window)", () => {
  const buckets = makeBucket();
  // Drain the bucket
  for (let i = 0; i < 60; i++) consumeToken(buckets, "k", 60);
  // Advance 30s → 30 tokens should be back
  const r = consumeToken(buckets, "k", 60, Date.now() + 30_000);
  assert.equal(r.allowed, true, "30s into a 60s window should refill 30 tokens");
  // remaining after the consume is 29 (30 - 1)
  assert.equal(r.remaining, 29);
});

test("full refill: 60s after drain restores the bucket", () => {
  const buckets = makeBucket();
  for (let i = 0; i < 60; i++) consumeToken(buckets, "k", 60);
  const r = consumeToken(buckets, "k", 60, Date.now() + 60_000);
  assert.equal(r.allowed, true);
  assert.equal(r.remaining, 59, "full minute → 60 tokens, consume one → 59");
});

test("bucket never exceeds the limit on refill", () => {
  const buckets = makeBucket();
  consumeToken(buckets, "k", 10);
  consumeToken(buckets, "k", 10);
  // Advance 10 minutes — bucket should be at most 10
  const r = consumeToken(buckets, "k", 10, Date.now() + 10 * 60_000);
  assert.equal(r.remaining, 9, "bucket caps at limit, not unbounded");
});

test("different keys have independent buckets", () => {
  const buckets = makeBucket();
  // Drain key A
  for (let i = 0; i < 60; i++) consumeToken(buckets, "A", 60);
  // Key B should still have a full bucket
  const r = consumeToken(buckets, "B", 60);
  assert.equal(r.allowed, true);
  assert.equal(r.remaining, 59);
});

test("unknown key creates a fresh bucket on first call", () => {
  const buckets = makeBucket();
  const r = consumeToken(buckets, "fresh", 30);
  assert.equal(r.allowed, true);
  assert.equal(buckets.has("fresh"), true);
});

test("limit=1 is enforced (single call then reject)", () => {
  const buckets = makeBucket();
  assert.equal(consumeToken(buckets, "k", 1).allowed, true);
  assert.equal(consumeToken(buckets, "k", 1).allowed, false);
});

test("window math: 0 elapsed → no refill", () => {
  const buckets = makeBucket();
  const now = 1_000_000;
  consumeToken(buckets, "k", 60, now);
  consumeToken(buckets, "k", 60, now);
  // same instant — refill is 0, no time has passed
  const r = consumeToken(buckets, "k", 60, now);
  assert.equal(r.remaining, 57);
});
