import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { createCheckoutSession, stripeStatus } from "../../services/stripe.js";

const router = Router();
router.use(authMiddleware);

router.get("/status", (_req: Request, res: Response) => {
  res.json({ stripe: stripeStatus });
});

router.post("/checkout", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const schema = z.object({
    plan: z.enum(["PREMIUM", "ENTERPRISE"]),
    successUrl: z.string().url(),
    cancelUrl: z.string().url()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid checkout payload", details: parsed.error.flatten() });
    return;
  }
  const session = await createCheckoutSession({
    userId,
    plan: parsed.data.plan,
    successUrl: parsed.data.successUrl,
    cancelUrl: parsed.data.cancelUrl
  });
  res.json(session);
});

router.post("/portal", async (req: AuthedRequest, res: Response) => {
  requireUserId(req);
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { stripeCustomerId: true } });
  if (!user?.stripeCustomerId) {
    res.status(404).json({ error: "No Stripe customer for user" });
    return;
  }
  if (!stripeStatus.live) {
    res.json({ url: `${parsedOrigin()}/profile?demo_portal=1`, source: "stub" });
    return;
  }
  const response = await fetch(`https://api.stripe.com/v1/billing_portal/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ customer: user.stripeCustomerId }).toString()
  });
  if (!response.ok) {
    res.status(502).json({ error: "Stripe portal failed" });
    return;
  }
  const json = (await response.json()) as { url: string };
  res.json({ url: json.url, source: "stripe" });
});

function parsedOrigin(): string {
  return process.env.WEB_ORIGIN ?? "http://localhost:3000";
}

export default router;