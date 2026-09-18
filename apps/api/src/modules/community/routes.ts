/**
 * Community: public profiles, following, reporting and blocking.
 *
 * GET    /api/community/authors/:handle      — public author page
 * GET    /api/community/me                   — my public profile + settings
 * PUT    /api/community/me                   — set handle, bio, message setting
 * POST   /api/community/authors/:id/follow   — follow / unfollow (toggle)
 * GET    /api/community/following            — authors I follow + their newest books
 * POST   /api/community/reports              — report a note, post, message or account
 * POST   /api/community/blocks               — block / unblock an account (toggle)
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import { screenText } from "../../services/moderation.js";

const router = Router();

const HANDLE = /^[a-z0-9][a-z0-9_-]{2,23}$/;
const RESERVED = new Set(["admin", "animbook", "support", "help", "about", "studio", "library", "api", "www", "staff", "moderator"]);

const publicBook = {
  id: true,
  slug: true,
  title: true,
  subtitle: true,
  coverUrl: true,
  vertical: true,
  subcategory: true,
  synopsis: true,
  totalPages: true,
  createdAt: true
} as const;

/** Public author page — no email, no private fields. */
router.get("/authors/:handle", async (req: Request, res: Response) => {
  const handle = String(req.params["handle"] ?? "").toLowerCase();
  const author = await prisma.user.findUnique({
    where: { handle },
    select: {
      id: true,
      name: true,
      handle: true,
      bio: true,
      messagesOpen: true,
      createdAt: true,
      booksCreated: { where: { status: "PUBLISHED" }, orderBy: { createdAt: "desc" }, select: publicBook },
      _count: { select: { followers: true } }
    }
  });
  if (!author?.handle) {
    res.status(404).json({ error: "Author not found" });
    return;
  }
  res.set("Cache-Control", "public, max-age=60");
  res.json({
    author: {
      id: author.id,
      name: author.name,
      handle: author.handle,
      bio: author.bio,
      memberSince: author.createdAt,
      acceptsMessages: author.messagesOpen,
      followers: author._count.followers,
      books: author.booksCreated
    }
  });
});

router.use(authMiddleware);

router.get("/me", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      handle: true,
      bio: true,
      messagesOpen: true,
      communityDisabled: true,
      _count: { select: { followers: true, following: true, booksCreated: true } }
    }
  });
  res.json({ me });
});

const profileSchema = z.object({
  handle: z.string().trim().toLowerCase().optional(),
  bio: z.string().trim().max(400).optional(),
  messagesOpen: z.boolean().optional()
});

router.put("/me", rateLimit({ name: "community.profile", max: 20, windowSeconds: 300 }), async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid profile", details: parsed.error.flatten() });
    return;
  }
  const { handle, bio, messagesOpen } = parsed.data;
  if (handle !== undefined) {
    if (!HANDLE.test(handle) || RESERVED.has(handle)) {
      res.status(400).json({ error: "Handles are 3–24 characters: letters, numbers, - and _" });
      return;
    }
    const taken = await prisma.user.findFirst({ where: { handle, NOT: { id: userId } }, select: { id: true } });
    if (taken) {
      res.status(409).json({ error: "That handle is taken" });
      return;
    }
  }
  if (bio) {
    const screening = await screenText(bio, "author bio");
    if (screening.verdict === "block") {
      res.status(422).json({ error: "That bio can't be published" });
      return;
    }
  }
  const me = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(handle !== undefined ? { handle } : {}),
      ...(bio !== undefined ? { bio: bio || null } : {}),
      ...(messagesOpen !== undefined ? { messagesOpen } : {})
    },
    select: { id: true, name: true, handle: true, bio: true, messagesOpen: true }
  });
  res.json({ me });
});

/** Follow or unfollow an author. */
router.post("/authors/:id/follow", rateLimit({ name: "community.follow", max: 120, windowSeconds: 3600 }), async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const authorId = String(req.params["id"]);
  if (authorId === userId) {
    res.status(400).json({ error: "You can't follow yourself" });
    return;
  }
  const author = await prisma.user.findUnique({ where: { id: authorId }, select: { id: true } });
  if (!author) {
    res.status(404).json({ error: "Author not found" });
    return;
  }
  const existing = await prisma.follow.findUnique({ where: { followerId_authorId: { followerId: userId, authorId } } });
  if (existing) {
    await prisma.follow.delete({ where: { id: existing.id } });
    res.json({ following: false });
    return;
  }
  await prisma.follow.create({ data: { followerId: userId, authorId } });
  res.json({ following: true });
});

/** Authors I follow, with anything they've published recently. */
router.get("/following", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const follows = await prisma.follow.findMany({
    where: { followerId: userId },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      author: {
        select: {
          id: true,
          name: true,
          handle: true,
          bio: true,
          booksCreated: { where: { status: "PUBLISHED" }, orderBy: { createdAt: "desc" }, take: 3, select: publicBook }
        }
      }
    }
  });
  res.json({ items: follows.filter((f) => f.author.handle) });
});

const reportSchema = z.object({
  targetType: z.enum(["NOTE", "CIRCLE_POST", "MESSAGE", "USER", "BOOK"]),
  targetId: z.string().min(1),
  reason: z.enum(["spam", "harassment", "hate", "sexual", "child-safety", "violence", "other"]),
  detail: z.string().trim().max(500).optional()
});

router.post("/reports", rateLimit({ name: "community.report", max: 30, windowSeconds: 3600 }), async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid report", details: parsed.error.flatten() });
    return;
  }
  const report = await prisma.report.create({
    data: { ...parsed.data, detail: parsed.data.detail ?? null, reporterId: userId },
    select: { id: true, createdAt: true }
  });
  console.warn(`[community] report ${report.id}: ${parsed.data.targetType} ${parsed.data.targetId} (${parsed.data.reason})`);
  res.status(201).json({ ok: true, report });
});

/** Block or unblock an account. */
router.post("/blocks", rateLimit({ name: "community.block", max: 60, windowSeconds: 3600 }), async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const schema = z.object({ userId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || parsed.data.userId === userId) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const blockedId = parsed.data.userId;
  const existing = await prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId: userId, blockedId } } });
  if (existing) {
    await prisma.block.delete({ where: { id: existing.id } });
    res.json({ blocked: false });
    return;
  }
  await prisma.block.create({ data: { blockerId: userId, blockedId } });
  res.json({ blocked: true });
});

export default router;
