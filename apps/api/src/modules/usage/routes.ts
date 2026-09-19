/**
 * GET /api/usage/summary — aggregate cost dashboard.
 *
 * Auth: any signed-in user. The summary is scoped to the caller's
 * `userId` so authors can't see each other's spend. The default
 * window is the last 30 days; the `since` query param accepts an ISO
 * date (YYYY-MM-DD) and clamps to the last 365 days.
 *
 * Returns: totalUsd + per-kind / per-provider / per-book / per-day
 * breakdowns. The Profile "Spending" section reads this directly.
 */
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { getUsageSummary } from "../../services/usageTracking.js";
import { rateLimit } from "../../middleware/rateLimit.js";

const router = Router();
router.use(authMiddleware);

const querySchema = z.object({
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

router.get(
  "/summary",
  rateLimit({ name: "usage.summary", max: 30, windowSeconds: 60 }),
  async (req: AuthedRequest, res) => {
    const userId = requireUserId(req);
    const parsed = querySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
      return;
    }
    // Clamp the window to the last 365 days — older data is rarely
    // useful for "spent this week/month" and the query gets slow.
    let since: Date;
    if (parsed.data.since) {
      const parsedDate = new Date(parsed.data.since + "T00:00:00.000Z");
      const earliest = new Date(Date.now() - 365 * 86_400_000);
      since = parsedDate < earliest ? earliest : parsedDate;
    } else {
      since = new Date(Date.now() - 30 * 86_400_000);
    }
    const summary = await getUsageSummary(userId, since);
    res.json({
      windowStart: since.toISOString(),
      ...summary
    });
  }
);

export default router;
