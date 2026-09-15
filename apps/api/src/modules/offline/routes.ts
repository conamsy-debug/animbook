/**
 * Offline download mode.
 *
 * Per Constraint #7, the reader must work offline after content is downloaded.
 * Web PWA uses the service worker cache; this module exposes:
 *
 *   - POST /api/library/:slug/download        — marks the entry downloaded.
 *   - GET  /api/library/:slug/manifest       — returns the full set of
 *                                              assets (video, audio, vtt,
 *                                              posters, JSON) the SW should
 *                                              pre-cache for offline use.
 *   - DELETE /api/library/:slug/download      — clears the offline mark.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";

const router = Router();
router.use(authMiddleware);

router.post("/:bookId/download", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const bookId = req.params["bookId"];
  if (typeof bookId !== "string") {
    res.status(400).json({ error: "Missing book id" });
    return;
  }
  const book = await prisma.book.findFirst({ where: { OR: [{ id: bookId }, { slug: bookId }] } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  await prisma.libraryEntry.upsert({
    where: { userId_bookId: { userId, bookId: book.id } },
    create: { userId, bookId: book.id, downloadedAt: new Date() },
    update: { downloadedAt: new Date() }
  });
  res.json({ ok: true, downloadedAt: new Date().toISOString() });
});

router.delete("/:bookId/download", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const bookId = req.params["bookId"];
  if (typeof bookId !== "string") {
    res.status(400).json({ error: "Missing book id" });
    return;
  }
  const book = await prisma.book.findFirst({ where: { OR: [{ id: bookId }, { slug: bookId }] }, select: { id: true } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  await prisma.libraryEntry.updateMany({
    where: { userId, bookId: book.id },
    data: { downloadedAt: null }
  });
  res.json({ ok: true });
});

router.get("/:bookId/manifest", async (req: Request, res: Response) => {
  const bookId = req.params["bookId"];
  if (typeof bookId !== "string") {
    res.status(400).json({ error: "Missing book id" });
    return;
  }
  const book = await prisma.book.findFirst({
    where: { OR: [{ id: bookId }, { slug: bookId }] },
    include: { pages: true }
  });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const assets: { url: string; kind: string; pageNum: number }[] = [];
  for (const page of book.pages) {
    if (page.videoUrl) assets.push({ url: page.videoUrl, kind: "video", pageNum: page.pageNum });
    if (page.audioUrl) assets.push({ url: page.audioUrl, kind: "audio", pageNum: page.pageNum });
    if (page.vttUrl) assets.push({ url: page.vttUrl, kind: "vtt", pageNum: page.pageNum });
    if (page.posterUrl) assets.push({ url: page.posterUrl, kind: "poster", pageNum: page.pageNum });
  }
  if (book.coverUrl) assets.push({ url: book.coverUrl, kind: "cover", pageNum: 0 });
  res.json({
    bookId: book.id,
    slug: book.slug,
    title: book.title,
    totalPages: book.pages.length,
    assets
  });
});

export default router;