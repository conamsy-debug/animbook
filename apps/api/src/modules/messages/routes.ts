/**
 * Reader-to-author messages: a private line from a reader to an author about
 * their books, and nothing else.
 *
 * GET    /api/messages                      — my threads (both sides)
 * GET    /api/messages/unread               — unread count, for the top bar
 * POST   /api/messages/authors/:authorId    — a reader opens or continues a thread
 * GET    /api/messages/:threadId            — the messages in one thread
 * POST   /api/messages/:threadId            — reply in a thread you're part of
 * POST   /api/messages/:threadId/close      — the author ends the thread
 *
 * The shape of the feature is the safety of it:
 *   - a thread is always exactly one reader and one author; there is no
 *     reader-to-reader thread and no group
 *   - only the reader side can open one, and only with someone who has
 *     published a book and left their inbox open
 *   - neither party may be a protected account (school, minor, switched off),
 *     checked on every send AND every read, so an account marked after a
 *     thread was opened loses it immediately
 *   - every message is screened like notes and circle posts
 *   - blocks apply both ways, and either party can report
 */
import type { Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import { screenText, statusFor } from "../../services/moderation.js";
import { bothStandings, isBlockedPair, standingFor } from "../../services/accountStanding.js";

const router = Router();
router.use(authMiddleware);

const MAX = 1000;
const person = { id: true, name: true, handle: true, avatarUrl: true } as const;
const bookBrief = { id: true, slug: true, title: true, coverUrl: true } as const;

/** Sent to whichever side is asking; never leaks why the other side is unavailable. */
const CLOSED_TO_YOU = "Messaging isn't available on this account.";
const CLOSED_TO_THEM = "This author isn't taking messages.";

type Party = "reader" | "author";

function sideOf(thread: { readerId: string; authorId: string }, userId: string): Party | null {
  if (thread.readerId === userId) return "reader";
  if (thread.authorId === userId) return "author";
  return null;
}

/**
 * Everything that must be true for a message to move between these two, on
 * every single send and every single thread open. Returns an error string, or
 * null when the pair is clear.
 */
async function blockReason(readerId: string, authorId: string, opts: { readerWriting: boolean }): Promise<string | null> {
  if (readerId === authorId) return "You can't message yourself.";
  const [readerStanding, authorStanding] = await bothStandings(readerId, authorId);
  // A protected account on EITHER end closes the thread. The reader gets the
  // same wording whichever side is protected, so nobody can probe for who is
  // a school or child account.
  if (readerStanding.protected || authorStanding.protected) {
    return readerStanding.protected ? CLOSED_TO_YOU : CLOSED_TO_THEM;
  }
  if (await isBlockedPair(readerId, authorId)) return CLOSED_TO_THEM;

  const author = await prisma.user.findUnique({
    where: { id: authorId },
    select: { messagesOpen: true, _count: { select: { booksCreated: true } } }
  });
  if (!author) return "No such author.";
  // "Reader to author" means the other end is genuinely an author. Without
  // this the feature quietly becomes open direct messaging between any two
  // accounts, which is not what was agreed.
  if (author._count.booksCreated === 0) return CLOSED_TO_THEM;
  // The author's switch governs what the reader sends. An author answering in
  // their own thread isn't blocked by their own setting.
  if (opts.readerWriting && !author.messagesOpen) return CLOSED_TO_THEM;
  return null;
}

/** My threads, newest activity first. */
router.get("/", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const me = await standingFor(userId);
  if (me.protected) {
    res.json({ threads: [], messagingAvailable: false });
    return;
  }
  const threads = await prisma.messageThread.findMany({
    where: { OR: [{ readerId: userId }, { authorId: userId }] },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      lastMessageAt: true,
      readerId: true,
      authorId: true,
      readerReadAt: true,
      authorReadAt: true,
      reader: { select: person },
      author: { select: person },
      book: { select: bookBrief },
      messages: {
        where: { status: "VISIBLE" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { text: true, senderId: true, createdAt: true }
      }
    }
  });
  res.json({
    messagingAvailable: true,
    threads: threads.map((t) => {
      const side = sideOf(t, userId) as Party;
      const seenAt = side === "reader" ? t.readerReadAt : t.authorReadAt;
      const last = t.messages[0];
      return {
        id: t.id,
        role: side,
        status: t.status,
        other: side === "reader" ? t.author : t.reader,
        book: t.book,
        lastMessageAt: t.lastMessageAt,
        preview: last?.text.slice(0, 120) ?? null,
        unread: Boolean(last && last.senderId !== userId && (!seenAt || last.createdAt > seenAt))
      };
    })
  });
});

