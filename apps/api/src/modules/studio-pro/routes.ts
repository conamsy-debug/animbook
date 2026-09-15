/**
 * AnimBook STUDIO PRO — companion API.
 *
 *   POST /api/studio-pro/companion/:bookId     → mint or fetch the companion link
 *   GET  /api/studio-pro/companion/:bookId     → read the companion link
 *   POST /api/studio-pro/companion/:bookId/page → pin the link to a new anchor page
 *   GET  /api/studio-pro/scan/marker/:marker   → resolve a marker hash (public)
 *   GET  /api/studio-pro/scan/nfc/:tagId       → resolve an NFC tag id (public)
 *   POST /api/studio-pro/sessions              → log a companion session
 *   GET  /api/studio-pro/companion/:bookId/analytics → aggregate counts
 *
 * The /scan/* endpoints are mounted under `/api/studio-pro/scan/*` and act
 * as the public resolver for browsers that decode the QR or scan the NFC tag.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import {
  COMPANION_MODES,
  ensureCompanionLink,
  findCompanionLinkByMarker,
  findCompanionLinkByNfc,
  listCompanionSessions,
  logCompanionSession,
  summariseCompanion
} from "../../services/studioPro.js";

const router = Router();
router.use(authMiddleware);

router.get("/ambient", (_req: Request, res: Response) => {
  res.json({ modes: COMPANION_MODES });
});

async function resolveBook(bookId: string) {
  return prisma.book.findFirst({
    where: { OR: [{ id: bookId }, { slug: bookId }] },
    select: { id: true, slug: true, title: true, author: true, vertical: true, coverUrl: true, status: true }
  });
}

router.post("/companion/:bookId", async (req: AuthedRequest, res: Response) => {
  const bookId = req.params["bookId"];
  if (typeof bookId !== "string") {
    res.status(400).json({ error: "Missing bookId" });
    return;
  }
  const book = await resolveBook(bookId);
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const body = (req.body ?? {}) as { experienceMode?: string; anchorPage?: number; title?: string; companionLabel?: string };
  const mode = (COMPANION_MODES as readonly string[]).includes(body.experienceMode ?? "")
    ? (body.experienceMode as (typeof COMPANION_MODES)[number])
    : "AR_OVERLAY";
  const anchorPage = Math.max(1, Math.min(9999, Number.parseInt(String(body.anchorPage ?? 1), 10) || 1));
  const link = await ensureCompanionLink(book.id, {
    experienceMode: mode,
    anchorPage,
    title: body.title ?? book.title,
    companionLabel: body.companionLabel ?? `Point your camera at any AnimBook cover.`
  });
  res.status(link.createdAt.getTime() === link.updatedAt.getTime() ? 201 : 200).json({ link, book });
});

router.get("/companion/:bookId", async (req: AuthedRequest, res: Response) => {
  const bookId = req.params["bookId"];
  if (typeof bookId !== "string") {
    res.status(400).json({ error: "Missing bookId" });
    return;
  }
  const book = await resolveBook(bookId);
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const link = await prisma.companionLink.findFirst({ where: { bookId: book.id } });
  if (!link) {
    res.json({ book, link: null, recommendation: "Create a companion link with POST /api/studio-pro/companion/:bookId" });
    return;
  }
  res.json({ book, link });
});

const pageSchema = z.object({ anchorPage: z.number().int().min(1).max(9999) });

router.post("/companion/:bookId/page", async (req: AuthedRequest, res: Response) => {
  const bookId = req.params["bookId"];
  if (typeof bookId !== "string") {
    res.status(400).json({ error: "Missing bookId" });
    return;
  }
  const parsed = pageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const book = await resolveBook(bookId);
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const link = await prisma.companionLink.findFirst({ where: { bookId: book.id } });
  if (!link) {
    res.status(404).json({ error: "Companion link not yet minted. POST /api/studio-pro/companion/:bookId first." });
    return;
  }
  const updated = await prisma.companionLink.update({
    where: { id: link.id },
    data: { anchorPage: parsed.data.anchorPage }
  });
  res.json({ link: updated });
});

router.get("/companion/:bookId/analytics", async (req: AuthedRequest, res: Response) => {
  const bookId = req.params["bookId"];
  if (typeof bookId !== "string") {
    res.status(400).json({ error: "Missing bookId" });
    return;
  }
  const book = await resolveBook(bookId);
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const link = await prisma.companionLink.findFirst({ where: { bookId: book.id } });
  if (!link) {
    res.json({ book, link: null, summary: null, sessions: [] });
    return;
  }
  const [summary, sessions] = await Promise.all([summariseCompanion(link.id), listCompanionSessions(link.id, 20)]);
  res.json({ book, link, summary, sessions });
});

const sessionSchema = z.object({
  triggerMode: z.enum(["AR_OVERLAY", "NFC_ANCHOR", "AR_AND_NFC", "MANUAL"]),
  pageReached: z.number().int().min(1).max(9999).default(1)
});

router.post("/sessions", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const linkId = typeof req.body?.linkId === "string" ? req.body.linkId : null;
  if (!linkId) {
    res.status(400).json({ error: "Missing linkId" });
    return;
  }
  const link = await prisma.companionLink.findUnique({ where: { id: linkId } });
  if (!link) {
    res.status(404).json({ error: "Companion link not found" });
    return;
  }
  const session = await logCompanionSession(link.id, userId, parsed.data.triggerMode, parsed.data.pageReached);
  res.status(201).json({ session, link });
});

export const studioProPublicRouter = Router();

studioProPublicRouter.get("/scan/marker/:marker", async (req: Request, res: Response) => {
  const marker = req.params["marker"];
  if (typeof marker !== "string") {
    res.status(400).json({ error: "Missing marker" });
    return;
  }
  const link = await findCompanionLinkByMarker(marker);
  if (!link) {
    res.status(404).json({ error: "No companion link for this marker" });
    return;
  }
  const book = await prisma.book.findUnique({ where: { id: link.bookId }, select: { id: true, slug: true, title: true, coverUrl: true, vertical: true } });
  res.json({ link, book });
});

studioProPublicRouter.get("/scan/nfc/:tagId", async (req: Request, res: Response) => {
  const tagId = req.params["tagId"];
  if (typeof tagId !== "string") {
    res.status(400).json({ error: "Missing tag id" });
    return;
  }
  const link = await findCompanionLinkByNfc(tagId);
  if (!link) {
    res.status(404).json({ error: "No companion link for this NFC tag" });
    return;
  }
  const book = await prisma.book.findUnique({ where: { id: link.bookId }, select: { id: true, slug: true, title: true, coverUrl: true, vertical: true } });
  res.json({ link, book });
});

export default router;
