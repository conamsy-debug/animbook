/**
 * Studio split-pipeline routes — STILL_PAGE → (author approval) → ANIMATE_PAGE.
 *
 * Mounted alongside the existing studio router, but kept in its own file
 * because the per-page lifecycle adds ~10 endpoints and a publish gate
 * that's easier to reason about in isolation.
 *
 * All routes are auth-gated, all verify the caller owns the project, and
 * all reject callers without `Book.splitPipeline = true` (the legacy
 * single-stage VIDEO_GENERATION path stays in place for non-split books).
 */
import type { Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { move, moveMany } from "../../services/pageState.js";
import { enqueueAnimateJob, enqueueStillJob, estimateClipCostUsd, pickClipSeconds, type SplitJobData } from "../../services/splitPipeline.js";
import { rateLimit } from "../../middleware/rateLimit.js";

const router = Router();
router.use(authMiddleware);

/* --------------------------------------------------------------------- *
 * Helpers
 * --------------------------------------------------------------------- */

/** Look up the project + book, ensuring the caller owns it AND the book
 *  is in split-pipeline mode. Returns a normalized {projectId, bookId}
 *  pair on success; otherwise writes the error response and returns null. */
async function loadOwnedSplitProject(
  req: AuthedRequest,
  res: Response,
  projectIdRaw: string
): Promise<{ projectId: string; bookId: string } | null> {
  const userId = requireUserId(req);
  const projectId = String(projectIdRaw);
  const project = await prisma.studioProject.findFirst({
    where: { id: projectId, ownerId: userId },
    select: { id: true, bookId: true, book: { select: { id: true, splitPipeline: true } } }
  });
  if (!project?.book) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  if (!project.book.splitPipeline) {
    res.status(409).json({ error: "This project isn't using the split pipeline. Toggle splitPipeline=true on the book first." });
    return null;
  }
  return { projectId: project.id, bookId: project.book.id };
}

/** Look up a single page + verify the caller's project owns it + the
 *  book is split. Returns the page or null (with error already written). */
async function loadOwnedSplitPage(
  req: AuthedRequest,
  res: Response,
  pageIdRaw: string
): Promise<{ page: { id: string; bookId: string; pageNum: number; stillStatus: string; clipStatus: string; stillVersion: number; motionTier: "HERO" | "STANDARD" }; projectId: string } | null> {
  const userId = requireUserId(req);
  const pageId = String(pageIdRaw);
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: { book: { include: { studioProject: { select: { id: true, ownerId: true, book: { select: { splitPipeline: true } } } } } } }
  });
  if (!page || !page.book.studioProject || page.book.studioProject.ownerId !== userId) {
    res.status(404).json({ error: "Page not found" });
    return null;
  }
  if (!page.book.splitPipeline) {
    res.status(409).json({ error: "This book isn't using the split pipeline." });
    return null;
  }
  return {
    page: {
      id: page.id,
      bookId: page.bookId,
      pageNum: page.pageNum,
      stillStatus: page.stillStatus,
      clipStatus: page.clipStatus,
      stillVersion: page.stillVersion,
      motionTier: page.motionTier
    },
    projectId: page.book.studioProject.id
  };
}

/* --------------------------------------------------------------------- *
 * Stills
 * --------------------------------------------------------------------- */

/**
 * POST /api/studio/projects/:id/stills — enqueue STILL_PAGE for every
 * page whose still hasn't started (NONE) or hit a wall (FAILED). Other
 * pages are left alone; the author can regenerate those via the
 * per-page /still/regenerate route.
 */
router.post(
  "/projects/:id/stills",
  rateLimit({ name: "studio.stills", max: 30, windowSeconds: 60 }),
  async (req: AuthedRequest, res: Response) => {
    const loaded = await loadOwnedSplitProject(req, res, String(req.params["id"]));
    if (!loaded) return;
    const { projectId, bookId } = loaded;

    // Pull every page and let moveMany do the compare-and-set.
    const candidates = await prisma.page.findMany({
      where: { bookId, stillStatus: { in: ["NONE", "FAILED"] } },
      select: { id: true, pageNum: true, stillVersion: true }
    });
    if (candidates.length === 0) {
      res.json({ projectId, queued: 0, pages: [] });
      return;
    }
    // moveMany doesn't touch stillVersion — the still job will read the
    // current version from the row. We bump it for each candidate so the
    // Bull jobId is unique even if the user double-clicks.
    const winnerIds = await moveMany("stillStatus", candidates.map((c) => c.id), "GENERATING");
    if (winnerIds.length === 0) {
      res.json({ projectId, queued: 0, pages: [] });
      return;
    }
    const winners = candidates.filter((c) => winnerIds.includes(c.id));
    const jobIds: string[] = [];
    for (const w of winners) {
      const newVersion = w.stillVersion + 1;
      await prisma.page.update({ where: { id: w.id }, data: { stillVersion: newVersion } });
      const jobId = await enqueueStillJob({
        projectId,
        pageId: w.id,
        stillVersion: newVersion
      } satisfies SplitJobData);
      jobIds.push(jobId);
    }
    res.json({
      projectId,
      queued: winners.length,
      pages: winners.map((w) => w.pageNum),
      jobIds
    });
  }
);

