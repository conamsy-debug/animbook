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
import { uploadAsset } from "../../services/cloudflare.js";
import { isValidSubcategory } from "../../config/subcategories.js";
import { applySchedule, lockSchedule, CHUNK_PERCENT_OPTIONS } from "../../services/releaseSchedule.js";
import { enqueueAnimateJob, type SplitJobData } from "../../services/splitPipeline.js";
import { move as moveState, moveMany as moveManyState } from "../../services/pageState.js";
import { generateNarration } from "../../services/elevenlabs.js";
import { findVoice, defaultVoiceIdFor } from "../../config/voices.js";
import { recordUsage } from "../../services/usageTracking.js";
import splitRoutes from "./splitRoutes.js";

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
  subcategory: z.string().trim().max(40).optional(),
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

const COVER_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp"
};

/**
 * PUT /api/studio/projects/:id/cover — the author's own cover art, sent as the
 * raw image with its file name in X-Filename. Stored in R2; sets book.coverUrl.
 */
router.put(
  "/projects/:id/cover",
  rateLimit({ name: "studio.cover", max: 20, windowSeconds: 60 }),
  express.raw({ type: () => true, limit: "12mb" }),
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);
    const id = req.params["id"];
    const project = await prisma.studioProject.findFirst({ where: { id: String(id), ownerId: userId }, include: { book: true } });
    if (!project?.book) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "No image received" });
      return;
    }
    const filename = decodeURIComponent(String(req.header("x-filename") ?? "cover.png")).toLowerCase();
    const ext = filename.split(".").pop() ?? "";
    const contentType = COVER_TYPES[ext];
    if (!contentType) {
      res.status(415).json({ error: "Please upload a PNG, JPG or WebP image." });
      return;
    }
    try {
      const stored = await uploadAsset({
        key: `books/${project.book.slug}/cover-${Date.now().toString(36)}.${ext === "jpeg" ? "jpg" : ext}`,
        body,
        contentType
      });
      await prisma.book.update({ where: { id: project.book.id }, data: { coverUrl: stored.url } });
      res.json({ coverUrl: stored.url });
    } catch (err) {
      console.warn(`[studio/cover] ${(err as Error).message}`);
      res.status(502).json({ error: "Could not store the cover. Please try again." });
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
  const { name, vertical, title, subtitle, subcategory, author, synopsis, language } = parsed.data;
  if (!isValidSubcategory(vertical, subcategory)) {
    res.status(400).json({ error: "Unknown subcategory for this vertical" });
    return;
  }
  const slugBase = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const slug = `${slugBase}-${Date.now().toString(36)}`;
  const requiresExpertReview = vertical === "EDU" || vertical === "FAITH";
  const book = await prisma.book.create({
    data: {
      slug,
      creatorId: userId,
      title,
      subtitle: subtitle || null,
      subcategory: subcategory || null,
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
  const modeSchema = z.object({ mode: z.enum(["full", "illustrated"]).optional() });
  const mode = modeSchema.safeParse(req.body ?? {}).data?.mode ?? "full";
  await prisma.studioProject.update({ where: { id }, data: { status: "GENERATING", currentStage: "PROMPT_GENERATION" } });
  const jobId = await enqueuePipeline({ projectId: id, triggerStage: "VIDEO_GENERATION", mode });
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
  // For split-pipeline books, also flip clipStatus so legacy readers
  // (which still read Page.status) keep working. We use move() so a
  // clip in GENERATING/QUEUED/STALE doesn't silently flip.
  if (page.book.splitPipeline) {
    try {
      await moveState("clipStatus", pageId, "APPROVED");
    } catch {
      // Clip wasn't in a state that allowed APPROVED — fall back to
      // a plain update only if the page is otherwise ready.
      if (page.clipStatus === "QUEUED" || page.clipStatus === "GENERATING" || page.clipStatus === "STALE") {
        res.status(409).json({ error: "Clip is still in flight; wait for it to finish first." });
        return;
      }
    }
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

/* --------------------------------------------------------------------- *
 * Per-page audio re-narrate
 *
 * Synchronous endpoint for fixing individual pages where the project-level
 * audio kick silently skipped (e.g. OCR-garbage text that ElevenLabs
 * rejected, or pages whose textExcerpt was updated post-kick). The author
 * cleans the text in the Studio / API and hits "Re-narrate" — single page,
 * no Bull queue, returns the new audioUrl when done.
 *
 * Voice precedence mirrors runAudioStage in pipeline.ts:
 *   1. BookBrain.narratorVoiceId (book-level pin set via Studio picker)
 *   2. Author's ElevenLabs clone (if CLONED)
 *   3. Vertical + region default (e.g. british-teacher for FAITH)
 *
 * Rate-limited to 30 / minute — ElevenLabs TTS is the expensive part, no
 * reason to let a misbehaving client hammer it.
 * --------------------------------------------------------------------- */
router.post(
  "/pages/:pageId/audio-regenerate",
  rateLimit({ name: "studio.audioRegen", max: 30, windowSeconds: 60 }),
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);
    const pageId = req.params["pageId"];
    if (typeof pageId !== "string") {
      res.status(400).json({ error: "Missing page id" });
      return;
    }
    const page = await prisma.page.findUnique({
      where: { id: pageId },
      include: {
        book: {
          include: {
            studioProject: { select: { id: true, ownerId: true } },
            creator: { select: { narratorVoiceId: true, voiceStatus: true } }
          }
        }
      }
    });
    if (!page?.book.studioProject || page.book.studioProject.ownerId !== userId) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    const text = (page.textExcerpt ?? "").trim();
    if (!text) {
      res.status(400).json({ error: "Page has no text to narrate" });
      return;
    }
    const brain = await prisma.bookBrain.findUnique({
      where: { bookId: page.bookId },
      select: { narratorVoiceId: true, culturalOrigin: true }
    });
    let chosenId = brain?.narratorVoiceId ?? null;
    if (!chosenId || chosenId === "author:auto") {
      if (page.book.creator?.narratorVoiceId && page.book.creator.voiceStatus === "CLONED") {
        chosenId = page.book.creator.narratorVoiceId;
      }
    }
    if (!chosenId) {
      chosenId = findVoice(
        defaultVoiceIdFor({ vertical: page.book.vertical, setting: brain?.culturalOrigin })
      )?.elevenVoiceId;
    }
    const voiceId = chosenId?.startsWith("author:") ? chosenId.slice("author:".length) : chosenId;
    if (!voiceId) {
      res.status(503).json({ error: "No narrator voice configured for this book" });
      return;
    }
    const result = await generateNarration({
      text,
      voiceId,
      storageKey: `narration/${page.book.studioProject.id}/p${page.pageNum}-${Date.now().toString(36)}.mp3`
    });
    if (!result.audioUrl) {
      // Stub: ElevenLabs/R2 not configured or text was rejected. Mark
      // FAILED so the chip flips and the user knows to investigate.
      // Still record the failed attempt so the dashboard surfaces the
      // spent-tokens side of the equation.
      await recordUsage({
        userId,
        bookId: page.bookId,
        pageId,
        kind: "AUDIO_REGEN",
        provider: "ELEVENLABS",
        units: text.length,
        unitCostUsd: 0.00018,
        status: "STUB",
        metadata: { pageNum: page.pageNum }
      });
      await prisma.page.update({
        where: { id: pageId },
        data: { audioStatus: "FAILED" }
      }).catch(() => undefined);
      res.status(502).json({
        error: "ElevenLabs returned no narration for this page",
        hint: "Check the page text — content-classifier rejects and OCR garbage often cause this"
      });
      return;
    }
    await prisma.page.update({
      where: { id: pageId },
      data: { audioUrl: result.audioUrl, vttUrl: result.vttUrl, audioStatus: "READY" }
    });
    await recordUsage({
      userId,
      bookId: page.bookId,
      pageId,
      kind: "AUDIO_REGEN",
      provider: "ELEVENLABS",
      units: text.length,
      unitCostUsd: 0.00018,
      metadata: { pageNum: page.pageNum, voiceId: chosenId ?? "default" }
    });
    res.json({
      pageId,
      audioUrl: result.audioUrl,
      vttUrl: result.vttUrl,
      characters: result.characters
    });
  }
);

router.post("/projects/:id/audio", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  const project = await prisma.studioProject.findFirst({
    where: { id, ownerId: userId },
    select: { id: true, bookId: true }
  });
  if (!project?.bookId) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  // Record the kick intent (cost will be settled per-page as the worker
  // narrates). Counting pages + chars here gives the dashboard a fast
  // upper-bound estimate so the user sees "this kick will cost about
  // $X" alongside the queued jobId.
  const pagesToNarrate = await prisma.page.findMany({
    where: { bookId: project.bookId, audioUrl: null },
    select: { textExcerpt: true }
  });
  const totalChars = pagesToNarrate.reduce(
    (sum, p) => sum + (p.textExcerpt ?? "").length,
    0
  );
  await recordUsage({
    userId,
    bookId: project.bookId,
    kind: "NARRATION_KICK",
    provider: "ELEVENLABS",
    units: totalChars,
    unitCostUsd: 0.00018, // $0.18 per 1k chars
    metadata: {
      pages: pagesToNarrate.length,
      estimatedUsd: Math.round((totalChars / 1000) * 0.18 * 100) / 100
    }
  });
  await prisma.studioProject.update({ where: { id }, data: { status: "AUDIO", currentStage: "AUDIO_PRODUCTION" } });
  const jobId = await enqueuePipeline({ projectId: id, triggerStage: "AUDIO_PRODUCTION" });
  res.json({ projectId: id, jobId, pagesQueued: pagesToNarrate.length, estimatedUsd: Math.round((totalChars / 1000) * 0.18 * 100) / 100 });
});

const scheduleSchema = z.object({
  mode: z.enum(["IMMEDIATE", "TIME", "TASK"]),
  cadence: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional(),
  chunkPercent: z.union([z.literal(10), z.literal(25)]).optional(),
  startAt: z.string().datetime().optional(),
  dailyTaskPrompt: z.string().trim().max(280).optional()
});

router.put(
  "/projects/:id/schedule",
  rateLimit({ name: "studio.schedule", max: 30, windowSeconds: 600 }),
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);
    const id = req.params["id"];
    if (typeof id !== "string") {
      res.status(400).json({ error: "Missing project id" });
      return;
    }
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid schedule", details: parsed.error.flatten() });
      return;
    }
    const project = await prisma.studioProject.findFirst({
      where: { id, ownerId: userId },
      select: { id: true, bookId: true, book: { select: { id: true, releaseScheduleLockedAt: true } } }
    });
    if (!project?.book) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (project.book.releaseScheduleLockedAt) {
      res.status(409).json({ error: "The release schedule is locked. Archive and re-publish to change it." });
      return;
    }
    try {
      await applySchedule(project.bookId, {
        mode: parsed.data.mode,
        cadence: parsed.data.cadence,
        chunkPercent: parsed.data.chunkPercent,
        startAt: parsed.data.startAt ? new Date(parsed.data.startAt) : null,
        dailyTaskPrompt: parsed.data.dailyTaskPrompt
      });
      res.json({ ok: true });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({ error: (err as Error).message });
    }
  }
);

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
  // Split-pipeline gate: every page must have an APPROVED still, an
  // APPROVED clip, and READY audio. Returning the blocking page list
  // lets the author fix them in the UI without having to grep.
  if (project.book.splitPipeline) {
    const blockers = await prisma.page.findMany({
      where: {
        bookId: project.book.id,
        OR: [
          { stillStatus: { not: "APPROVED" } },
          { clipStatus: { not: "APPROVED" } },
          { audioStatus: { not: "READY" } }
        ]
      },
      select: { id: true, pageNum: true, stillStatus: true, clipStatus: true, audioStatus: true },
      orderBy: { pageNum: "asc" }
    });
    if (blockers.length > 0) {
      res.status(409).json({
        error: "Some pages aren't ready to publish yet",
        blockingPages: blockers.map((b) => ({
          pageId: b.id,
          pageNum: b.pageNum,
          stillStatus: b.stillStatus,
          clipStatus: b.clipStatus,
          audioStatus: b.audioStatus
        }))
      });
      return;
    }
  }
  await prisma.studioProject.update({
    where: { id },
    data: { status: "PUBLISHED", approvedForPublishAt: new Date() }
  });
  await prisma.book.update({ where: { id: project.book.id }, data: { status: "PUBLISHED" } });
  // Lock the release schedule the moment the book goes live — drip cadence
  // and chunk size are now immutable until the book is archived + re-published.
  await lockSchedule(project.book.id);
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

