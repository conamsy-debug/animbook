/**
 * AnimBook NETWORK — public API surface for partner integrations.
 *
 * Each ApiKey has a `prefix` (public), a `secretHash` (sha-256), scopes, and
 * a rate limit. The key is presented as `prefix.secret`. The first time the
 * secret is generated the API returns it once and never again.
 *
 * Authentication flow:
 *   Authorization: Bearer <prefix>.<secret>
 * The Express middleware decodes the prefix, looks up the key, hashes the
 * secret, and compares. The request then proceeds with `req.apiKey` populated.
 */
import type { Request, Response, NextFunction } from "express";
import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";

const router = Router();
router.use(authMiddleware);

const createSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.enum(["books:read", "library:write", "edu:write", "creator:read"])).default(["books:read"]),
  rateLimitRpm: z.number().int().min(1).max(10000).default(60)
});

router.post("/keys", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid key", details: parsed.error.flatten() });
    return;
  }
  const prefix = `abk_${randomBytes(4).toString("hex")}`;
  const secret = randomBytes(24).toString("base64url");
  const secretHash = createHash("sha256").update(secret).digest("hex");
  const key = await prisma.apiKey.create({
    data: {
      ownerId: userId,
      name: parsed.data.name,
      prefix,
      secretHash,
      scopes: parsed.data.scopes,
      rateLimitRpm: parsed.data.rateLimitRpm
    }
  });
  res.status(201).json({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    secret,
    scopes: key.scopes,
    rateLimitRpm: key.rateLimitRpm,
    warning: "Save the secret now. It will not be shown again."
  });
});

router.get("/keys", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const keys = await prisma.apiKey.findMany({
    where: { ownerId: userId, revokedAt: null },
    orderBy: { createdAt: "desc" }
  });
  res.json({ items: keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, rateLimitRpm: k.rateLimitRpm, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt })) });
});

router.post("/keys/:id/revoke", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing key id" });
    return;
  }
  const key = await prisma.apiKey.findUnique({ where: { id } });
  if (!key || key.ownerId !== userId) {
    res.status(404).json({ error: "Key not found" });
    return;
  }
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  res.json({ ok: true });
});

/**
 * Public NETWORK echo. Verifies the bearer API key against the live
 * middleware and returns the resolved identity. This is the surface
 * partners hit first to confirm their key works.
 */
export const networkPublicRouter = Router();
networkPublicRouter.get("/whoami", apiKeyMiddleware, (req: Request, res: Response) => {
  const apiKey = (req as Request & { apiKey?: { id: string; prefix: string; scopes: string[]; rateLimitRpm: number } }).apiKey;
  if (!apiKey) {
    res.status(401).json({ error: "Valid API key required" });
    return;
  }
  res.json({ key: apiKey });
});

/**
 * In-memory token bucket per API key. Resets on server restart — the
 * rate limit is an honor system, not a quota. The bucket refills at
 * rateLimitRpm tokens per minute. Headers expose remaining tokens so
 * partners can self-throttle.
 */
type Bucket = { tokens: number; updatedAt: number };
const rateBuckets = new Map<string, Bucket>();
const RATE_LIMIT_WINDOW_MS = 60_000;

function consumeToken(keyId: string, rateLimitRpm: number): { allowed: boolean; remaining: number; limit: number } {
  const now = Date.now();
  let bucket = rateBuckets.get(keyId);
  if (!bucket) {
    bucket = { tokens: rateLimitRpm, updatedAt: now };
    rateBuckets.set(keyId, bucket);
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

/**
 * Express middleware that authenticates a Bearer API key. Populates
 * `req.apiKey = { id, prefix, scopes, rateLimitRpm }` on success.
 * Also enforces an in-memory rate limit and sets X-RateLimit-* headers.
 */
export async function apiKeyMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = req.header("authorization");
  if (!auth?.startsWith("Bearer ")) {
    next();
    return;
  }
  const token = auth.slice("Bearer ".length).trim();
  const dotIndex = token.indexOf(".");
  if (dotIndex < 1) {
    next();
    return;
  }
  const prefix = token.slice(0, dotIndex);
  const secret = token.slice(dotIndex + 1);
  const key = await prisma.apiKey.findUnique({ where: { prefix } });
  if (!key || key.revokedAt) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }
  const candidate = createHash("sha256").update(secret).digest("hex");
  if (candidate !== key.secretHash) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }
  const limit = consumeToken(key.id, key.rateLimitRpm);
  res.setHeader("X-RateLimit-Limit", String(limit.limit));
  res.setHeader("X-RateLimit-Remaining", String(limit.remaining));
  if (!limit.allowed) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Rate limit exceeded", limit: limit.limit, retryAfterSeconds: 60 });
    return;
  }
  void prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  (req as Request & { apiKey?: unknown }).apiKey = {
    id: key.id,
    prefix: key.prefix,
    scopes: key.scopes,
    rateLimitRpm: key.rateLimitRpm
  };
  next();
}

/** Exposed for unit tests. */
export const _internal = { rateBuckets, RATE_LIMIT_WINDOW_MS };

export default router;