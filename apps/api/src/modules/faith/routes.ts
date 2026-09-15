/**
 * FAITH review workflow.
 *
 * Constraint #4 — EDU and FAITH content require human expert review before
 * publication. The Studio publish endpoint already enforces 409 unless the
 * book is APPROVED; this module adds the actual review lifecycle:
 *
 *   1. Creator submits the book for review (`POST /api/faith/reviews/request`).
 *   2. A theological advisor picks up the review and submits a decision.
 *   3. Decisions are immutable and tracked in `ReviewDecision`.
 *   4. When any decision is APPROVED, the book's `expertReviewStatus`
 *      flips to APPROVED and the Studio publish endpoint unlocks.
 *
 * Iconographic concerns are surfaced separately so creators can fix
 * them and resubmit without losing history.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";

const router = Router();
router.use(authMiddleware);

const requestSchema = z.object({
  bookId: z.string().min(1),
  framework: z.enum(["KENYA_CBC", "COMMON_CORE", "NGSS", "CAMBRIDGE_IGCSE", "IB", "NCERT_INDIA", "CAPS_SOUTH_AFRICA"]),
  notes: z.string().min(1)
});

router.post("/reviews/request", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid review request", details: parsed.error.flatten() });
    return;
  }
  const book = await prisma.book.findFirst({
    where: { OR: [{ id: parsed.data.bookId }, { slug: parsed.data.bookId }] },
    include: { studioProject: true }
  });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  if (book.studioProject?.ownerId !== userId) {
    res.status(403).json({ error: "Only the creator can request a review" });
    return;
  }
  if (book.vertical !== "EDU" && book.vertical !== "FAITH") {
    res.status(400).json({ error: "Only EDU or FAITH content requires review" });
    return;
  }
  await prisma.book.update({
    where: { id: book.id },
    data: {
      requiresExpertReview: true,
      expertReviewStatus: "PENDING",
      iconographicNotes: book.iconographicNotes ?? parsed.data.notes
    }
  });
  res.json({ ok: true, status: "PENDING", framework: parsed.data.framework });
});

const decisionSchema = z.object({
  bookId: z.string().min(1),
  framework: z.string().min(1),
  status: z.enum(["APPROVED", "CHANGES_REQUESTED"]),
  notes: z.string().min(1),
  iconographicConcerns: z.array(z.string()).default([])
});

router.post("/reviews/decide", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid decision", details: parsed.error.flatten() });
    return;
  }
  const reviewer = await prisma.user.findUnique({ where: { id: userId } });
  if (!reviewer || !reviewer.roles.includes("theological_advisor")) {
    res.status(403).json({ error: "Only theological advisors can record review decisions" });
    return;
  }
  const book = await prisma.book.findFirst({ where: { OR: [{ id: parsed.data.bookId }, { slug: parsed.data.bookId }] } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const decision = await prisma.reviewDecision.create({
    data: {
      bookId: book.id,
      reviewerId: userId,
      framework: parsed.data.framework,
      status: parsed.data.status,
      notes: parsed.data.notes,
      iconographicConcerns: parsed.data.iconographicConcerns
    }
  });
  await prisma.book.update({
    where: { id: book.id },
    data: {
      expertReviewStatus: parsed.data.status,
      iconographicNotes: parsed.data.iconographicConcerns.join("\n") || book.iconographicNotes
    }
  });
  res.json({ decision });
});

router.get("/reviews/queue", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const reviewer = await prisma.user.findUnique({ where: { id: userId } });
  if (!reviewer || !reviewer.roles.includes("theological_advisor")) {
    res.status(403).json({ error: "Only theological advisors can view the review queue" });
    return;
  }
  const books = await prisma.book.findMany({
    where: { requiresExpertReview: true, expertReviewStatus: { in: ["PENDING", "IN_REVIEW"] } },
    include: {
      pages: { select: { pageNum: true, textExcerpt: true, sceneType: true, animationPrompt: true } },
      studioProject: { select: { name: true, ownerId: true } }
    },
    orderBy: { updatedAt: "asc" }
  });
  res.json({ items: books });
});

router.get("/reviews/:bookId/history", async (req: AuthedRequest, res: Response) => {
  const bookId = req.params["bookId"];
  if (typeof bookId !== "string") {
    res.status(400).json({ error: "Missing book id" });
    return;
  }
  const book = await prisma.book.findFirst({
    where: { OR: [{ id: bookId }, { slug: bookId }] },
    include: {
      reviewDecisions: {
        orderBy: { createdAt: "desc" },
        include: { reviewer: { select: { id: true, name: true, email: true } } }
      }
    }
  });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  res.json({ book: { id: book.id, slug: book.slug, title: book.title, vertical: book.vertical, expertReviewStatus: book.expertReviewStatus }, history: book.reviewDecisions });
});

export default router;