/**
 * Re-animate every FLAGGED page on the project — same code path as the
 * per-page "Re-animate" button, just batched. Use after a platform
 * incident (Runway schema drift, classifier reject storm) when many pages
 * failed at once. Idempotent: pages that are no longer FLAGGED are skipped.
 *
 * For split-pipeline books we route through ANIMATE_PAGE so the still
 * gate is still honoured — we don't burn Runway credits on a still the
 * author hasn't approved.
 */
router.post(
  "/projects/:id/reanimate-failed",
  rateLimit({ name: "studio.reanimate", max: 10, windowSeconds: 60 }),
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);
    const id = req.params["id"];
    if (typeof id !== "string") {
      res.status(400).json({ error: "Missing project id" });
      return;
    }
    const project = await prisma.studioProject.findFirst({
      where: { id, ownerId: userId },
      select: { id: true, bookId: true, book: { select: { splitPipeline: true } } }
    });
    if (!project?.bookId) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.book?.splitPipeline) {
      // FAILED-only filter per the brief: pages still in FLAGGED in
      // legacy `status` aren't necessarily broken — they just need an
      // author decision. Only re-queue those marked FAILED on clipStatus.
      const flagged = await prisma.page.findMany({
        where: { bookId: project.bookId, clipStatus: "FAILED", stillStatus: "APPROVED" },
        select: { id: true, pageNum: true, stillVersion: true },
        orderBy: { pageNum: "asc" }
      });
      if (flagged.length === 0) {
        res.json({ projectId: id, queued: 0, message: "No failed clips to re-animate" });
        return;
      }
      const winnerIds = await moveManyState("clipStatus", flagged.map((f) => f.id), "QUEUED");
      const winners = flagged.filter((f) => winnerIds.includes(f.id));
      const jobIds: string[] = [];
      for (const w of winners) {
        const jobId = await enqueueAnimateJob({
          projectId: id,
          pageId: w.id,
          stillVersion: w.stillVersion
        } satisfies SplitJobData);
        jobIds.push(jobId);
      }
      emitPipelineEvent(id, {
        stage: "ANIMATE_PAGE",
        status: "queued",
        progress: 60,
        message: `${winners.length} page${winners.length === 1 ? "" : "s"} queued for re-animation`,
        at: new Date().toISOString()
      });
      res.json({
        projectId: id,
        queued: winners.length,
        pages: winners.map((w) => w.pageNum),
        jobIds
      });
      return;
    }

    const flagged = await prisma.page.findMany({
      where: { bookId: project.bookId, status: "FLAGGED" },
      select: { id: true, pageNum: true },
      orderBy: { pageNum: "asc" }
    });
    if (flagged.length === 0) {
      res.json({ projectId: id, queued: 0, message: "No failed pages to re-animate" });
      return;
    }
    // Reset status so the page returns to in-flight; each page also tracks
    // its own regeneration count for triaging repeat offenders.
    await prisma.page.updateMany({
      where: { id: { in: flagged.map((p) => p.id) } },
      data: { status: "REGENERATING", regenerationCount: { increment: 1 } }
    });
    const jobIds: string[] = [];
    for (const p of flagged) {
      const jobId = await enqueuePipeline({
        projectId: id,
        triggerStage: "VIDEO_GENERATION",
        pageId: p.id
      });
      jobIds.push(jobId);
    }
    emitPipelineEvent(id, {
      stage: "VIDEO_GENERATION",
      status: "queued",
      progress: 60,
      message: `${flagged.length} page${flagged.length === 1 ? "" : "s"} queued for re-animation`,
      at: new Date().toISOString()
    });
    res.json({
      projectId: id,
      queued: flagged.length,
      pages: flagged.map((p) => p.pageNum),
      jobIds
    });
  }
);

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

