// Marketing share + trailer routes.
// The /share/<token> URL is the canonical marketing surface a creator drops
// into a social bio. The trailer gets generated once per share; the same
// share keeps its click counter forever so creators can rotate tokens
// across re-launches without losing historical data.
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import { enqueuePipeline } from "../../services/pipeline.js";
import { generateShareToken } from "../../services/trailer.js";

export const sharePublicRouter = Router();
const shareAuthedRouter = Router();
shareAuthedRouter.use(authMiddleware);

const createSchema = z.object({
  hook: z.string().trim().min(10, "Hook must be at least 10 characters").max(600, "Hook capped at 600 characters")
});

/**
 * POST /api/books/:id/share — author creates a marketing share for a book.
 * Body: { hook }. Authenticated. Returns the new share token immediately;
 * trailer generation runs async in the Bull queue.
 */
shareAuthedRouter.post(
  "/books/:id/share",
  rateLimit({ name: "share.create", max: 20, windowSeconds: 3600 }),
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);
    const id = req.params["id"];
    if (typeof id !== "string") {
      res.status(400).json({ error: "Missing book id" });
      return;
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid hook", details: parsed.error.flatten() });
      return;
    }
    const book = await prisma.book.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      select: {
        id: true,
        slug: true,
        title: true,
        coverUrl: true,
        creatorId: true,
        studioProject: { select: { id: true, ownerId: true } }
      }
    });
    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    const isOwner =
      book.creatorId === userId ||
      book.studioProject?.ownerId === userId;
    if (!isOwner) {
      res.status(403).json({ error: "Only the author can create a share for this book" });
      return;
    }
    const projectId = book.studioProject?.id;
    if (!projectId) {
      res.status(409).json({ error: "This book was not created in Studio and can't generate a trailer" });
      return;
    }
    let share;
    try {
      share = await prisma.bookShare.create({
        data: {
          bookId: book.id,
          token: generateShareToken(),
          hook: parsed.data.hook,
          status: "PENDING"
        }
      });
    } catch (err) {
      // Extremely rare collision on the 8-char token space; retry once.
      console.warn(`[share] create collision, retry: ${(err as Error).message.slice(0, 100)}`);
      share = await prisma.bookShare.create({
        data: {
          bookId: book.id,
          token: generateShareToken(),
          hook: parsed.data.hook,
          status: "PENDING"
        }
      });
    }

    try {
      const jobId = await enqueuePipeline({
        projectId,
        triggerStage: "TRAILER_GENERATION",
        shareId: share.id
      });
      res.status(201).json({
        share: {
          id: share.id,
          token: share.token,
          status: share.status,
          hook: share.hook,
          trailerUrl: null,
          createdAt: share.createdAt
        },
        jobId,
        url: `/share/${share.token}`
      });
    } catch (err) {
      console.warn(`[share] enqueue failed: ${(err as Error).message}`);
      await prisma.bookShare.update({
        where: { id: share.id },
        data: { status: "FAILED", failureReason: "Queue offline — try again in a moment." }
      });
      res.status(503).json({ error: "Trailer queue is offline; please retry." });
    }
  }
);

/**
 * GET /api/books/:id/shares — author lists their existing shares
 * (newest first, capped at 50) along with click counts.
 */
shareAuthedRouter.get(
  "/books/:id/shares",
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);
    const id = req.params["id"];
    if (typeof id !== "string") {
      res.status(400).json({ error: "Missing book id" });
      return;
    }
    const book = await prisma.book.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      select: { id: true, creatorId: true, studioProject: { select: { ownerId: true } } }
    });
    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    if (book.creatorId !== userId && book.studioProject?.ownerId !== userId) {
      res.status(403).json({ error: "Only the author can list shares" });
      return;
    }
    const shares = await prisma.bookShare.findMany({
      where: { bookId: book.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { _count: { select: { clicks: true } } }
    });
    res.json({
      shares: shares.map((s) => ({
        id: s.id,
        token: s.token,
        hook: s.hook,
        trailerUrl: s.trailerUrl,
        thumbnailUrl: s.thumbnailUrl,
        status: s.status,
        failureReason: s.failureReason,
        clickCount: s._count.clicks,
        createdAt: s.createdAt,
        url: `/share/${s.token}`
      }))
    });
  }
);

/**
 * GET /api/share/:token — public landing metadata. Increments click counter
 * as a side effect — readers see the trailer; authors see the traffic.
 * Resolves only ACTIVE shares (PENDING shows "still preparing" page;
 * FAILED shows the same; REVOKED returns 410).
 */
sharePublicRouter.get("/:token", async (req: Request, res: Response) => {
  const token = req.params["token"];
  if (typeof token !== "string" || !/^[a-z0-9]{4,16}$/.test(token)) {
    res.status(404).json({ error: "Share not found" });
    return;
  }
  const share = await prisma.bookShare.findUnique({
    where: { token },
    include: {
      book: {
        select: {
          id: true,
          slug: true,
          title: true,
          subtitle: true,
          author: true,
          coverUrl: true,
          synopsis: true,
          vertical: true,
          status: true
        }
      }
    }
  });
  if (!share) {
    res.status(404).json({ error: "Share not found" });
    return;
  }
  if (share.status === "REVOKED") {
    res.status(410).json({ error: "This share link has been revoked" });
    return;
  }
  if (share.book.status !== "PUBLISHED") {
    res.status(410).json({ error: "This book is no longer available" });
    return;
  }

  // Best-effort click recording. Failure doesn't block the response.
  const referer = typeof req.headers.referer === "string" ? req.headers.referer.slice(0, 500) : null;
  try {
    await prisma.shareClick.create({
      data: { shareId: share.id, referer }
    });
  } catch (err) {
    console.warn(`[share] click log failed: ${(err as Error).message.slice(0, 100)}`);
  }

  res.json({
    token: share.token,
    status: share.status,
    hook: share.hook,
    failureReason: share.failureReason,
    trailerUrl: share.trailerUrl,
    thumbnailUrl: share.thumbnailUrl,
    book: share.book,
    bookUrl: `/book/${share.book.slug}`
  });
});

/**
 * DELETE /api/books/:id/share/:token — author revokes a share token.
 * Just flips status to REVOKED so /share/<token> returns 410 but keeps
 * the row + its click history for posterity.
 */
shareAuthedRouter.delete(
  "/books/:id/share/:token",
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);
    const id = req.params["id"];
    const token = req.params["token"];
    if (typeof id !== "string" || typeof token !== "string") {
      res.status(400).json({ error: "Missing identifier" });
      return;
    }
    const book = await prisma.book.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      select: { id: true, creatorId: true, studioProject: { select: { ownerId: true } } }
    });
    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    if (book.creatorId !== userId && book.studioProject?.ownerId !== userId) {
      res.status(403).json({ error: "Only the author can revoke shares" });
      return;
    }
    const result = await prisma.bookShare.updateMany({
      where: { bookId: book.id, token },
      data: { status: "REVOKED" }
    });
    if (result.count === 0) {
      res.status(404).json({ error: "Share not found" });
      return;
    }
    res.json({ ok: true });
  }
);

export default shareAuthedRouter;