/**
 * POST /api/pages/:pageId/still/regenerate — bump stillVersion, save
 * the optional prompt override, set stillStatus to GENERATING, enqueue.
 * Refuses when the clip is QUEUED or GENERATING (worker would lose the
 * race on move()) and marks any existing READY/APPROVED/FLAGGED clip as
 * STALE so the UI shows the pairing is broken.
 */
router.post(
  "/pages/:pageId/still/regenerate",
  rateLimit({ name: "studio.stillRegen", max: 60, windowSeconds: 60 }),
  async (req: AuthedRequest, res: Response) => {
    const loaded = await loadOwnedSplitPage(req, res, String(req.params["pageId"]));
    if (!loaded) return;
    const { page, projectId } = loaded;

    const schema = z.object({
      promptOverride: z.string().trim().min(1).max(2000).optional(),
      note: z.string().trim().min(1).max(2000).optional()
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid regenerate payload", details: parsed.error.flatten() });
      return;
    }

    if (page.clipStatus === "QUEUED" || page.clipStatus === "GENERATING") {
      res.status(409).json({ error: "Cannot regenerate while a clip is in flight. Wait for it to finish first." });
      return;
    }

    const newVersion = page.stillVersion + 1;
    // Move stillStatus -> GENERATING. move() throws if the state isn't in
    // an allowed source state — that's the guard for a concurrent regen.
    try {
      await move("stillStatus", page.id, "GENERATING");
    } catch {
      res.status(409).json({ error: "Still is already being regenerated. Wait for it to finish." });
      return;
    }
    // Mark any existing clip STALE so the UI makes it obvious the pairing
    // is broken until a new ANIMATE_PAGE completes.
    await prisma.page.update({
      where: { id: page.id },
      data: {
        stillVersion: newVersion,
        stillPrompt: parsed.data.promptOverride ?? null,
        ...(["READY", "APPROVED", "FLAGGED"].includes(page.clipStatus) ? { clipStatus: "STALE" } : {})
      }
    });
    const jobId = await enqueueStillJob({
      projectId,
      pageId: page.id,
      stillVersion: newVersion,
      promptOverride: parsed.data.promptOverride,
      note: parsed.data.note
    });
    res.json({ pageId: page.id, stillVersion: newVersion, jobId });
  }
);

/**
 * POST /api/pages/:pageId/still/approve — author signed off on the
 * still. Sets stillStatus = APPROVED. If a clip exists in STALE state
 * from a previous regenerate, leaves it alone — the author has to
 * click "Animate approved pages" to push it through.
 */
router.post(
  "/pages/:pageId/still/approve",
  rateLimit({ name: "studio.stillApprove", max: 120, windowSeconds: 60 }),
  async (req: AuthedRequest, res: Response) => {
    const loaded = await loadOwnedSplitPage(req, res, String(req.params["pageId"]));
    if (!loaded) return;
    const { page } = loaded;
    try {
      await move("stillStatus", page.id, "APPROVED");
    } catch {
      res.status(409).json({ error: "Still isn't in READY (or another APPROVED-eligible) state" });
      return;
    }
    res.json({ ok: true, pageId: page.id, stillStatus: "APPROVED" });
  }
);

/**
 * POST /api/studio/projects/:id/stills/approve-all — approve every page
 * whose still is currently READY (NOT GENERATING, NOT FAILED).
 */
router.post(
  "/projects/:id/stills/approve-all",
  rateLimit({ name: "studio.stillsApproveAll", max: 30, windowSeconds: 60 }),
  async (req: AuthedRequest, res: Response) => {
    const loaded = await loadOwnedSplitProject(req, res, String(req.params["id"]));
    if (!loaded) return;
    const { bookId } = loaded;
    const pages = await prisma.page.findMany({
      where: { bookId, stillStatus: "READY" },
      select: { id: true }
    });
    const winners = await moveMany("stillStatus", pages.map((p) => p.id), "APPROVED");
    res.json({ approved: winners.length });
  }
);

/* --------------------------------------------------------------------- *
 * Animate (clips)
 * --------------------------------------------------------------------- */

interface AnimateTarget {
  pageId: string;
  pageNum: number;
  motionTier: "HERO" | "STANDARD";
}

/** Pages that the author has approved stills on AND whose clip needs
 *  regenerating: clip is NONE (never started), FAILED (last attempt
 *  failed) or STALE (the still was regenerated and the old clip is
 *  invalid). We deliberately exclude APPROVED / FLAGGED / READY clips. */
async function listAnimateTargets(bookId: string): Promise<AnimateTarget[]> {
  const pages = await prisma.page.findMany({
    where: {
      bookId,
      stillStatus: "APPROVED",
      clipStatus: { in: ["NONE", "FAILED", "STALE"] }
    },
    select: { id: true, pageNum: true, motionTier: true, stillVersion: true }
  });
  return pages.map((p) => ({
    pageId: p.id,
    pageNum: p.pageNum,
    motionTier: p.motionTier
  }));
}

/**
 * GET /api/studio/projects/:id/animate/estimate — pre-flight cost
 * preview. Returns total page count, total seconds, total USD. Retries
 * are NOT included (per the brief) so the author doesn't get a number
 * that's higher than what they'll actually pay.
 */
router.get("/projects/:id/animate/estimate", async (req: AuthedRequest, res: Response) => {
  const loaded = await loadOwnedSplitProject(req, res, String(req.params["id"]));
  if (!loaded) return;
  const targets = await listAnimateTargets(loaded.bookId);
  const seconds = targets.reduce((sum, t) => sum + pickClipSeconds(t.motionTier), 0);
  const usd = estimateClipCostUsd(seconds);
  res.json({
    pages: targets.length,
    seconds,
    usd,
    byTier: {
      HERO: targets.filter((t) => t.motionTier === "HERO").length,
      STANDARD: targets.filter((t) => t.motionTier === "STANDARD").length
    }
  });
});

const animateBody = z.object({
  /** Cap the estimated cost. If the estimate exceeds this, we reject. */
  maxUsd: z.number().positive().max(1_000).optional()
});

/**
 * POST /api/studio/projects/:id/animate — kick off ANIMATE_PAGE for
 * every approved-still + clip-needs-regenerating page. Reject if the
 * estimate exceeds the optional `maxUsd` budget cap.
 */
router.post(
  "/projects/:id/animate",
  rateLimit({ name: "studio.animate", max: 30, windowSeconds: 60 }),
  async (req: AuthedRequest, res: Response) => {
    const loaded = await loadOwnedSplitProject(req, res, String(req.params["id"]));
    if (!loaded) return;
    const { projectId, bookId } = loaded;

    const parsed = animateBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid animate payload", details: parsed.error.flatten() });
      return;
    }

    const targets = await listAnimateTargets(bookId);
    if (targets.length === 0) {
      res.json({ projectId, queued: 0, pages: [], message: "Nothing to animate" });
      return;
    }
    const seconds = targets.reduce((sum, t) => sum + pickClipSeconds(t.motionTier), 0);
    const usd = estimateClipCostUsd(seconds);
    if (parsed.data.maxUsd !== undefined && usd > parsed.data.maxUsd) {
      res.status(409).json({
        error: "Estimate exceeds maxUsd",
        estimatedUsd: usd,
        maxUsd: parsed.data.maxUsd,
        pages: targets.length,
        seconds
      });
      return;
    }
    // Move every target's clip to QUEUED first; moveMany returns the
    // pages that actually transitioned (so we only enqueue jobs for
    // those). A page that lost the race (e.g. concurrent regenerate)
    // is skipped.
    const winnerIds = await moveMany("clipStatus", targets.map((t) => t.pageId), "QUEUED");
    const winners = targets.filter((t) => winnerIds.includes(t.pageId));
    const jobIds: string[] = [];
    for (const w of winners) {
      const page = await prisma.page.findUnique({
        where: { id: w.pageId },
        select: { stillVersion: true }
      });
      const jobId = await enqueueAnimateJob({
        projectId,
        pageId: w.pageId,
        stillVersion: page?.stillVersion ?? 0
      } satisfies SplitJobData);
      jobIds.push(jobId);
    }
    res.json({
      projectId,
      queued: winners.length,
      pages: winners.map((w) => w.pageNum),
      estimatedUsd: usd,
      jobIds
    });
  }
);

/**
 * POST /api/studio/projects/:id/clips/approve-all — approve every clip
 * that is currently READY. Bulk action for the post-animation step.
 */
router.post(
  "/projects/:id/clips/approve-all",
  rateLimit({ name: "studio.clipsApproveAll", max: 30, windowSeconds: 60 }),
  async (req: AuthedRequest, res: Response) => {
    const loaded = await loadOwnedSplitProject(req, res, String(req.params["id"]));
    if (!loaded) return;
    const { bookId } = loaded;
    const pages = await prisma.page.findMany({
      where: { bookId, clipStatus: "READY" },
      select: { id: true }
    });
    const winners = await moveMany("clipStatus", pages.map((p) => p.id), "APPROVED");
    // Mirror to legacy `status` so the reader/Studio code that still
    // reads Page.status keeps working.
    if (winners.length > 0) {
      await prisma.page.updateMany({
        where: { id: { in: winners } },
        data: { status: "APPROVED" }
      });
    }
    res.json({ approved: winners.length });
  }
);

export default router;