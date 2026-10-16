/**
 * "Me" routes — cross-cutting user preferences that don't fit any
 * single feature module. Currently just the UI-locale preference so
 * the language switcher can persist the visitor's choice on the
 * user row (synced across devices, not just via cookie).
 */
import { Router } from "express";
import { prisma } from "../../db.js";
import { authMiddleware, requireUserId } from "../../auth/middleware.js";

/** Keep in lockstep with `apps/web/src/i18n/config.ts`. */
const ALLOWED_LOCALES = [
  "en",
  "fr",
  "es",
  "pt-BR",
  "sw",
  "ar",
  "hi",
  "zh-CN",
  "de"
] as const;
type Locale = (typeof ALLOWED_LOCALES)[number];

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (ALLOWED_LOCALES as readonly string[]).includes(value);
}

const router = Router();

/**
 * POST /me/locale
 * Body: { locale: "en" | "fr" | "es" | "pt-BR" | "sw" | "ar" | "hi" | "zh-CN" | "de" }
 * Persists the visitor's preferred UI locale on their user row.
 * Idempotent — repeated writes are no-ops apart from `updatedAt`.
 */
router.post("/me/locale", authMiddleware, async (req, res) => {
  const userId = requireUserId(req as Parameters<typeof requireUserId>[0]);
  const raw = (req.body as { locale?: unknown })?.locale;
  if (!isLocale(raw)) {
    res.status(400).json({
      error: "invalid locale",
      code: "invalid_locale",
      allowedLocales: ALLOWED_LOCALES
    });
    return;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { preferredLocale: raw }
  });
  res.json({ ok: true, locale: raw });
});

export default router;
