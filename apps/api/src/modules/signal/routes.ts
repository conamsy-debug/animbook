/**
 * AnimBook SIGNAL — page-level engagement telemetry.
 *
 * Per Constraint #11, the signal data is opt-in and never sold to third
 * parties. The Reader posts a `PageSignalEvent` on every page flip, the
 * teacher dashboard consumes aggregated views.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";

const router = Router();
router.use(authMiddleware);

const eventSchema = z.object({
  bookId: z.string().min(1),
  pageNum: z.number().int().min(1),
  vertical: z.string().min(1),
  dwellMs: z.number().int().min(0),
  scrolledBack: z.boolean().optional(),
  abandoned: z.boolean().optional()
});

router.post("/page", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid signal", details: parsed.error.flatten() });
    return;
  }
  const book = await prisma.book.findFirst({ where: { OR: [{ id: parsed.data.bookId }, { slug: parsed.data.bookId }] } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const event = await prisma.pageSignalEvent.create({
    data: {
      userId,
      bookId: book.id,
      pageNum: parsed.data.pageNum,
      vertical: parsed.data.vertical,
      dwellMs: parsed.data.dwellMs,
      scrolledBack: parsed.data.scrolledBack ?? false,
      abandoned: parsed.data.abandoned ?? false
    }
  });
  res.status(201).json({ event });
});

router.get("/teacher", async (req: AuthedRequest, res: Response) => {
  const slugParam = typeof req.query["bookSlug"] === "string" ? req.query["bookSlug"] : null;
  const book = await prisma.book.findFirst({
    where: slugParam
      ? { OR: [{ id: slugParam }, { slug: slugParam }] }
      : { vertical: "EDU" },
    select: { id: true, slug: true, title: true, totalPages: true }
  });
  if (!book) {
    res.status(404).json({ error: "No book selected" });
    return;
  }
  const events = await prisma.pageSignalEvent.findMany({
    where: { bookId: book.id },
    orderBy: { createdAt: "desc" },
    take: 1000
  });
  const perPage = new Map<number, { dwellMs: number[]; abandoned: number; scrolledBack: number; users: Set<string> }>();
  for (const ev of events) {
    const entry = perPage.get(ev.pageNum) ?? { dwellMs: [], abandoned: 0, scrolledBack: 0, users: new Set() };
    entry.dwellMs.push(ev.dwellMs);
    if (ev.abandoned) entry.abandoned += 1;
    if (ev.scrolledBack) entry.scrolledBack += 1;
    entry.users.add(ev.userId);
    perPage.set(ev.pageNum, entry);
  }
  const pages = [...perPage.entries()].map(([pageNum, entry]) => ({
    pageNum,
    readers: entry.users.size,
    avgDwellMs: Math.round(entry.dwellMs.reduce((a, b) => a + b, 0) / Math.max(1, entry.dwellMs.length)),
    abandoned: entry.abandoned,
    scrolledBack: entry.scrolledBack,
    dropOffScore: entry.abandoned + entry.scrolledBack * 2
  })).sort((a, b) => b.dropOffScore - a.dropOffScore);
  res.json({ book, pageSignals: pages });
});

export default router;