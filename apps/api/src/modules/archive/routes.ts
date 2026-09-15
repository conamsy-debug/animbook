/**
 * AnimBook ARCHIVE — oral history + cultural sensitivity pipeline.
 *
 * Per Constraint #4, EDU and FAITH content requires human expert review.
 * Archive projects go further: every project carries (a) the consent records
 * of the people whose stories it tells, and (b) explicit cultural notes
 * about iconography, voice, and naming. AnimBook Studio won't publish an
 * archive project without at least one consent record AND at least one
 * cultural note when sensitivityTier is HIGH.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";

const router = Router();
router.use(authMiddleware);

router.get("/projects", async (_req: Request, res: Response) => {
  const projects = await prisma.archiveProject.findMany({
    include: {
      _count: { select: { consents: true, culturalNotes: true } }
    },
    orderBy: { updatedAt: "desc" }
  });
  res.json({ items: projects });
});

const createSchema = z.object({
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, "slug must be kebab-case"),
  title: z.string().min(1),
  steward: z.string().min(1),
  region: z.string().min(1),
  communityContext: z.string().optional(),
  sensitivityTier: z.enum(["LOW", "MEDIUM", "HIGH", "SACRED"]).default("MEDIUM"),
  partnerOrg: z.string().optional(),
  partnerUrl: z.string().url().optional()
});

router.post("/projects", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.roles.includes("archive_steward") && !user?.roles.includes("platform_admin")) {
    res.status(403).json({ error: "Only archive stewards can create projects" });
    return;
  }
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project", details: parsed.error.flatten() });
    return;
  }
  const project = await prisma.archiveProject.create({
    data: {
      slug: parsed.data.slug,
      title: parsed.data.title,
      steward: parsed.data.steward,
      region: parsed.data.region,
      communityContext: parsed.data.communityContext ?? null,
      sensitivityTier: parsed.data.sensitivityTier,
      partnerOrg: parsed.data.partnerOrg ?? null,
      partnerUrl: parsed.data.partnerUrl ?? null,
      status: "DRAFT"
    }
  });
  res.status(201).json(project);
});

router.get("/projects/:slug", async (req: Request, res: Response) => {
  const slug = req.params["slug"];
  if (typeof slug !== "string") {
    res.status(400).json({ error: "Missing slug" });
    return;
  }
  const project = await prisma.archiveProject.findUnique({
    where: { slug },
    include: {
      consents: { orderBy: { grantedAt: "desc" } },
      culturalNotes: { orderBy: { createdAt: "desc" } },
      book: { select: { id: true, slug: true, title: true, totalPages: true, vertical: true } }
    }
  });
  if (!project) {
    res.status(404).json({ error: "Archive project not found" });
    return;
  }
  res.json({ project });
});

const consentSchema = z.object({
  subjectName: z.string().min(1),
  relationship: z.string().min(1),
  consentText: z.string().min(1).max(2000),
  consentMediaUrl: z.string().url().optional(),
  expiresAt: z.string().datetime().optional(),
  scope: z.enum(["PUBLICATION", "VOICE_USE", "IMAGE_USE", "EDUCATIONAL_REUSE"]).default("PUBLICATION")
});

router.post("/projects/:slug/consents", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.roles.includes("archive_steward") && !user?.roles.includes("platform_admin")) {
    res.status(403).json({ error: "Only archive stewards can record consent" });
    return;
  }
  const slug = req.params["slug"];
  if (typeof slug !== "string") {
    res.status(400).json({ error: "Missing slug" });
    return;
  }
  const project = await prisma.archiveProject.findUnique({ where: { slug } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const parsed = consentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid consent", details: parsed.error.flatten() });
    return;
  }
  const consent = await prisma.archiveConsent.create({
    data: {
      projectId: project.id,
      subjectName: parsed.data.subjectName,
      relationship: parsed.data.relationship,
      consentText: parsed.data.consentText,
      consentMediaUrl: parsed.data.consentMediaUrl ?? null,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      scope: parsed.data.scope
    }
  });
  res.status(201).json({ consent });
});

const culturalNoteSchema = z.object({
  category: z.enum(["ICONOGRAPHY", "LANGUAGE", "NAMES", "RITUAL", "PROVENANCE", "VOICE"]),
  note: z.string().min(1).max(2000),
  iconographicConcerns: z.array(z.string()).default([]),
  voiceGuidance: z.string().optional(),
  reviewerName: z.string().optional()
});

router.post("/projects/:slug/cultural-notes", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.roles.includes("archive_steward") && !user?.roles.includes("platform_admin")) {
    res.status(403).json({ error: "Only archive stewards can record cultural notes" });
    return;
  }
  const slug = req.params["slug"];
  if (typeof slug !== "string") {
    res.status(400).json({ error: "Missing slug" });
    return;
  }
  const project = await prisma.archiveProject.findUnique({ where: { slug } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const parsed = culturalNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid cultural note", details: parsed.error.flatten() });
    return;
  }
  const note = await prisma.archiveCulturalNote.create({
    data: {
      projectId: project.id,
      category: parsed.data.category,
      note: parsed.data.note,
      iconographicConcerns: parsed.data.iconographicConcerns,
      voiceGuidance: parsed.data.voiceGuidance ?? null,
      reviewerName: parsed.data.reviewerName ?? null
    }
  });
  res.status(201).json({ note });
});

const publishSchema = z.object({ bookId: z.string().min(1) });

router.post("/projects/:slug/publish", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.roles.includes("archive_steward") && !user?.roles.includes("platform_admin")) {
    res.status(403).json({ error: "Only archive stewards can publish" });
    return;
  }
  const slug = req.params["slug"];
  if (typeof slug !== "string") {
    res.status(400).json({ error: "Missing slug" });
    return;
  }
  const parsed = publishSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid publish payload", details: parsed.error.flatten() });
    return;
  }
  const project = await prisma.archiveProject.findUnique({
    where: { slug },
    include: { _count: { select: { consents: true, culturalNotes: true } } }
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const book = await prisma.book.findFirst({ where: { OR: [{ id: parsed.data.bookId }, { slug: parsed.data.bookId }] } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  if (project._count.consents < 1) {
    res.status(409).json({ error: "At least one consent record is required before publish" });
    return;
  }
  if (project.sensitivityTier === "HIGH" || project.sensitivityTier === "SACRED") {
    if (project._count.culturalNotes < 1) {
      res.status(409).json({ error: "Cultural note is required for HIGH or SACRED tier" });
      return;
    }
  }
  await prisma.archiveProject.update({
    where: { id: project.id },
    data: { bookId: book.id, status: "PUBLISHED" }
  });
  res.json({ ok: true, slug: project.slug });
});

export default router;