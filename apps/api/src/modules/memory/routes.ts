import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { getOrCreateMemoryProfile, updateMemoryProfile, adaptMemoryProfile } from "../../services/memory.js";

const router = Router();
router.use(authMiddleware);

router.get("/settings", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const profile = await getOrCreateMemoryProfile(userId);
  res.json({ profile });
});

const updateSchema = z.object({
  palette: z.string().min(1).optional(),
  pacing: z.string().min(1).optional(),
  cameraStyle: z.string().min(1).optional(),
  narrationSpeed: z.number().min(0.5).max(2).optional(),
  fontSize: z.number().int().min(14).max(36).optional(),
  motionLevel: z.number().min(0).max(2).optional(),
  lensEnabled: z.boolean().optional(),
  echoEnabled: z.boolean().optional()
});

router.put("/settings", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid memory preferences", details: parsed.error.flatten() });
    return;
  }
  const profile = await updateMemoryProfile(userId, parsed.data);
  res.json({ profile });
});

const adaptSchema = z.object({
  signal: z.array(
    z.object({
      vertical: z.string(),
      emotionalRegister: z.string().nullable().optional(),
      timePerPageMs: z.number().int().min(0)
    })
  ).min(1)
}).transform((data) => ({
  signal: data.signal.map((entry) => ({
    vertical: entry.vertical,
    emotionalRegister: entry.emotionalRegister ?? null,
    timePerPageMs: entry.timePerPageMs
  }))
}));

router.post("/adapt", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const parsed = adaptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid signal", details: parsed.error.flatten() });
    return;
  }
  const profile = await adaptMemoryProfile(userId, parsed.data.signal);
  res.json({ profile });
});

export default router;