/** A small number for the top bar. */
router.get("/unread", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const me = await standingFor(userId);
  if (me.protected) {
    res.json({ unread: 0 });
    return;
  }
  const threads = await prisma.messageThread.findMany({
    where: { OR: [{ readerId: userId }, { authorId: userId }] },
    select: {
      readerId: true,
      authorId: true,
      readerReadAt: true,
      authorReadAt: true,
      messages: { where: { status: "VISIBLE" }, orderBy: { createdAt: "desc" }, take: 1, select: { senderId: true, createdAt: true } }
    }
  });
  const unread = threads.filter((t) => {
    const last = t.messages[0];
    if (!last || last.senderId === userId) return false;
    const seenAt = t.readerId === userId ? t.readerReadAt : t.authorReadAt;
    return !seenAt || last.createdAt > seenAt;
  }).length;
  res.json({ unread });
});

const openSchema = z.object({
  text: z.string().trim().min(2).max(MAX),
  bookId: z.string().trim().optional()
});

/** A reader opens a thread with an author, or adds to the one they already have. */
router.post(
  "/authors/:authorId",
  rateLimit({ name: "messages.open", max: 10, windowSeconds: 86400 }),
  rateLimit({ name: "messages.send", max: 30, windowSeconds: 3600 }),
  async (req: AuthedRequest, res: Response) => {
    const readerId = requireUserId(req);
    const authorId = String(req.params["authorId"]);
    const parsed = openSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: `Messages are 2–${MAX} characters` });
      return;
    }

    const refusal = await blockReason(readerId, authorId, { readerWriting: true });
    if (refusal) {
      res.status(403).json({ error: refusal });
      return;
    }

    const author = await prisma.user.findUnique({ where: { id: authorId }, select: { name: true } });
    const screening = await screenText(parsed.data.text, `a private message to the author ${author?.name ?? ""}`);
    if (screening.verdict === "block") {
      const selfHarm = /self.harm|suicide|hurt (your|them)self/i.test(`${screening.reason ?? ""} ${parsed.data.text}`);
      res.status(422).json({
        error: selfHarm
          ? "We couldn't send that. If you're going through something difficult, talking to someone you trust — or a local helpline — can help."
          : "That message can't be sent.",
        support: selfHarm
      });
      return;
    }

    const existing = await prisma.messageThread.findUnique({
      where: { readerId_authorId: { readerId, authorId } },
      select: { id: true, status: true }
    });
    if (existing?.status === "CLOSED") {
      res.status(403).json({ error: "This author has ended the conversation." });
      return;
    }

    const thread =
      existing ??
      (await prisma.messageThread.create({
        data: { readerId, authorId, bookId: parsed.data.bookId ?? null },
        select: { id: true, status: true }
      }));

    const message = await prisma.message.create({
      data: { threadId: thread.id, senderId: readerId, text: parsed.data.text, status: statusFor(screening) },
      select: { id: true, text: true, status: true, createdAt: true }
    });
    await prisma.messageThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: message.createdAt, readerReadAt: message.createdAt }
    });

    res.status(201).json({
      threadId: thread.id,
      message: { id: message.id, text: message.text, createdAt: message.createdAt, mine: true, pending: message.status === "HELD" },
      held: message.status === "HELD"
    });
  }
);

