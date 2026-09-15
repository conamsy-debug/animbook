/**
 * Creator Portal.
 *
 * Self-serve publishing surfaces for AnimBook creators:
 *   - GET /api/creator/projects       — list my Studio projects + analytics.
 *   - GET /api/creator/royalties       — rolling royalty summary for my books.
 *   - POST /api/creator/publish/:slug — self-serve publish (delegates to
 *                                          Studio's publish endpoint, but here
 *                                          we expose a friendlier path that
 *                                          handles the EDU/FAITH gate for the
 *                                          creator).
 *   - GET /api/creator/catalog         — browse the public catalogue with
 *                                          creator-side revenue context.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";

const router = Router();
router.use(authMiddleware);

router.get("/projects", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const projects = await prisma.studioProject.findMany({
    where: { ownerId: userId },
    include: { book: { select: { id: true, slug: true, title: true, status: true, vertical: true, totalPages: true, expertReviewStatus: true, requiresExpertReview: true } } },
    orderBy: { updatedAt: "desc" }
  });
  res.json({ items: projects });
});

router.get("/royalties", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const entries = await prisma.royaltyEntry.findMany({
    where: { payeeId: userId },
    include: { book: { select: { id: true, slug: true, title: true, vertical: true } } },
    orderBy: { periodEnd: "desc" }
  });
  const totalCents = entries.reduce((sum, entry) => sum + entry.amountCents, 0);
  res.json({
    items: entries,
    totalCents,
    totalUsd: (totalCents / 100).toFixed(2)
  });
});

router.get("/catalog", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  void userId;
  const items = await prisma.book.findMany({
    where: { status: "PUBLISHED" },
    select: {
      id: true,
      slug: true,
      title: true,
      author: true,
      vertical: true,
      genreTags: true,
      coverUrl: true,
      totalPages: true,
      language: true
    },
    orderBy: { updatedAt: "desc" }
  });
  res.json({ items });
});

router.post("/publish/:slug", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const slug = req.params["slug"];
  if (typeof slug !== "string") {
    res.status(400).json({ error: "Missing slug" });
    return;
  }
  const project = await prisma.studioProject.findFirst({
    where: { ownerId: userId, book: { slug } },
    include: { book: true }
  });
  if (!project?.book) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (project.book.requiresExpertReview && project.book.expertReviewStatus !== "APPROVED") {
    res.status(409).json({
      error: "Expert review required",
      expertReviewStatus: project.book.expertReviewStatus
    });
    return;
  }
  await prisma.studioProject.update({
    where: { id: project.id },
    data: { status: "PUBLISHED", approvedForPublishAt: new Date() }
  });
  await prisma.book.update({ where: { id: project.book.id }, data: { status: "PUBLISHED" } });
  res.json({ ok: true, slug: project.book.slug });
});

export default router;