/**
 * Achievements API.
 *
 * - GET  /api/achievements          — list the caller's achievements
 * - POST /api/achievements/award    — body { code, metadata? } — awards if missing
 *
 * Awarding is idempotent on (userId, code). The Achievements catalogue lives in
 * `apps/api/src/services/kids.ts` so both the API and the KIDS seed can share it.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import {
  ACHIEVEMENT_CATALOG,
  defaultAchievementDescription,
  defaultAchievementTitle
} from "../../services/kids.js";

const router = Router();
router.use(authMiddleware);

router.get("/", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const list = await prisma.achievement.findMany({
    where: { userId },
    orderBy: { awardedAt: "desc" }
  });
  res.json({
    items: list,
    catalogue: ACHIEVEMENT_CATALOG
  });
});

const awardSchema = z.object({
  code: z.string().min(1),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
});

router.post("/award", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const parsed = awardSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid award payload", details: parsed.error.flatten() });
    return;
  }
  const existing = await prisma.achievement.findUnique({
    where: { userId_code: { userId, code: parsed.data.code } }
  });
  if (existing) {
    res.json({ alreadyAwarded: true, achievement: existing });
    return;
  }
  const created = await prisma.achievement.create({
    data: {
      userId,
      code: parsed.data.code,
      title: defaultAchievementTitle(parsed.data.code),
      description: defaultAchievementDescription(parsed.data.code),
      metadata: parsed.data.metadata ?? undefined
    }
  });
  res.json({ alreadyAwarded: false, achievement: created });
});

export default router;