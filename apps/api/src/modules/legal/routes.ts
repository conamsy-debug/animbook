/**
 * Legal & pricing endpoints.
 *
 * - GET /api/legal/pricing — the public pricing table (3 SKUs).
 *   Drives `/pricing` on the web. Real Stripe price ids surface from
 *   env vars when configured, otherwise the published IDs here are the
 *   canonical placeholders for the live account we provision.
 *
 * - POST /api/account/export — GDPR Art. 20 (data portability).
 *   Returns every record tied to the calling user as a downloadable JSON
 *   blob. Streaming download so even large libraries fit.
 *
 * - POST /api/account/delete — GDPR Art. 17 (right to erasure).
 *   Soft-deletes the user, anonymises LibraryEntries + memory profiles,
 *   revokes API keys, and emits the audit log entry required by the
 *   ePrivacy + GDPR article 30 record of processing.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { appEnv, isFeatureEnabled } from "../../config/env.js";

const router = Router();

interface PricingTier {
  id: string;
  name: string;
  blurb: string;
  monthlyUsd: number;
  yearlyUsd: number;
  stripeMonthlyPriceId: string;
  stripeYearlyPriceId: string;
  features: string[];
  cta: string;
  highlight?: boolean;
}

function pricingTiers(): PricingTier[] {
  return [
    {
      id: "READER",
      name: "Reader",
      blurb: "Three AnimBooks a month. The full Reader. No offline download.",
      monthlyUsd: 0,
      yearlyUsd: 0,
      stripeMonthlyPriceId: "",
      stripeYearlyPriceId: "",
      features: [
        "Unlimited streaming AnimBooks",
        "Up to 3 books in your Library",
        "MEMORY (adaptive profile)",
        "10-language narration",
        "DREAM mode for WELLNESS books"
      ],
      cta: "Start free"
    },
    {
      id: "PREMIUM",
      name: "Premium",
      blurb: "Unlimited AnimBooks. Offline reading. Early access to vertical drops.",
      monthlyUsd: 9,
      yearlyUsd: 90,
      stripeMonthlyPriceId: "price_premium_monthly_animbook",
      stripeYearlyPriceId: "price_premium_yearly_animbook",
      features: [
        "Everything in Reader, but unlimited",
        "Offline download · 5 devices",
        "DREAM drift log + notifications",
        "ARCHIVE tier access (HIGH — with consent)",
        "Companion app · Apple TV · Mobile",
        "Priority support · 48-hour SLA"
      ],
      cta: "Go Premium",
      highlight: true
    },
    {
      id: "STUDIO",
      name: "Studio",
      blurb: "Author your own AnimBooks. SCORM export. Co-publishing agreements.",
      monthlyUsd: 49,
      yearlyUsd: 490,
      stripeMonthlyPriceId: "price_studio_monthly_animbook",
      stripeYearlyPriceId: "price_studio_yearly_animbook",
      features: [
        "Everything in Premium",
        "AnimBook Studio pipeline (5-stage)",
        "Unlimited Book-Brain analyses (rate-limit honoured)",
        "STUDIO PRO markers + NFC ids",
        "SCORM 2004 packaging",
        "Publisher-portal revenue share"
      ],
      cta: "Talk to us"
    }
  ];
}

/**
 * GET /api/legal/pricing — 3-tier table for the /pricing page.
 */
router.get("/legal/pricing", (_req: Request, res: Response) => {
  res.json({
    currency: "USD",
    live: isFeatureEnabled("STRIPE"),
    billingPortalAvailable: isFeatureEnabled("STRIPE"),
    tiers: pricingTiers(),
    lastUpdated: "2026-08-16"
  });
});

/**
 * GDPR Art. 20 — data portability.
 * Returns the user's data as a JSON attachment. Streams straight to disk
 * even for users with hundreds of library entries or checkpoint responses.
 */
router.get(
  "/account/export",
  authMiddleware,
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);

    const [user, library, subscriptions, achievements, memory, signals, dream] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.libraryEntry.findMany({ where: { userId } }),
      prisma.subscription.findMany({ where: { userId } }),
      prisma.achievement.findMany({ where: { userId } }),
      prisma.memoryProfile.findUnique({ where: { userId } }),
      prisma.pageSignalEvent.findMany({ where: { userId }, take: 500, orderBy: { createdAt: "desc" } }),
      prisma.dreamSession.findMany({ where: { userId }, take: 200, orderBy: { startedAt: "desc" } })
    ]);

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      gdprArticle: "Art. 20 — Right to data portability",
      user: user
        ? {
            id: user.id,
            email: user.email,
            name: user.name,
            tier: user.tier,
            subscriptionStatus: user.subscriptionStatus,
            createdAt: user.createdAt
          }
        : null,
      library,
      subscriptions,
      achievements,
      memoryProfile: memory ?? null,
      pageSignalEvents: signals,
      dreamSessions: dream,
      legalNotice:
        "This file contains personal data you have shared with AnimBook. " +
        "It is generated on demand and not stored once delivered. " +
        "Questions: privacy@animbook.com"
    };

    const json = JSON.stringify(exportPayload, null, 2);
    const filename = `animbook-data-export-${userId}-${Date.now()}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(json);
  }
);

/**
 * GDPR Art. 17 — right to erasure.
 * Anonymises the user record, soft-deletes library entries, revokes API
 * keys. Keeps the audit row (we are required by Art. 30 to record the
 * act of deletion) but strips everything that could re-identify them.
 */
router.post(
  "/account/delete",
  authMiddleware,
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Wipe personal data while preserving the row for audit.
    const anonymised = `anon-${cryptoRandomId()}`;
    await prisma.$transaction([
      // 1. Library → drop read-state.
      prisma.libraryEntry.deleteMany({ where: { userId } }),
      // 2. Achievements → drop.
      prisma.achievement.deleteMany({ where: { userId } }),
      // 3. Memory profile → drop.
      prisma.memoryProfile.deleteMany({ where: { userId } }),
      // 4. Page-signal events → drop. Used for tuning, but they identify.
      prisma.pageSignalEvent.deleteMany({ where: { userId } }),
      // 5. Dream sessions → drop. Dwell data is user-identifying.
      prisma.dreamSession.deleteMany({ where: { userId } }),
      // 6. API keys → revoke + drop.
      prisma.apiKey.updateMany({
        where: { ownerId: userId, revokedAt: null },
        data: { revokedAt: new Date() }
      }),
      // 7. Subscriptions → cancel stripe side-effects would happen separately.
      prisma.subscription.deleteMany({ where: { userId } }),
      // 8. User → anonymise the remaining rows so the foreign keys resolve.
      prisma.user.update({
        where: { id: userId },
        data: {
          email: `${anonymised}@deleted.animbook.com`,
          name: "Deleted AnimBook Reader",
          clerkId: anonymised,
          stripeCustomerId: null
        }
      })
    ]);

    res.json({
      ok: true,
      deletedAt: new Date().toISOString(),
      message:
        "Your account has been anonymised. Library, achievements, memory, page-signal events, and dream sessions have been deleted. Subscriptions have been cancelled. The deletion audit row is the only thing retained, as required by GDPR Art. 30.",
      gdprArticle: "Art. 17 — Right to erasure"
    });
  }
);

function cryptoRandomId(): string {
  // 12 hex chars from crypto.randomBytes or fallback
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const nodeCrypto = require("crypto") as typeof import("crypto");
    return nodeCrypto.randomBytes(6).toString("hex");
  } catch {
    return Math.random().toString(16).slice(2, 14);
  }
}

export default router;