/** The messages in one thread. */
router.get("/:threadId", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const thread = await prisma.messageThread.findUnique({
    where: { id: String(req.params["threadId"]) },
    select: {
      id: true,
      status: true,
      readerId: true,
      authorId: true,
      reader: { select: person },
      author: { select: person },
      book: { select: bookBrief }
    }
  });
  const side = thread ? sideOf(thread, userId) : null;
  if (!thread || !side) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  // Re-checked on read, not just on send: if either account has been marked
  // since this thread was opened, the history goes away with it.
  const refusal = await blockReason(thread.readerId, thread.authorId, { readerWriting: false });
  if (refusal) {
    res.status(403).json({ error: refusal });
    return;
  }

  const messages = await prisma.message.findMany({
    where: { threadId: thread.id, OR: [{ status: "VISIBLE" }, { senderId: userId }] },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: { id: true, text: true, status: true, senderId: true, createdAt: true }
  });
  await prisma.messageThread.update({
    where: { id: thread.id },
    data: side === "reader" ? { readerReadAt: new Date() } : { authorReadAt: new Date() }
  });

  res.json({
    thread: {
      id: thread.id,
      role: side,
      status: thread.status,
      other: side === "reader" ? thread.author : thread.reader,
      book: thread.book
    },
    messages: messages
      .filter((m) => m.status !== "REMOVED" || m.senderId === userId)
      .map((m) => ({
        id: m.id,
        text: m.text,
        createdAt: m.createdAt,
        mine: m.senderId === userId,
        pending: m.status === "HELD",
        removed: m.status === "REMOVED"
      }))
  });
});

/** Reply inside a thread you're already part of. */
router.post(
  "/:threadId",
  rateLimit({ name: "messages.send", max: 30, windowSeconds: 3600 }),
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);
    const parsed = z.object({ text: z.string().trim().min(2).max(MAX) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: `Messages are 2–${MAX} characters` });
      return;
    }
    const thread = await prisma.messageThread.findUnique({
      where: { id: String(req.params["threadId"]) },
      select: { id: true, status: true, readerId: true, authorId: true }
    });
    const side = thread ? sideOf(thread, userId) : null;
    if (!thread || !side) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    if (thread.status === "CLOSED") {
      res.status(403).json({ error: "This conversation has ended." });
      return;
    }
    const refusal = await blockReason(thread.readerId, thread.authorId, { readerWriting: side === "reader" });
    if (refusal) {
      res.status(403).json({ error: refusal });
      return;
    }

    const screening = await screenText(parsed.data.text, "a private message between a reader and an author");
    if (screening.verdict === "block") {
      const selfHarm = /self.harm|suicide|hurt (your|them)self/i.test(`${screening.reason ?? ""} ${parsed.data.text}`);
      res.status(422).json({
        error: selfHarm
          ? "We couldn't send that. If you're going through something difficult, talking to someone you trust — or a local helpline — can help."
          : "That message can't be sent.",
        support: selfHarm
      });
      return;
    }

    const message = await prisma.message.create({
      data: { threadId: thread.id, senderId: userId, text: parsed.data.text, status: statusFor(screening) },
      select: { id: true, text: true, status: true, createdAt: true }
    });
    await prisma.messageThread.update({
      where: { id: thread.id },
      data: {
        lastMessageAt: message.createdAt,
        ...(side === "reader" ? { readerReadAt: message.createdAt } : { authorReadAt: message.createdAt })
      }
    });

    res.status(201).json({
      message: { id: message.id, text: message.text, createdAt: message.createdAt, mine: true, pending: message.status === "HELD" },
      held: message.status === "HELD"
    });
  }
);

/** The author ends it. The thread stays readable to both, but nothing more is sent. */
router.post("/:threadId/close", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const thread = await prisma.messageThread.findUnique({
    where: { id: String(req.params["threadId"]) },
    select: { id: true, authorId: true }
  });
  if (!thread || thread.authorId !== userId) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  await prisma.messageThread.update({ where: { id: thread.id }, data: { status: "CLOSED" } });
  res.json({ ok: true });
});

export default router;
