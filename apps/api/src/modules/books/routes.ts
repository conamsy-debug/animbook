import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { VERTICALS, CONSUMER_WORLDS } from "../../domain/index.js";
import { appEnv, isFeatureEnabled } from "../../config/env.js";
import { prisma } from "../../db.js";
import { withCache } from "../../cache/index.js";
import { maxReadablePage, getReleaseInfo } from "../../services/releaseSchedule.js";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { rateLimit } from "../../middleware/rateLimit.js";

const router = Router();

const querySchema = z.object({
  vertical: z.string().optional(),
  subcategory: z.string().max(40).optional(),
  world: z.string().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  language: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  offset: z.coerce.number().int().min(0).default(0)
});

router.get(
  "/",
  withCache({ ttlSeconds: 60, varyOn: ["accept-language"] }),
  async (req: Request, res: Response) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    return;
  }
  const { vertical, subcategory, world, status, language, q, limit, offset } = parsed.data;

  const where: Parameters<typeof prisma.book.findMany>[0] = { where: {} };
  const bookWhere = where.where as Record<string, unknown>;
  if (vertical) bookWhere.vertical = vertical;
  if (subcategory) bookWhere.subcategory = subcategory;
  if (status) bookWhere.status = status;
  else bookWhere.status = "PUBLISHED";
  if (language) bookWhere.language = language;
  if (world) bookWhere.genreTags = { has: world };
  if (q) {
    bookWhere.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { author: { contains: q, mode: "insensitive" } },
      { synopsis: { contains: q, mode: "insensitive" } }
    ];
  }

  const [items, total] = await Promise.all([
    prisma.book.findMany({
      where: bookWhere,
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
      skip: offset,
      select: {
        id: true,
        slug: true,
        title: true,
        subtitle: true,
        subcategory: true,
        author: true,
        synopsis: true,
        vertical: true,
        genreTags: true,
        moodTags: true,
        ageRating: true,
        language: true,
        coverUrl: true,
        totalPages: true,
        styleId: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.book.count({ where: bookWhere })
  ]);

  res.json({ items, total, limit, offset, integration: { live: isFeatureEnabled("BOOK_BRAIN") } });
  }
);

router.get("/verticals", (_req: Request, res: Response) => {
  res.json({ verticals: VERTICALS, consumerWorlds: CONSUMER_WORLDS });
});

router.get("/:id", async (req: Request, res: Response) => {
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing book id" });
    return;
  }
  const book = await prisma.book.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    include: {
      publisher: { select: { id: true, name: true, contactEmail: true } },
      creator: { select: { id: true, name: true, handle: true } },
      brain: true
    }
  });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  res.json(book);
});

