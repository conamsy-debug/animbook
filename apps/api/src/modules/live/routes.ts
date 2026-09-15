import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { liveEventBus } from "./bus.js";

const router = Router();
router.use(authMiddleware);

const startSchema = z.object({
  bookId: z.string().min(1),
  title: z.string().min(1).max(160)
});

router.post("/sessions", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid session payload", details: parsed.error.flatten() });
    return;
  }
  const book = await prisma.book.findFirst({ where: { OR: [{ id: parsed.data.bookId }, { slug: parsed.data.bookId }] } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const session = await prisma.liveSession.create({
    data: {
      bookId: book.id,
      hostId: userId,
      title: parsed.data.title,
      status: "LIVE"
    }
  });
  liveEventBus.publish(session.id, { type: "session.started", payload: { sessionId: session.id, title: session.title } });
  res.status(201).json({ session });
});

router.get("/sessions", async (_req: Request, res: Response) => {
  const sessions = await prisma.liveSession.findMany({
    where: { status: "LIVE" },
    include: { book: { select: { id: true, slug: true, title: true, totalPages: true } } },
    orderBy: { startedAt: "desc" },
    take: 20
  });
  res.json({ items: sessions });
});

router.post("/sessions/:id/append", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing session id" });
    return;
  }
  const schema = z.object({
    type: z.enum(["page.flipped", "annotation", "page.being-written"]),
    payload: z.record(z.union([z.string(), z.number(), z.boolean()]))
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid event", details: parsed.error.flatten() });
    return;
  }
  const session = await prisma.liveSession.findUnique({ where: { id } });
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  if (session.hostId !== userId) {
    res.status(403).json({ error: "Only the host can append events" });
    return;
  }
  const event = await prisma.liveEvent.create({
    data: {
      sessionId: session.id,
      type: parsed.data.type,
      payload: parsed.data.payload
    }
  });
  if (parsed.data.type === "page.flipped") {
    const nextPage = Number(parsed.data.payload["pageNum"]);
    if (Number.isFinite(nextPage)) {
      await prisma.liveSession.update({
        where: { id: session.id },
        data: { currentPage: nextPage }
      });
    }
  }
  liveEventBus.publish(session.id, { type: event.type, payload: event.payload as Record<string, unknown> });
  res.json({ event });
});

router.post("/sessions/:id/end", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing session id" });
    return;
  }
  const session = await prisma.liveSession.findUnique({ where: { id } });
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  if (session.hostId !== userId) {
    res.status(403).json({ error: "Only the host can end the session" });
    return;
  }
  await prisma.liveSession.update({ where: { id: session.id }, data: { status: "ENDED", endedAt: new Date() } });
  liveEventBus.publish(session.id, { type: "session.ended", payload: { sessionId: session.id } });
  res.json({ ok: true });
});

router.get("/sessions/:id/events", async (req: Request, res: Response) => {
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing session id" });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const unsubscribe = liveEventBus.subscribe(id, (event) => {
    res.write(`event: live\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: {"at":"${new Date().toISOString()}"}\n\n`);
  }, 15000);
  req.on("close", () => {
    unsubscribe();
    clearInterval(heartbeat);
  });
});

export default router;