// Voice picking uses shared voices helpers.
import { narratorVoices } from "../../config/voices.js";

/**
 * GET /api/studio/projects/:id/narrator-voice — list voices available to this
 * author (curated + the author's own clone when present) and which one is
 * currently selected for the book (via BookBrain.narratorVoiceId).
 */
router.get("/projects/:id/narrator-voice", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  const project = await prisma.studioProject.findFirst({
    where: { id, ownerId: userId },
    select: { id: true, bookId: true }
  });
  if (!project?.bookId) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const [brain, book] = await Promise.all([
    prisma.bookBrain.findUnique({
      where: { bookId: project.bookId },
      select: { narratorVoiceId: true }
    }),
    prisma.book.findUnique({
      where: { id: project.bookId },
      select: { creator: { select: { id: true, name: true, narratorVoiceId: true, voiceStatus: true } } }
    })
  ]);
  const creator = book?.creator;
  const voices: { id: string; label: string; description: string; isAuthor: boolean; elevenVoiceId: string }[] = [];
  if (creator?.narratorVoiceId && creator.voiceStatus === "CLONED") {
    voices.push({
      id: `author:${creator.narratorVoiceId}`,
      label: `By ${creator.name} (your cloned voice)`,
      description: "ElevenLabs voice cloned from your own audio samples. Audiences hear you read every page.",
      isAuthor: true,
      elevenVoiceId: creator.narratorVoiceId
    });
  }
  for (const v of narratorVoices()) {
    voices.push({ id: v.id, label: v.label, description: v.description, isAuthor: false, elevenVoiceId: v.elevenVoiceId });
  }
  res.json({
    voices,
    selectedVoiceId: brain?.narratorVoiceId ?? null,
    hasClone: Boolean(creator?.narratorVoiceId && creator.voiceStatus === "CLONED")
  });
});

