/**
 * Publisher Portal.
 *
 *   - GET    /api/publishers                 — list all publishers (catalog view).
 *   - POST   /api/publishers                 — create a publisher (admin only).
 *   - GET    /api/publishers/:id/dashboard   — licensing dashboard for one publisher:
 *                                                books under contract, recent royalties,
 *                                                revenue share %.
 *   - POST   /api/publishers/:id/books       — attach a book to a publisher.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";

const router = Router();
router.use(authMiddleware);

router.get("/", async (_req: Request, res: Response) => {
  const items = await prisma.publisher.findMany({
    select: {
      id: true,
      name: true,
      contactEmail: true,
      revenueSharePct: true,
      createdAt: true,
      _count: { select: { books: true } }
    },
    orderBy: { name: "asc" }
  });
  res.json({ items });
});

const createSchema = z.object({
  name: z.string().min(1),
  contactEmail: z.string().email(),
  licenseAgreementUrl: z.string().url().optional(),
  revenueSharePct: z.number().min(0).max(100).default(70)
});

router.post("/", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.roles.includes("publisher_admin") && !user?.roles.includes("platform_admin")) {
    res.status(403).json({ error: "Publisher admins only" });
    return;
  }
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid publisher", details: parsed.error.flatten() });
    return;
  }
  const publisher = await prisma.publisher.create({
    data: {
      name: parsed.data.name,
      contactEmail: parsed.data.contactEmail,
      licenseAgreementUrl: parsed.data.licenseAgreementUrl ?? null,
      revenueSharePct: parsed.data.revenueSharePct
    }
  });
  res.status(201).json(publisher);
});

router.get("/:id/dashboard", async (req: Request, res: Response) => {
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing publisher id" });
    return;
  }
  const publisher = await prisma.publisher.findUnique({
    where: { id },
    include: {
      books: {
        select: {
          id: true,
          slug: true,
          title: true,
          author: true,
          vertical: true,
          status: true,
          totalPages: true,
          language: true
        }
      }
    }
  });
  if (!publisher) {
    res.status(404).json({ error: "Publisher not found" });
    return;
  }
  const royalties = await prisma.royaltyEntry.findMany({
    where: { book: { publisherId: publisher.id } },
    include: { book: { select: { title: true } } },
    orderBy: { periodEnd: "desc" },
    take: 50
  });
  const totalRevenueCents = royalties.reduce((sum, entry) => sum + entry.amountCents, 0);
  const payoutCents = Math.round((totalRevenueCents * publisher.revenueSharePct) / 100);
  res.json({
    publisher,
    bookCount: publisher.books.length,
    royalties,
    totalRevenueCents,
    payoutCents,
    payoutUsd: (payoutCents / 100).toFixed(2)
  });
});

const attachSchema = z.object({ bookId: z.string().min(1) });

router.post("/:id/books", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.roles.includes("publisher_admin") && !user?.roles.includes("platform_admin")) {
    res.status(403).json({ error: "Publisher admins only" });
    return;
  }
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing publisher id" });
    return;
  }
  const parsed = attachSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const publisher = await prisma.publisher.findUnique({ where: { id } });
  if (!publisher) {
    res.status(404).json({ error: "Publisher not found" });
    return;
  }
  const book = await prisma.book.findFirst({ where: { OR: [{ id: parsed.data.bookId }, { slug: parsed.data.bookId }] } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  await prisma.book.update({ where: { id: book.id }, data: { publisherId: publisher.id } });
  res.json({ ok: true });
});

export default router;