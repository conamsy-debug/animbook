/**
 * Standalone health check.
 *
 * - GET /api/health         — liveness + integrations status (smoke-friendly)
 * - GET /api/health/live    — liveness (just confirms the process is up)
 * - GET /api/health/ready   — readiness (checks DB + Redis are reachable)
 *
 * Use:
 *   Load balancer   → /api/health/live  (cheap, never restart on transient failures)
 *   Orchestrator    → /api/health/ready (gate traffic on dependency health)
 *   Smoke suite     → /api/health       (carries feature flags + last-updated)
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { featureStatus } from "../../config/env.js";
import { prisma } from "../../db.js";
import { ensureConnected as redisReady } from "../../cache/index.js";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  res.json({
    service: "animbook-api",
    status: "ok",
    integrations: featureStatus,
    time: new Date().toISOString()
  });
});

/**
 * Liveness — process is up.
 */
router.get("/live", (_req: Request, res: Response) => {
  res.status(200).json({ status: "alive", time: new Date().toISOString() });
});

/**
 * Readiness — DB + Redis are reachable. Returns 503 when any dependency
 * is down so the load balancer can pull us out of rotation without
 * killing the process.
 */
router.get("/ready", async (_req: Request, res: Response) => {
  const checks: Record<string, "ok" | "down" | "skipped"> = {
    db: "skipped",
    redis: "skipped"
  };

  let allOk = true;

  // DB check — Prisma `$queryRaw` is the cheapest possible round-trip.
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    checks.db = "ok";
  } catch {
    checks.db = "down";
    allOk = false;
  }

  // Redis check — lazyConnect means this opens a socket if not connected.
  try {
    const redisOk = await redisReady();
    checks.redis = redisOk ? "ok" : "down";
    if (!redisOk) allOk = false;
  } catch {
    checks.redis = "down";
    allOk = false;
  }

  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ready" : "not_ready",
    checks,
    integrations: featureStatus,
    time: new Date().toISOString()
  });
});

export default router;
