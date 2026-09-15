import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { VERTICALS, CONSUMER_WORLDS } from "@animbook/domain";
import { appEnv, isFeatureEnabled } from "../../config/env.js";
import { prisma } from "../../db.js";
import { withCache } from "../../cache/index.js";

const router = Router();

const querySchema = z.object({
  vertical: z.string().optional(),
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
  const { vertical, world, status, language, q, limit, offset } = parsed.data;

  const where: Parameters<typeof prisma.book.findMany>[0] = { where: {} };
  const bookWhere = where.where as Record<string, unknown>;
  if (vertical) bookWhere.vertical = vertical;
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
      brain: true
    }
  });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  res.json(book);
});

router.get("/:id/pages", async (req: Request, res: Response) => {
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
  const pages = await prisma.page.findMany({
    where: { bookId: book.id },
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
      speakerName: true
    }
  });
  res.json({ bookId: book.id, pages, integration: { runway: isFeatureEnabled("RUNWAY"), elevenlabs: isFeatureEnabled("ELEVENLABS") } });
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
      speakerName: true
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