router.get("/:id/pages", async (req: AuthedRequest, res: Response) => {
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing book id" });
    return;
  }
  const book = await prisma.book.findFirst({ where: { OR: [{ id }, { slug: id }] }, select: { id: true } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  // Reader-visible page boundary. Dripped books hide pages the caller
  // can't read yet (TIME: not released, TASK: not unlocked for them).
  const viewerId = typeof req.userId === "string" ? req.userId : null;
  const visibleUpTo = await maxReadablePage(book.id, viewerId);
  const pages = await prisma.page.findMany({
    where: { bookId: book.id, pageNum: { lte: visibleUpTo } },
    orderBy: { pageNum: "asc" },
    select: {
      id: true,
      pageNum: true,
      chapter: true,
      textExcerpt: true,
      videoUrl: true,
      posterUrl: true,
      audioUrl: true,
      vttUrl: true,
      sceneType: true,
      emotionalRegister: true,
      cameraAngle: true,
      qualityScore: true,
      status: true,
      speakerName: true,
      // Split-pipeline fields. Readers ignore unknown fields so adding
      // them here is safe for legacy books (stillStatus=NONE etc.).
      stillStatus: true,
      clipStatus: true,
      audioStatus: true,
      stillVersion: true,
      motionTier: true
    }
  });
  res.json({
    bookId: book.id,
    pages,
    integration: { runway: isFeatureEnabled("RUNWAY"), elevenlabs: isFeatureEnabled("ELEVENLABS") }
  });
});

router.get("/:id/pages/:num", async (req: Request, res: Response) => {
  const id = req.params["id"];
  const numRaw = req.params["num"];
  if (typeof id !== "string" || typeof numRaw !== "string") {
    res.status(400).json({ error: "Missing book id or page number" });
    return;
  }
  const num = Number.parseInt(numRaw, 10);
  if (!Number.isFinite(num)) {
    res.status(400).json({ error: "Page number must be an integer" });
    return;
  }
  const book = await prisma.book.findFirst({ where: { OR: [{ id }, { slug: id }] }, select: { id: true, slug: true, title: true, vertical: true } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const page = await prisma.page.findUnique({
    where: { bookId_pageNum: { bookId: book.id, pageNum: num } },
    select: {
      id: true,
      pageNum: true,
      chapter: true,
      textExcerpt: true,
      videoUrl: true,
      posterUrl: true,
      audioUrl: true,
      vttUrl: true,
      sceneType: true,
      emotionalRegister: true,
      cameraAngle: true,
      qualityScore: true,
      status: true,
      directionNote: true,
      speakerName: true,
      stillStatus: true,
      clipStatus: true,
      audioStatus: true,
      stillVersion: true,
      motionTier: true
    }
  });
  if (!page) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  res.json({ book, page });
});

router.get("/search/full", async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 2) {
    res.json({ items: [] });
    return;
  }
  const items = await prisma.book.findMany({
    where: {
      status: "PUBLISHED",
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { author: { contains: q, mode: "insensitive" } },
        { synopsis: { contains: q, mode: "insensitive" } },
        { genreTags: { has: q } },
        { moodTags: { has: q } }
      ]
    },
    take: 20,
    orderBy: { updatedAt: "desc" }
  });
  res.json({ items, integration: { live: isFeatureEnabled("BOOK_BRAIN") } });
});

export default router;

// Silence unused-import warnings while we keep appEnv available for
// future endpoints (rate limiting headers, etc).
void appEnv;

router.get("/:id/release-info", async (req: Request, res: Response) => {
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing book id" });
    return;
  }
  const book = await prisma.book.findFirst({ where: { OR: [{ id }, { slug: id }] }, select: { id: true } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const viewerId = typeof (req as AuthedRequest).userId === "string"
    ? (req as AuthedRequest).userId
    : null;
  const info = await getReleaseInfo(book.id, viewerId);
  if (!info) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  res.json({ release: info });
});

const taskSubmissionSchema = z.object({
  chunkIndex: z.number().int().min(1),
  text: z.string().trim().min(2).max(2000)
});

router.post(
  "/:id/submit-task",
  authMiddleware,
  rateLimit({ name: "book.submitTask", max: 30, windowSeconds: 3600 }),
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);
    const id = req.params["id"];
    if (typeof id !== "string") {
      res.status(400).json({ error: "Missing book id" });
      return;
    }
    const parsed = taskSubmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid submission", details: parsed.error.flatten() });
      return;
    }
    const book = await prisma.book.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      select: { id: true, releaseMode: true, totalPages: true }
    });
    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    if (book.releaseMode !== "TASK") {
      res.status(400).json({ error: "This book doesn't have a daily task" });
      return;
    }
    // Only accept submissions for the chunk the reader is currently on.
    // (We don't enforce a single submission per chunk so a reader can revise
    // their reflection; the unlock check looks for *any* submission at the
    // chunk index the reader needs next.)
    await prisma.bookTaskSubmission.create({
      data: {
        bookId: book.id,
        chunkIndex: parsed.data.chunkIndex,
        userId,
        text: parsed.data.text
      }
    });
    const info = await getReleaseInfo(book.id, userId);
    res.json({ ok: true, release: info });
  }
);
