/**
 * AnimBook Redis cache wrapper.
 *
 * Goals:
 * - Cache hot read paths (`/api/books`, `/api/worlds`, vertical listing).
 * - Stamp `X-Cache: HIT|MISS` so callers and smokes can verify behaviour.
 * - Degrade gracefully if Redis is unreachable — never break the reader.
 *
 * The ioredis client is shared with the Bull pipeline so we don't open
 * two connections per process.
 */
import type { Request, Response, NextFunction } from "express";
import Redis from "ioredis";
import { appEnv } from "../config/env.js";

interface CacheOptions {
  /** TTL in seconds. */
  ttlSeconds: number;
  /** Build the cache key from the incoming request. */
  key?: (req: Request) => string;
  /** Vary on these request header names. */
  varyOn?: string[];
}

/**
 * Single shared Redis client. `lazyConnect: true` means we only open the
 * socket on the first command — keeps the API fast to boot when the
 * cache layer is unused.
 */
let _redis: Redis | null = null;
let _connected: boolean | null = null;

function client(): Redis {
  if (_redis) return _redis;
  _redis = new Redis(appEnv.REDIS_URL, {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 2
  });
  _redis.on("error", (err: unknown) => {
    if (_connected !== false) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[animbook-cache] Redis connection failed:", msg);
    }
    _connected = false;
  });
  _redis.on("ready", () => {
    if (_connected !== true) console.log("[animbook-cache] Redis connected");
    _connected = true;
  });
  return _redis;
}

export async function ensureConnected(): Promise<boolean> {
  try {
    const c = client();
    if (c.status === "ready" || c.status === "connecting") return true;
    await c.connect();
    return true;
  } catch {
    return false;
  }
}

/**
 * Cache-aside middleware. On HIT serves the cached body and stamps
 * `X-Cache: HIT`. On MISS executes the handler, caches the JSON result,
 * and stamps `X-Cache: MISS`.
 */
export function withCache(opts: CacheOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const base = opts.key ? opts.key(req) : `${req.method}:${req.originalUrl}`;
    const vary = (opts.varyOn ?? []).map((h) => `${h}:${req.header(h) ?? ""}`).join("|");
    const cacheKey = `animbook:${base}${vary ? `|${vary}` : ""}`;

    const ok = await ensureConnected();
    if (!ok) {
      res.setHeader("X-Cache", "BYPASS");
      return next();
    }

    try {
      const hit = await client().get(cacheKey);
      if (hit) {
        res.setHeader("X-Cache", "HIT");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.send(hit);
      }
    } catch {
      res.setHeader("X-Cache", "BYPASS");
      return next();
    }

    res.setHeader("X-Cache", "MISS");
    const original = res.json.bind(res);
    res.json = ((body: unknown) => {
      try {
        const payload = JSON.stringify(body);
        // Set after we know payload ok, but fire-and-forget.
        client()
          .set(cacheKey, payload, "EX", opts.ttlSeconds)
          .catch(() => undefined);
      } catch {
        // Non-serialisable body — skip caching.
      }
      return original(body);
    }) as typeof res.json;
    next();
  };
}

/**
 * Drop a key (or pattern) from the cache. Use after writes — e.g. a new
 * AnimBook just got published, /api/books needs to refresh.
 *
 * Note: KEYS is expensive on large datasets. Use only for dev/debug or
 * wrap in a SCAN if you ever go to production scale.
 */
export async function invalidate(prefix: string): Promise<number> {
  const ok = await ensureConnected();
  if (!ok) return 0;
  try {
    const stream = client().scanStream({ match: `animbook:${prefix}*`, count: 100 });
    let removed = 0;
    return await new Promise<number>((resolve) => {
      stream.on("data", async (keys: string[]) => {
        if (keys.length) {
          try {
            removed += await client().del(...keys);
          } catch {
            // ignore
          }
        }
      });
      stream.on("end", () => resolve(removed));
      stream.on("error", () => resolve(removed));
    });
  } catch {
    return 0;
  }
}

/**
 * Direct cache read — for service code that needs the cached body without
 * going through Express. Returns null on miss / Redis-down.
 */
export async function readJson<T>(key: string): Promise<T | null> {
  const ok = await ensureConnected();
  if (!ok) return null;
  try {
    const raw = await client().get(`animbook:${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Direct cache write — for service code that wants to warm the cache on
 * startup or after a long write.
 */
export async function writeJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const ok = await ensureConnected();
  if (!ok) return;
  try {
    await client().set(`animbook:${key}`, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // ignore
  }
}

export async function shutdown(): Promise<void> {
  if (_redis) {
    try {
      await _redis.quit();
    } catch {
      _redis.disconnect();
    }
    _redis = null;
    _connected = null;
  }
}
