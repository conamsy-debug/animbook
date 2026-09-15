/**
 * AnimBook DREAM — runtime sleep-mode for the WELLNESS vertical.
 *
 * Endpoints:
 *   GET  /api/dream/profile/:bookId       → reader picks up the dream profile
 *   POST /api/dream/sessions              → start a session (or resume open)
 *   PUT  /api/dream/sessions/:id          → log page progress
 *   POST /api/dream/sessions/:id/end      → close the session, mark sleep
 *   GET  /api/dream/sessions              → list the user's recent sessions
 *   GET  /api/dream/ambient               → list ambient track library
 *
 * The "fell asleep" signal is determined by the Reader — it watches
 * dwell-time and progress events. If no progress was recorded for ≥
 * DREAM_SLEEP_THRESHOLD_MS when the session is closed, we mark the
 * session as a successful drift.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import {
  DREAM_AMBIENT_LIBRARY,
  dreamProfileForBook,
  ensureDreamSession,
  endDreamSession,
  recordDreamProgress,
  recentDreamSessions
} from "../../services/dream.js";

const router = Router();
router.use(authMiddleware);

router.get("/ambient", (_req: Request, res: Response) => {
  res.json({ tracks: Object.entries(DREAM_AMBIENT_LIBRARY).map(([slug, info]) => ({ slug, ...info })) });
});

router.get("/profile/:bookId", async (req: AuthedRequest, res: Response) => {
  const bookId = req.params["bookId"];
  if (typeof bookId !== "string") {
    res.status(400).json({ error: "Missing bookId" });
    return;
  }
  const book = await prisma.book.findFirst({
    where: { OR: [{ id: bookId }, { slug: bookId }] },
    select: { id: true, slug: true, title: true, author: true, vertical: true, moodTags: true, genreTags: true }
  });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const profile = dreamProfileForBook(book);
  res.json({
    book,
    active: book.vertical === "WELLNESS",
    profile,
    integration: { live: false, mode: "deterministic" }
  });
});

const startSchema = z.object({
  bookId: z.string().min(1),
  ambientTrack: z.enum(["ocean_waves", "rainforest", "fireplace", "river", "white_noise"]).optional()
});

router.post("/sessions", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const book = await prisma.book.findFirst({
    where: { OR: [{ id: parsed.data.bookId }, { slug: parsed.data.bookId }] },
    select: { id: true, vertical: true }
  });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  if (book.vertical !== "WELLNESS") {
    res.status(409).json({ error: "DREAM is only available for WELLNESS vertical books." });
    return;
  }
  const session = await ensureDreamSession(userId, book.id);
  if (parsed.data.ambientTrack) {
    await prisma.dreamSession.update({ where: { id: session.id }, data: { ambientTrack: parsed.data.ambientTrack } });
  }
  const refreshed = await prisma.dreamSession.findUnique({ where: { id: session.id } });
  res.status(201).json({ session: refreshed });
});

const progressSchema = z.object({
  pagesRead: z.number().int().min(0)
});

router.put("/sessions/:id", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing session id" });
    return;
  }
  const parsed = progressSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const session = await prisma.dreamSession.findUnique({ where: { id } });
  if (!session || session.userId !== userId) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await recordDreamProgress(id, parsed.data.pagesRead);
  const refreshed = await prisma.dreamSession.findUnique({ where: { id } });
  res.json({ session: refreshed });
});

const endSchema = z.object({
  reason: z.string().min(1).max(500).default("reader_closed"),
  fellAsleep: z.boolean().default(false)
});

router.post("/sessions/:id/end", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing session id" });
    return;
  }
  const parsed = endSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const session = await prisma.dreamSession.findUnique({ where: { id } });
  if (!session || session.userId !== userId) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await endDreamSession(session.id, parsed.data.reason, parsed.data.fellAsleep);
  const refreshed = await prisma.dreamSession.findUnique({ where: { id } });
  res.json({ ok: true, session: refreshed });
});

router.get("/sessions", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const limitCoerced = req.query["limit"];
  const limit = typeof limitCoerced === "string" ? Math.min(50, Math.max(1, Number.parseInt(limitCoerced, 10) || 10)) : 10;
  const items = await recentDreamSessions(userId, limit);
  res.json({ items });
});

export default router;