const narratorPickSchema = z.object({
  voiceId: z.string().min(3).max(80),
  // When true, the next audio rerun uses the new voice. Existing
  // recordings stay cached (cheap re-pick) unless reNarrate is also true.
  reNarrate: z.boolean().optional().default(false)
});

/**
 * PUT /api/studio/projects/:id/narrator-voice — book-level narrator choice.
 * `voiceId` may be one of the curated ids ("british-storyteller" …) or
 * "author:<elevenVoiceId>" to pin the author's clone to this book. Pass
 * `reNarrate: true` to clear cached audio for every page so the pipeline
 * re-records everything in the new voice.
 */
router.put(
  "/projects/:id/narrator-voice",
  rateLimit({ name: "studio.narratorVoice", max: 60, windowSeconds: 600 }),
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);
    const id = req.params["id"];
    if (typeof id !== "string") {
      res.status(400).json({ error: "Missing project id" });
      return;
    }
    const parsed = narratorPickSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid voice pick", details: parsed.error.flatten() });
      return;
    }
    const project = await prisma.studioProject.findFirst({
      where: { id, ownerId: userId },
      select: { id: true, bookId: true, book: { select: { creator: { select: { narratorVoiceId: true, voiceStatus: true } } } } }
    });
    if (!project?.bookId) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    // Validate the picked id either as a curated name OR an author-<…> clone.
    const curated = narratorVoices().find((v) => v.id === parsed.data.voiceId);
    const isAuthorClone = parsed.data.voiceId.startsWith("author:");
    if (!curated && !isAuthorClone) {
      res.status(400).json({ error: "Unknown voice id" });
      return;
    }
    if (isAuthorClone) {
      const cloneId = parsed.data.voiceId.slice("author:".length);
      if (!project.book?.creator?.narratorVoiceId || project.book.creator.voiceStatus !== "CLONED") {
        res.status(400).json({ error: "You don't have a cloned voice yet" });
        return;
      }
      if (cloneId !== project.book.creator.narratorVoiceId) {
        res.status(400).json({ error: "Voice id doesn't match your current clone" });
        return;
      }
    }
    await prisma.bookBrain.upsert({
      where: { bookId: project.bookId },
      create: {
        bookId: project.bookId,
        genre: [],
        narratorVoiceId: parsed.data.voiceId,
        rawJson: {} as unknown as object
      },
      update: { narratorVoiceId: parsed.data.voiceId }
    });
    let jobId: string | null = null;
    if (parsed.data.reNarrate) {
      // Clear cached audio for every page so the next run re-synthesises.
      await prisma.page.updateMany({
        where: { bookId: project.bookId },
        data: { audioUrl: null, vttUrl: null }
      });
      await prisma.studioProject.update({ where: { id }, data: { status: "AUDIO", currentStage: "AUDIO_PRODUCTION" } });
      jobId = await enqueuePipeline({ projectId: id, triggerStage: "AUDIO_PRODUCTION" });
    }
    res.json({
      ok: true,
      selectedVoiceId: parsed.data.voiceId,
      reNarrateQueued: Boolean(jobId),
      jobId
    });
  }
);

export default router;

// Split-pipeline routes (STILL_PAGE → approve → ANIMATE_PAGE) live in
// their own file. They share the auth + ownership helpers from above.
router.use(splitRoutes);