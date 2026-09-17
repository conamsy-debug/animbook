import type { Request, Response } from "express";
import express, { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import {
  enqueuePipeline,
  registerManuscript,
  shutdownPipeline
} from "../../services/pipeline.js";
import { emitPipelineEvent, subscribeProject, writeSseEvent, writeSseHeaders, type PipelineEvent } from "../../studio/events.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import { ExtractError, extractManuscript } from "../../services/manuscriptExtract.js";

const router = Router();
router.use(authMiddleware);

const createSchema = z.object({
  name: z.string().min(1),
  vertical: z.enum([
    "CONSUMER",
    "KIDS",
    "EDU",
    "FAITH",
    "DOCS",
    "VERSE",
    "COMICS",
    "BUSINESS",
    "WELLNESS",
    "LAW",
    "TRAVEL",
    "ORIGINALS"
  ]),
  title: z.string().min(1),
  subtitle: z.string().trim().max(200).optional(),
  author: z.string().min(1),
  synopsis: z.string().min(1).optional(),
  language: z.string().default("en")
});

/**
 * POST /api/studio/extract — body is the raw file (any content type), with
 * the file name in the X-Filename header. Returns the manuscript as plain text.
 */
router.post(
  "/extract",
  rateLimit({ name: "studio.extract", max: 20, windowSeconds: 60 }),
  express.raw({ type: () => true, limit: "25mb" }),
  async (req: AuthedRequest, res: Response) => {
    requireUserId(req);
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "No file received" });
      return;
    }
    const filename = decodeURIComponent(String(req.header("x-filename") ?? "manuscript"));
    try {
      const { text, kind } = await extractManuscript(filename, body);
      res.json({ text, kind, characters: text.length });
    } catch (err) {
      if (err instanceof ExtractError) {
        res.status(422).json({ error: err.message });
        return;
      }
      console.warn(`[studio/extract] ${filename}: ${(err as Error).message}`);
      res.status(422).json({ error: "Couldn't read that file. Try saving it as .docx or PDF again, or paste the text." });
    }
  }
);

router.get("/projects", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const projects = await prisma.studioProject.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: { book: { select: { id: true, slug: true, title: true, author: true, coverUrl: true, status: true, _count: { select: { pages: true } } } } }
  });
  res.json({
    items: projects.map((p) => ({
      id: p.id,
      name: p.name,
      vertical: p.vertical,
      status: p.status,
      currentStage: p.currentStage,
      updatedAt: p.updatedAt,
      book: p.book
        ? { id: p.book.id, slug: p.book.slug, title: p.book.title, author: p.book.author, coverUrl: p.book.coverUrl, status: p.book.status, pageCount: p.book._count.pages }
        : null
    }))
  });
});

router.post("/projects", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project", details: parsed.error.flatten() });
    return;
  }
  const { name, vertical, title, subtitle, author, synopsis, language } = parsed.data;
  const slugBase = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const slug = `${slugBase}-${Date.now().toString(36)}`;
  const requiresExpertReview = vertical === "EDU" || vertical === "FAITH";
  const book = await prisma.book.create({
    data: {
      slug,
      title,
      subtitle: subtitle || null,
      author,
      synopsis: synopsis ?? "",
      vertical,
      language,
      status: "DRAFT",
      requiresExpertReview,
      expertReviewStatus: requiresExpertReview ? "PENDING" : "NOT_REQUIRED"
    }
  });
  const project = await prisma.studioProject.create({
    data: {
      ownerId: userId,
      bookId: book.id,
      name,
      vertical,
      status: "SETUP",
      currentStage: "MANUSCRIPT_INGESTION",
      expertReviewRequired: requiresExpertReview
    }
  });
  res.status(201).json({ project, book });
});

