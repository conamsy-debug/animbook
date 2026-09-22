/**
 * AnimBook Languages (Phase 1) — backend placeholder.
 *
 * Scaffolding only. The real endpoints land in later patches per
 * docs/languages-phase1.md. This module:
 *   - exposes a health route so we can verify the router mounts
 *   - responds 404 on every other path so the feature is invisible
 *     until Patch 02+ wires up real tables and handlers
 *
 * The whole router is mounted conditionally in src/index.ts based on
 * isFeatureEnabled("LANGUAGES"), so even this placeholder is invisible
 * when the LANGUAGES_ENABLED env flag is off.
 */
import type { Request, Response } from "express";
import { Router } from "express";

const router = Router();

/**
 * Liveness probe for the Languages module. Used by the integration
 * test (apps/api/tests/languagesModule.test.mjs) and by ops to confirm
 * the feature is wired up after a deploy. Returns a small JSON body
 * with the feature flag status so we can verify gating from a curl.
 */
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    feature: "languages",
    patch: "01-scaffold",
    status: "placeholder"
  });
});

export default router;
