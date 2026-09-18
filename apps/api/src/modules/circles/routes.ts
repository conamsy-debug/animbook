/**
 * Reading circles: a small private group reading a book together.
 *
 * GET    /api/circles                 — circles I'm in
 * POST   /api/circles                 — start one (optionally about a book)
 * GET    /api/circles/invite/:code    — what an invite leads to
 * POST   /api/circles/join            — join with an invite code
 * GET    /api/circles/:id             — members and conversation (members only)
 * POST   /api/circles/:id/posts       — say something (screened)
 * DELETE /api/circles/posts/:id       — remove your own post, or any as owner
 * POST   /api/circles/:id/leave       — leave (the owner hands over or closes it)
 * DELETE /api/circles/:id             — close the circle (owner)
 */
import { randomBytes } from "node:crypto";
import type { Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import { screenText, statusFor } from "../../services/moderation.js";

const router = Router();
router.use(authMiddleware);

const MAX_MEMBERS = 50;
const MAX_CIRCLES = 20;
const person = { id: true, name: true, handle: true, avatarUrl: true } as const;
const bookBrief = { id: true, slug: true, title: true, coverUrl: true } as const;

const newCode = () => randomBytes(9).toString("base64url");

async function membership(circleId: string, userId: string) {
  return prisma.circleMember.findUnique({ where: { circleId_userId: { circleId, userId } }, select: { role: true } });
}

async function assertCanWrite(userId: string, res: Response): Promise<boolean> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { communityDisabled: true } });
  if (me?.communityDisabled) {
    res.status(403).json({ error: "Reading circles are switched off for this account" });
    return false;
  }
  return true;
}

router.get("/", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const memberships = await prisma.circleMember.findMany({
    where: { userId },
    orderBy: { joinedAt: "desc" },
    select: {
      role: true,
      circle: {
        select: {
          id: true,
          name: true,
          createdAt: true,
          book: { select: bookBrief },
          owner: { select: person },
          _count: { select: { members: true, posts: true } }
        }
      }
    }
  });
  res.json({ items: memberships.map((m) => ({ ...m.circle, role: m.role })) });
});

router.post("/", rateLimit({ name: "circles.create", max: 10, windowSeconds: 3600 }), async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  if (!(await assertCanWrite(userId, res))) return;
  const parsed = z.object({ name: z.string().trim().min(2).max(60), bookId: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A circle needs a name of 2–60 characters" });
    return;
  }
  const mine = await prisma.circleMember.count({ where: { userId, role: "OWNER" } });
  if (mine >= MAX_CIRCLES) {
    res.status(429).json({ error: "You already run the maximum number of circles" });
    return;
  }
  const screening = await screenText(parsed.data.name, "the name of a reading circle");
  if (screening.verdict === "block") {
    res.status(422).json({ error: "Please choose another name for the circle" });
    return;
  }
  const circle = await prisma.circle.create({
    data: {
      name: parsed.data.name,
      bookId: parsed.data.bookId ?? null,
      ownerId: userId,
      inviteCode: newCode(),
      members: { create: { userId, role: "OWNER" } }
    },
    select: { id: true, name: true, inviteCode: true, book: { select: bookBrief } }
  });
  res.status(201).json({ circle });
});

router.get("/invite/:code", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const circle = await prisma.circle.findUnique({
    where: { inviteCode: String(req.params["code"]) },
    select: { id: true, name: true, book: { select: bookBrief }, owner: { select: person }, _count: { select: { members: true } } }
  });
  if (!circle) {
    res.status(404).json({ error: "That invite has expired or doesn't exist" });
    return;
  }
  const already = await membership(circle.id, userId);
  res.json({ circle: { ...circle, alreadyMember: Boolean(already) } });
});

router.post("/join", rateLimit({ name: "circles.join", max: 30, windowSeconds: 3600 }), async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  if (!(await assertCanWrite(userId, res))) return;
  const parsed = z.object({ code: z.string().trim().min(4).max(40) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid invite code" });
    return;
  }
  const circle = await prisma.circle.findUnique({
    where: { inviteCode: parsed.data.code },
    select: { id: true, ownerId: true, _count: { select: { members: true } } }
  });
  if (!circle) {
    res.status(404).json({ error: "That invite has expired or doesn't exist" });
    return;
  }
  // An account either side of a block can't join the other's circle.
  const blocked = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: userId, blockedId: circle.ownerId },
        { blockerId: circle.ownerId, blockedId: userId }
      ]
    },
    select: { id: true }
  });
  if (blocked) {
    res.status(403).json({ error: "You can't join this circle" });
    return;
  }
  if (circle._count.members >= MAX_MEMBERS) {
    res.status(409).json({ error: "This circle is full" });
    return;
  }
  await prisma.circleMember.upsert({
    where: { circleId_userId: { circleId: circle.id, userId } },
    create: { circleId: circle.id, userId },
    update: {}
  });
  res.json({ ok: true, circleId: circle.id });
});

