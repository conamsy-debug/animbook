/**
 * Simple in-memory rate limit middleware.
 *
 * - Token bucket per (key · 60-second window).
 * - 429 with Retry-After header when exceeded.
 * - Key by user when authed, fall back to IP. The AI endpoints can be
 *   keyed by ApiKey id + user id at the route layer instead.
 *
 * Trade-off: in-memory means new processes / multi-replica deployments
 * each get their own counter. For Phase 11 single-node this is fine.
 * For Phase 12 multi-region, swap the bucket store for Redis
 * (hincrby EX 60 on "ratelimit:<key>:<minute>").
 */
import type { Request, Response, NextFunction } from "express";

interface Bucket {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Allowed requests per window. */
  max: number;
  /** Window size in seconds. */
  windowSeconds: number;
  /** Custom key extractor — useful for scoping to user id. */
  key?: (req: Request) => string;
  /** Optional label for the X-RateLimit-* response headers. */
  name?: string;
}

function defaultKey(req: Request): string {
  // In production auth middleware populates req.user; fall back to IP.
  const userId = (req as Request & { user?: { id?: string } }).user?.id;
  if (userId) return `user:${userId}`;
  return `ip:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
}

function getCount(key: string, windowSeconds: number): { count: number; windowStart: number } {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart > windowSeconds * 1000) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { count: 1, windowStart: now };
  }
  existing.count += 1;
  return { count: existing.count, windowStart: existing.windowStart };
}

/** Periodic GC so the Map doesn't grow without bound. */
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.windowStart > 5 * 60_000) buckets.delete(k);
  }
}, 60_000).unref?.();

export function rateLimit(opts: RateLimitOptions) {
  const keyFn = opts.key ?? defaultKey;
  const label = opts.name ?? "global";
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${label}:${keyFn(req)}`;
    const { count, windowStart } = getCount(key, opts.windowSeconds);
    const remaining = Math.max(0, opts.max - count);
    const resetMs = windowStart + opts.windowSeconds * 1000;
    res.setHeader("X-RateLimit-Limit", String(opts.max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetMs / 1000)));
    if (count > opts.max) {
      const retryAfter = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "Too Many Requests",
        limit: opts.max,
        windowSeconds: opts.windowSeconds,
        retryAfter
      });
      return;
    }
    next();
  };
}

/** Drop the bucket for a key (e.g. after a successful AI call resolves). */
export function resetRateLimit(label: string, key: string): void {
  buckets.delete(`${label}:${key}`);
}
