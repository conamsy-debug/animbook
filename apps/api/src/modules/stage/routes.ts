/**
 * AnimBook STAGE — collaborative storytelling rounds.
 *
 * Multiple vetted creators contribute sections sequentially. The lead sets
 * a brief and opens a round; contributors submit `StageContribution` rows;
 * the lead approves one and the round closes. Approved contributions are
 * appended to the StudioProject's manuscript in order.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";

const router = Router();
router.use(authMiddleware);

router.get("/:projectId", async (req: Request, res: Response) => {
  const projectId = req.params["projectId"];
  if (typeof projectId !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  const rounds = await prisma.stageRound.findMany({
    where: { projectId },
    orderBy: { ordinal: "asc" },
    include: {
      contributions: { orderBy: { createdAt: "asc" } }
    }
  });
  res.json({ items: rounds });
});

const openSchema = z.object({
  ordinal: z.number().int().min(0),
  brief: z.string().min(1).max(2000)
});

router.post("/:projectId/rounds", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const projectId = req.params["projectId"];
  if (typeof projectId !== "string") {
    res.status(400).json({ error: "Missing project id" });
    return;
  }
  const project = await prisma.studioProject.findFirst({ where: { id: projectId } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (project.ownerId !== userId) {
    res.status(403).json({ error: "Only the lead can open rounds" });
    return;
  }
  const parsed = openSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid round payload", details: parsed.error.flatten() });
    return;
  }
  const round = await prisma.stageRound.create({
    data: {
      projectId: project.id,
      leadId: userId,
      ordinal: parsed.data.ordinal,
      brief: parsed.data.brief,
      status: "OPEN"
    }
  });
  res.status(201).json({ round });
});

const contributeSchema = z.object({
  pageNum: z.number().int().min(1),
  textExcerpt: z.string().min(1).max(2000),
  voice: z.string().optional()
});

router.post("/rounds/:roundId/contribute", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const roundId = req.params["roundId"];
  if (typeof roundId !== "string") {
    res.status(400).json({ error: "Missing round id" });
    return;
  }
  const parsed = contributeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid contribution", details: parsed.error.flatten() });
    return;
  }
  const round = await prisma.stageRound.findUnique({ where: { id: roundId } });
  if (!round) {
    res.status(404).json({ error: "Round not found" });
    return;
  }
  if (round.status !== "OPEN") {
    res.status(409).json({ error: "Round is closed" });
    return;
  }
  const contribution = await prisma.stageContribution.create({
    data: {
      roundId: round.id,
      contributorId: userId,
      pageNum: parsed.data.pageNum,
      textExcerpt: parsed.data.textExcerpt,
      voice: parsed.data.voice ?? null
    }
  });
  res.status(201).json({ contribution });
});

const decideSchema = z.object({ contributionId: z.string().min(1), approved: z.boolean() });

router.post("/rounds/:roundId/decide", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const roundId = req.params["roundId"];
  if (typeof roundId !== "string") {
    res.status(400).json({ error: "Missing round id" });
    return;
  }
  const parsed = decideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid decision", details: parsed.error.flatten() });
    return;
  }
  const round = await prisma.stageRound.findUnique({ where: { id: roundId } });
  if (!round) {
    res.status(404).json({ error: "Round not found" });
    return;
  }
  if (round.leadId !== userId) {
    res.status(403).json({ error: "Only the lead can decide" });
    return;
  }
  await prisma.stageContribution.update({
    where: { id: parsed.data.contributionId },
    data: { approved: parsed.data.approved }
  });
  if (parsed.data.approved) {
    const contribution = await prisma.stageContribution.findUnique({ where: { id: parsed.data.contributionId } });
    const project = await prisma.studioProject.findUnique({ where: { id: round.projectId }, select: { bookId: true } });
    if (contribution && project?.bookId) {
      await prisma.page.upsert({
        where: { bookId_pageNum: { bookId: project.bookId, pageNum: contribution.pageNum } },
        create: {
          bookId: project.bookId,
          pageNum: contribution.pageNum,
          chapter: `Stage ${round.ordinal}`,
          textExcerpt: contribution.textExcerpt,
          sourceTextSha256: `stage-${round.id}-${contribution.id}`,
          status: "PENDING"
        },
        update: {
          textExcerpt: contribution.textExcerpt,
          chapter: `Stage ${round.ordinal}`,
          status: "PENDING"
        }
      });
    }
    await prisma.stageRound.update({
      where: { id: round.id },
      data: { status: "CLOSED", closesAt: new Date() }
    });
  }
  res.json({ ok: true });
});

export default router;