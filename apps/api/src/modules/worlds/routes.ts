/**
 * AnimBook WORLDS — persistent animated universes.
 *
 * A World is a multi-book franchise that shares characters, settings, and
 * visual style. Cross-book membership is recorded in `WorldMember`. The
 * shared-character list is the prompt seed for the next phase of work
 * (the actual cross-book LoRA is a future infra pass).
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { withCache } from "../../cache/index.js";

const router = Router();
router.use(authMiddleware);

router.get(
  "/",
  withCache({ ttlSeconds: 120 }),
  async (_req: Request, res: Response) => {
    const worlds = await prisma.world.findMany({
      include: {
        _count: { select: { members: true } }
      },
      orderBy: { updatedAt: "desc" }
    });
    res.json({
      items: worlds.map((world) => ({
        ...world,
        bookCount: world._count.members
      }))
    });
  }
);

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, "slug must be kebab-case"),
  synopsis: z.string().min(1).max(2000),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  styleId: z.string().optional()
});

router.post("/", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.roles.includes("platform_admin")) {
    res.status(403).json({ error: "Only platform admins can create worlds" });
    return;
  }
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid world", details: parsed.error.flatten() });
    return;
  }
  const world = await prisma.world.create({
    data: {
      name: parsed.data.name,
      slug: parsed.data.slug,
      synopsis: parsed.data.synopsis,
      accentColor: parsed.data.accentColor ?? "#C49A1C",
      styleId: parsed.data.styleId ?? null
    }
  });
  res.status(201).json(world);
});

router.get("/:slug", async (req: Request, res: Response) => {
  const slug = req.params["slug"];
  if (typeof slug !== "string") {
    res.status(400).json({ error: "Missing world slug" });
    return;
  }
  const world = await prisma.world.findUnique({
    where: { slug },
    include: {
      members: {
        orderBy: { ordinal: "asc" },
        include: {
          book: {
            select: {
              id: true,
              slug: true,
              title: true,
              author: true,
              vertical: true,
              language: true,
              totalPages: true,
              coverUrl: true,
              synopsis: true
            }
          }
        }
      }
    }
  });
  if (!world) {
    res.status(404).json({ error: "World not found" });
    return;
  }
  res.json({ world });
});

const attachSchema = z.object({
  bookId: z.string().min(1),
  ordinal: z.number().int().min(0).default(0),
  sharedCharacters: z.array(z.string()).default([])
});

router.post("/:slug/books", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.roles.includes("platform_admin")) {
    res.status(403).json({ error: "Only platform admins can attach books" });
    return;
  }
  const slug = req.params["slug"];
  if (typeof slug !== "string") {
    res.status(400).json({ error: "Missing world slug" });
    return;
  }
  const parsed = attachSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid attach payload", details: parsed.error.flatten() });
    return;
  }
  const world = await prisma.world.findUnique({ where: { slug } });
  if (!world) {
    res.status(404).json({ error: "World not found" });
    return;
  }
  const book = await prisma.book.findFirst({ where: { OR: [{ id: parsed.data.bookId }, { slug: parsed.data.bookId }] } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const member = await prisma.worldMember.upsert({
    where: { bookId: book.id },
    create: {
      worldId: world.id,
      bookId: book.id,
      ordinal: parsed.data.ordinal,
      sharedCharacters: parsed.data.sharedCharacters
    },
    update: {
      ordinal: parsed.data.ordinal,
      sharedCharacters: parsed.data.sharedCharacters
    }
  });
  res.json({ member });
});

export default router;