router.get("/:id", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = String(req.params["id"]);
  const mine = await membership(id, userId);
  if (!mine) {
    res.status(403).json({ error: "This circle is private" });
    return;
  }
  const circle = await prisma.circle.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      inviteCode: true,
      createdAt: true,
      ownerId: true,
      book: { select: bookBrief },
      members: { orderBy: { joinedAt: "asc" }, select: { role: true, joinedAt: true, user: { select: person } } },
      posts: {
        where: { status: "VISIBLE" },
        orderBy: { createdAt: "asc" },
        take: 200,
        select: { id: true, text: true, pageNum: true, createdAt: true, user: { select: person } }
      }
    }
  });
  if (!circle) {
    res.status(404).json({ error: "Circle not found" });
    return;
  }
  const blocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true }
  });
  const hidden = new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));
  res.json({
    circle: {
      ...circle,
      role: mine.role,
      // The invite code is the owner's to share.
      inviteCode: mine.role === "OWNER" ? circle.inviteCode : null,
      posts: circle.posts.filter((p) => !hidden.has(p.user.id)).map((p) => ({ ...p, mine: p.user.id === userId }))
    }
  });
});

router.post("/:id/posts", rateLimit({ name: "circles.post", max: 60, windowSeconds: 600 }), async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  if (!(await assertCanWrite(userId, res))) return;
  const id = String(req.params["id"]);
  const mine = await membership(id, userId);
  if (!mine) {
    res.status(403).json({ error: "This circle is private" });
    return;
  }
  const parsed = z.object({ text: z.string().trim().min(1).max(1000), pageNum: z.number().int().positive().optional() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Posts are 1–1000 characters" });
    return;
  }
  const screening = await screenText(parsed.data.text, "a message in a private reading circle");
  if (screening.verdict === "block") {
    const selfHarm = /self.harm|suicide/i.test(`${screening.reason ?? ""} ${parsed.data.text}`);
    res.status(422).json({
      error: selfHarm
        ? "We couldn't post that. If you're going through something difficult, please talk to someone you trust or a local helpline."
        : "That message can't be posted here.",
      support: selfHarm
    });
    return;
  }
  const post = await prisma.circlePost.create({
    data: {
      circleId: id,
      userId,
      text: parsed.data.text,
      pageNum: parsed.data.pageNum ?? null,
      status: statusFor(screening)
    },
    select: { id: true, text: true, pageNum: true, createdAt: true, status: true, user: { select: person } }
  });
  res.status(201).json({ post: { ...post, mine: true }, held: post.status !== "VISIBLE" });
});

router.delete("/posts/:id", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const post = await prisma.circlePost.findUnique({
    where: { id: String(req.params["id"]) },
    select: { id: true, userId: true, circle: { select: { ownerId: true } } }
  });
  if (!post || (post.userId !== userId && post.circle.ownerId !== userId)) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  await prisma.circlePost.delete({ where: { id: post.id } });
  res.json({ ok: true });
});

router.post("/:id/leave", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = String(req.params["id"]);
  const circle = await prisma.circle.findUnique({ where: { id }, select: { ownerId: true } });
  if (!circle) {
    res.status(404).json({ error: "Circle not found" });
    return;
  }
  if (circle.ownerId === userId) {
    res.status(400).json({ error: "As the owner, close the circle instead" });
    return;
  }
  await prisma.circleMember.deleteMany({ where: { circleId: id, userId } });
  res.json({ ok: true });
});

router.delete("/:id", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = String(req.params["id"]);
  const circle = await prisma.circle.findUnique({ where: { id }, select: { ownerId: true } });
  if (!circle || circle.ownerId !== userId) {
    res.status(404).json({ error: "Circle not found" });
    return;
  }
  await prisma.circle.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