router.post("/projects/:id/upload", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  const project = await prisma.studioProject.findFirst({ where: { id, ownerId: userId } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const schema = z.object({
    sourceFilename: z.string().min(1),
    sha256: z.string().min(8),
    pages: z
      .array(
        z.object({
          pageNum: z.number().int().min(1),
          chapter: z.string().nullable().optional(),
          text: z.string().min(1)
        })
      )
      .min(1)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid manuscript", details: parsed.error.flatten() });
    return;
  }
  await registerManuscript(id, parsed.data);
  emitPipelineEvent(id, {
    stage: "MANUSCRIPT_INGESTION",
    status: "succeeded",
    progress: 10,
    message: `${parsed.data.pages.length} pages ingested`,
    at: new Date().toISOString()
  });
  res.json({ projectId: id, pages: parsed.data.pages.length });
});

router.post(
  "/projects/:id/analyze",
  rateLimit({ name: "studio.analyze", max: 30, windowSeconds: 60 }),
  async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  const project = await prisma.studioProject.findFirst({ where: { id, ownerId: userId } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const jobId = await enqueuePipeline({ projectId: id, triggerStage: "BOOK_BRAIN_ANALYSIS" });
  await prisma.studioProject.update({ where: { id }, data: { status: "ANALYZING" } });
  emitPipelineEvent(id, {
    stage: "PIPELINE",
    status: "queued",
    progress: 5,
    message: "Pipeline queued",
    jobId,
    at: new Date().toISOString()
  });
  res.json({ projectId: id, jobId });
});

router.get("/projects/:id", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  const project = await prisma.studioProject.findFirst({
    where: { id, ownerId: userId },
    include: {
      book: { include: { brain: true, pages: { orderBy: { pageNum: "asc" } } } }
    }
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(project);
});

router.put("/projects/:id/brain", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  const project = await prisma.studioProject.findFirst({
    where: { id, ownerId: userId },
    include: { book: true }
  });
  if (!project?.book) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const schema = z.object({ brain: z.record(z.unknown()) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid brain payload", details: parsed.error.flatten() });
    return;
  }
  const brain = parsed.data.brain as Record<string, unknown>;
  const genre = Array.isArray(brain["genre"]) ? (brain["genre"] as string[]) : [];
  const culturalOrigin = typeof brain["cultural_origin"] === "string" ? brain["cultural_origin"] : null;
  const targetAudience = typeof brain["target_audience"] === "string" ? brain["target_audience"] : null;
  const styleSelected = typeof brain["style_recommendation"] === "string" ? brain["style_recommendation"] : null;
  const jsonPayload = brain as unknown as object;
  await prisma.bookBrain.upsert({
    where: { bookId: project.book.id },
    create: {
      bookId: project.book.id,
      genre,
      culturalOrigin,
      targetAudience,
      styleSelected,
      rawJson: jsonPayload
    },
    update: { genre, culturalOrigin, targetAudience, styleSelected, rawJson: jsonPayload }
  });
  await prisma.studioProject.update({ where: { id }, data: { status: "STYLE_SELECTION" } });
  res.json({ ok: true });
});

router.post("/projects/:id/style", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  const project = await prisma.studioProject.findFirst({ where: { id, ownerId: userId } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const schema = z.object({ styleId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid style", details: parsed.error.flatten() });
    return;
  }
  if (!project.bookId) {
    res.status(400).json({ error: "Project has no book" });
    return;
  }
  await prisma.book.update({ where: { id: project.bookId }, data: { styleId: parsed.data.styleId } });
  await prisma.studioProject.update({ where: { id }, data: { status: "STYLE_SELECTION", currentStage: "VISUAL_STYLE" } });
  emitPipelineEvent(id, {
    stage: "VISUAL_STYLE",
    status: "succeeded",
    progress: 50,
    message: `Style ${parsed.data.styleId} selected`,
    at: new Date().toISOString()
  });
  res.json({ ok: true });
});

router.get("/projects/:id/style/status", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  const project = await prisma.studioProject.findFirst({ where: { id, ownerId: userId } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json({ status: project.status, currentStage: project.currentStage });
});

router.post("/projects/:id/generate", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  const project = await prisma.studioProject.findFirst({ where: { id, ownerId: userId } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (project.status === "GENERATING") {
    res.status(409).json({ error: "Generation is already running for this project" });
    return;
  }
  const brain = project.bookId ? await prisma.bookBrain.findUnique({ where: { bookId: project.bookId }, select: { id: true } }) : null;
  if (!brain) {
    res.status(409).json({ error: "Run the Book Brain analysis first" });
    return;
  }
  await prisma.studioProject.update({ where: { id }, data: { status: "GENERATING", currentStage: "PROMPT_GENERATION" } });
  const jobId = await enqueuePipeline({ projectId: id, triggerStage: "VIDEO_GENERATION" });
  emitPipelineEvent(id, {
    stage: "VIDEO_GENERATION",
    status: "queued",
    progress: 32,
    message: "Generation queued",
    jobId,
    at: new Date().toISOString()
  });
  res.json({ projectId: id, jobId });
});

router.get("/projects/:id/pages", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  const project = await prisma.studioProject.findFirst({ where: { id, ownerId: userId }, select: { bookId: true } });
  if (!project?.bookId) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const pages = await prisma.page.findMany({
    where: { bookId: project.bookId },
    orderBy: { pageNum: "asc" }
  });
  res.json({ pages });
});

router.put("/pages/:pageId/approve", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const pageId = req.params["pageId"];
  if (typeof pageId !== "string") {
    res.status(400).json({ error: "Missing page id" });
    return;
  }
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: { book: { include: { studioProject: true } } }
  });
  if (!page?.book.studioProject || page.book.studioProject.ownerId !== userId) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  await prisma.page.update({ where: { id: pageId }, data: { status: "APPROVED" } });
  res.json({ ok: true });
});

router.post("/pages/:pageId/regenerate", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const pageId = req.params["pageId"];
  if (typeof pageId !== "string") {
    res.status(400).json({ error: "Missing page id" });
    return;
  }
  const schema = z.object({ note: z.string().min(1).max(2000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid note", details: parsed.error.flatten() });
    return;
  }
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: { book: { include: { studioProject: true } } }
  });
  if (!page?.book.studioProject || page.book.studioProject.ownerId !== userId) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  await prisma.page.update({
    where: { id: pageId },
    data: {
      status: "REGENERATING",
      directionNote: parsed.data.note,
      regenerationCount: { increment: 1 }
    }
  });
  const jobId = await enqueuePipeline({
    projectId: page.book.studioProject.id,
    triggerStage: "VIDEO_GENERATION",
    pageId
  });
  emitPipelineEvent(page.book.studioProject.id, {
    stage: "VIDEO_GENERATION",
    status: "queued",
    progress: 60,
    message: `Page ${page.pageNum} queued for regeneration`,
    jobId,
    at: new Date().toISOString()
  });
  res.json({ ok: true, jobId });
});

router.post("/projects/:id/audio", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  const project = await prisma.studioProject.findFirst({ where: { id, ownerId: userId } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  await prisma.studioProject.update({ where: { id }, data: { status: "AUDIO", currentStage: "AUDIO_PRODUCTION" } });
  const jobId = await enqueuePipeline({ projectId: id, triggerStage: "AUDIO_PRODUCTION" });
  res.json({ projectId: id, jobId });
});

router.post("/projects/:id/publish", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  const project = await prisma.studioProject.findFirst({
    where: { id, ownerId: userId },
    include: { book: true }
  });
  if (!project?.book) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (project.book.requiresExpertReview && project.book.expertReviewStatus !== "APPROVED") {
    res.status(409).json({
      error: "Expert review required",
      expertReviewStatus: project.book.expertReviewStatus
    });
    return;
  }
  await prisma.studioProject.update({
    where: { id },
    data: { status: "PUBLISHED", approvedForPublishAt: new Date() }
  });
  await prisma.book.update({ where: { id: project.book.id }, data: { status: "PUBLISHED" } });
  emitPipelineEvent(id, {
    stage: "PUBLISH",
    status: "succeeded",
    progress: 100,
    message: "AnimBook published",
    at: new Date().toISOString()
  });
  res.json({ ok: true, slug: project.book.slug });
});

router.get("/projects/:id/analytics", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  const project = await prisma.studioProject.findFirst({
    where: { id, ownerId: userId },
    include: { book: { include: { pages: true } }, jobs: true }
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const approved = project.book?.pages.filter((p) => p.status === "APPROVED").length ?? 0;
  const flagged = project.book?.pages.filter((p) => p.status === "FLAGGED").length ?? 0;
  res.json({
    pageCount: project.book?.pages.length ?? 0,
    approved,
    flagged,
    jobs: project.jobs.length
  });
});

router.get("/projects/:id/events", async (req: AuthedRequest, res: Response) => {
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  writeSseHeaders(res);
  const unsubscribe = subscribeProject(id, (event: PipelineEvent) => writeSseEvent(res, event));
  const heartbeat: NodeJS.Timeout = setInterval(() => {
    res.write(`event: heartbeat\ndata: {"at":"${new Date().toISOString()}"}\n\n`);
  }, 15000);
  req.on("close", () => {
    unsubscribe();
    clearInterval(heartbeat);
  });
});

process.on("SIGTERM", () => {
  void shutdownPipeline();
});

export default router;