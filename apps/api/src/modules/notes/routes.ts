/**
 * Margin notes: short notes readers leave on a page, visible to other readers.
 *
 * GET    /api/notes/pages/:pageId        — notes on a page
 * POST   /api/notes/pages/:pageId        — leave a note (screened)
 * DELETE /api/notes/:id                  — remove your own note
 * GET    /api/notes/books/:bookId/counts — notes per page, for the reader
 */
import type { Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import { screenText, statusFor } from "../../services/moderation.js";

const router = Router();
router.use(authMiddleware);

const MAX = 280;

const noteAuthor = { id: true, name: true, handle: true, avatarUrl: true } as const;

/** Ids this reader has blocked, or who have blocked them — hidden both ways. */
async function hiddenUserIds(userId: string): Promise<string[]> {
  const blocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true }
  });
  return blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId));
}

router.get("/pages/:pageId", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const pageId = String(req.params["pageId"]);
  const hidden = await hiddenUserIds(userId);
  const notes = await prisma.pageNote.findMany({
    where: {
      pageId,
      userId: { notIn: hidden },
      // Your own notes are always yours to see, including ones awaiting review.
      OR: [{ status: "VISIBLE" }, { userId }]
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, text: true, status: true, createdAt: true, user: { select: noteAuthor } }
  });
  res.json({
    notes: notes
      .filter((n) => n.status !== "REMOVED" || n.user.id === userId)
      .map((n) => ({
        id: n.id,
        text: n.text,
        createdAt: n.createdAt,
        mine: n.user.id === userId,
        pending: n.status === "HELD",
        removed: n.status === "REMOVED",
        author: { id: n.user.id, name: n.user.name, handle: n.user.handle, avatarUrl: n.user.avatarUrl }
      }))
  });
});

router.post(
  "/pages/:pageId",
  rateLimit({ name: "notes.create", max: 20, windowSeconds: 600 }),
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);
    const parsed = z.object({ text: z.string().trim().min(2).max(MAX) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: `Notes are 2–${MAX} characters` });
      return;
    }
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { communityDisabled: true } });
    if (me?.communityDisabled) {
      res.status(403).json({ error: "Notes are switched off for this account" });
      return;
    }
    const page = await prisma.page.findUnique({
      where: { id: String(req.params["pageId"]) },
      select: { id: true, bookId: true, textExcerpt: true, book: { select: { title: true, vertical: true } } }
    });
    if (!page) {
      res.status(404).json({ error: "Page not found" });
      return;
    }

    const screening = await screenText(parsed.data.text, `a note on a page of "${page.book.title}"`);
    if (screening.verdict === "block") {
      const selfHarm = /self.harm|suicide|hurt (your|them)self/i.test(`${screening.reason ?? ""} ${parsed.data.text}`);
      res.status(422).json({
        error: selfHarm
          ? "We couldn't post that note. If you're going through something difficult, talking to someone you trust — or a local helpline — can help."
          : "That note can't be posted here.",
        support: selfHarm
      });
      return;
    }

    const note = await prisma.pageNote.create({
      data: { pageId: page.id, bookId: page.bookId, userId, text: parsed.data.text, status: statusFor(screening) },
      select: { id: true, text: true, status: true, createdAt: true, user: { select: noteAuthor } }
    });
    res.status(201).json({
      note: {
        id: note.id,
        text: note.text,
        createdAt: note.createdAt,
        mine: true,
        pending: note.status === "HELD",
        removed: false,
        author: { id: note.user.id, name: note.user.name, handle: note.user.handle, avatarUrl: note.user.avatarUrl }
      },
      held: note.status === "HELD"
    });
  }
);

router.delete("/:id", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const note = await prisma.pageNote.findUnique({ where: { id: String(req.params["id"]) }, select: { id: true, userId: true } });
  if (!note || note.userId !== userId) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  await prisma.pageNote.delete({ where: { id: note.id } });
  res.json({ ok: true });
});

/** How many notes each page of a book has, so the reader can show a count. */
router.get("/books/:bookId/counts", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const hidden = await hiddenUserIds(userId);
  const rows = await prisma.pageNote.groupBy({
    by: ["pageId"],
    where: { bookId: String(req.params["bookId"]), status: "VISIBLE", userId: { notIn: hidden } },
    _count: { _all: true }
  });
  res.json({ counts: Object.fromEntries(rows.map((r) => [r.pageId, r._count._all])) });
});

export default router;
