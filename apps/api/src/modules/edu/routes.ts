import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { CURRICULUM_FRAMEWORKS, type CurriculumFramework, type TeacherDashboardSummary } from "../../domain/index.js";
import { generateCheckpoint, type CheckpointCandidate } from "../../services/checkpointGenerator.js";
import { calibrateDifficulty } from "../../services/difficultyCalibration.js";
import { getMisconceptions } from "../../services/misconceptionDatabase.js";
import { mapCurriculum, mapAllFrameworks } from "../../services/curriculumMapping.js";

const router = Router();
router.use(authMiddleware);

router.get("/checkpoints/:pageId", async (req: AuthedRequest, res: Response) => {
  const pageId = req.params["pageId"];
  if (typeof pageId !== "string") {
    res.status(400).json({ error: "Missing page id" });
    return;
  }
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: { book: true, checkpoints: true }
  });
  if (!page) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  if (page.checkpoints.length > 0) {
    const existing = page.checkpoints[0]!;
    res.json({
      checkpoint: existing,
      difficulty: calibrateDifficulty({
        text: page.textExcerpt,
        sceneType: page.sceneType,
        cameraAngle: page.cameraAngle,
        emotionalRegister: page.emotionalRegister,
        vertical: page.book.vertical
      }),
      misconceptions: getMisconceptions(inferSceneKey(page.sceneType, page.textExcerpt))
    });
    return;
  }
  const candidate = await generateCheckpoint({
    pageNum: page.pageNum,
    text: page.textExcerpt,
    sceneType: page.sceneType,
    emotionalRegister: page.emotionalRegister,
    cameraAngle: page.cameraAngle,
    vertical: page.book.vertical,
    chapter: page.chapter,
    framework: "KENYA_CBC"
  });
  const stored = await prisma.checkpoint.create({
    data: {
      pageId: page.id,
      question: candidate.question,
      options: candidate.options,
      correctIndex: candidate.correctIndex,
      explanation: candidate.explanation,
      questionType: candidate.questionType,
      curriculumTags: candidate.curriculumTags,
      misconceptionTargets: candidate.misconceptionTargets
    }
  });
  res.json({
    checkpoint: { ...stored, difficultyScore: candidate.difficultyScore },
    difficulty: calibrateDifficulty({
      text: page.textExcerpt,
      sceneType: page.sceneType,
      cameraAngle: page.cameraAngle,
      emotionalRegister: page.emotionalRegister,
      vertical: page.book.vertical
    }),
    misconceptions: getMisconceptions(inferSceneKey(page.sceneType, page.textExcerpt))
  });
});

const respondSchema = z.object({
  selectedIndex: z.number().int().nullable().optional(),
  responseText: z.string().nullable().optional(),
  timeTakenSeconds: z.number().int().min(0)
});

router.post("/checkpoints/:id/respond", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing checkpoint id" });
    return;
  }
  const parsed = respondSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid response", details: parsed.error.flatten() });
    return;
  }
  const checkpoint = await prisma.checkpoint.findUnique({ where: { id } });
  if (!checkpoint) {
    res.status(404).json({ error: "Checkpoint not found" });
    return;
  }
  const isCorrect = scoreCheckpoint(checkpoint, parsed.data);
  const stored = await prisma.checkpointResponse.create({
    data: {
      userId,
      checkpointId: checkpoint.id,
      selectedIndex: parsed.data.selectedIndex ?? null,
      responseText: parsed.data.responseText ?? null,
      isCorrect,
      timeTakenSeconds: parsed.data.timeTakenSeconds
    }
  });
  res.json({
    response: stored,
    isCorrect,
    explanation: checkpoint.explanation,
    correctIndex: checkpoint.correctIndex,
    correctText: checkpoint.correctText
  });
});

function scoreCheckpoint(
  checkpoint: { correctIndex: number | null; questionType: string },
  response: { selectedIndex?: number | null; responseText?: string | null }
): boolean {
  if (checkpoint.questionType === "short_answer" || checkpoint.questionType === "translate_and_type") {
    if (!response.responseText) return false;
    return response.responseText.trim().length >= 3;
  }
  if (checkpoint.correctIndex === null) return false;
  return response.selectedIndex === checkpoint.correctIndex;
}

function inferSceneKey(sceneType: string | null, text: string): string {
  const lower = (sceneType ?? "").toLowerCase();
  if (/mitosis|cell|replicat|chromosom|dna/i.test(lower + " " + text)) return "mitosis";
  if (/equat|formula|solve|calcul/i.test(text)) return "equation";
  if (/translat|swahili|french|spanish|chinese|arabic/i.test(lower + " " + text)) return "language";
  if (/diagram|anatomy|labell|figure/i.test(lower + " " + text)) return "diagram";
  if (/vocab|termin/i.test(text)) return "vocabulary";
  return "narrative";
}

router.get("/teacher/dashboard", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const slugParam = typeof req.query["bookSlug"] === "string" ? req.query["bookSlug"] : null;
  const book = await prisma.book.findFirst({
    where: slugParam
      ? { OR: [{ id: slugParam }, { slug: slugParam }], vertical: "EDU" }
      : { vertical: "EDU" },
    include: { pages: { include: { checkpoints: { include: { responses: true } } } } }
  });
  if (!book) {
    res.status(404).json({ error: "No EDU book selected" });
    return;
  }
  const institutions = await prisma.institution.findMany({ where: { adminUserId: userId }, select: { id: true, name: true, seatCount: true } });
  const allResponses = await prisma.checkpointResponse.findMany({
    where: { checkpoint: { page: { bookId: book.id } } },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { user: { select: { name: true, id: true } }, checkpoint: { select: { questionType: true, page: { select: { pageNum: true } } } } }
  });

  const allResponsesFlat = book.pages.flatMap((p) => p.checkpoints.flatMap((c) => c.responses));
  const totalAttempts = allResponsesFlat.length;
  const correctAttempts = allResponsesFlat.filter((r) => r.isCorrect).length;
  const uniqueStudents = new Set(allResponsesFlat.map((r) => r.userId));
  const totalPages = book.pages.length;
  const studentProgressMap = new Map<string, { lastPage: number; correct: number; total: number }>();
  for (const response of allResponsesFlat) {
    const entry = studentProgressMap.get(response.userId) ?? { lastPage: 0, correct: 0, total: 0 };
    entry.total += 1;
    if (response.isCorrect) entry.correct += 1;
    studentProgressMap.set(response.userId, entry);
  }
  const averageProgress = studentProgressMap.size === 0
    ? 0
    : Math.round(
        ([...studentProgressMap.values()].reduce((sum, v) => sum + (v.lastPage || 0), 0) / studentProgressMap.size / Math.max(1, totalPages)) * 100
      );

  const flaggedPages = book.pages
    .map((page) => {
      const responses = page.checkpoints.flatMap((c) => c.responses);
      const correct = responses.filter((r) => r.isCorrect).length;
      const accuracy = responses.length === 0 ? 1 : correct / responses.length;
      return { pageNum: page.pageNum, accuracy, attempts: responses.length };
    })
    .filter((p) => p.attempts > 0 && p.accuracy < 0.6)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 5);

  const summary: TeacherDashboardSummary = {
    bookId: book.id,
    bookSlug: book.slug,
    bookTitle: book.title,
    totalPages: book.pages.length,
    classSize: institutions.reduce((sum, inst) => sum + inst.seatCount, 0) || studentProgressMap.size,
    activeStudents: uniqueStudents.size,
    averageProgress,
    averageAccuracy: totalAttempts === 0 ? 0 : Math.round((correctAttempts / totalAttempts) * 100),
    flaggedPages,
    recentResponses: allResponses.map((r) => ({
      studentId: r.user.id,
      studentName: r.user.name,
      pageNum: r.checkpoint.page.pageNum,
      questionType: r.checkpoint.questionType as TeacherDashboardSummary["recentResponses"][number]["questionType"],
      isCorrect: r.isCorrect,
      timeTakenSeconds: r.timeTakenSeconds,
      at: r.createdAt.toISOString()
    }))
  };
  res.json({ summary, institutions, frameworks: CURRICULUM_FRAMEWORKS });
});

router.get("/teacher/students", async (_req: AuthedRequest, res: Response) => {
  const responses = await prisma.checkpointResponse.groupBy({
    by: ["userId"],
    _count: { _all: true },
    _avg: { timeTakenSeconds: true }
  });
  const users = await prisma.user.findMany({
    where: { id: { in: responses.map((r) => r.userId) } },
    select: { id: true, name: true, email: true }
  });
  const correctCounts = await prisma.checkpointResponse.groupBy({
    by: ["userId"],
    where: { isCorrect: true },
    _count: { _all: true }
  });
  const correctMap = new Map(correctCounts.map((c) => [c.userId, c._count._all]));
  res.json({
    students: users.map((u) => {
      const r = responses.find((x) => x.userId === u.id);
      const total = r?._count._all ?? 0;
      const correct = correctMap.get(u.id) ?? 0;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        attempts: total,
        accuracy: total === 0 ? 0 : Math.round((correct / total) * 100),
        avgTimeSeconds: r && r._avg.timeTakenSeconds ? Math.round(r._avg.timeTakenSeconds) : 0
      };
    })
  });
});

router.get("/curriculum/map/:bookId", async (req: AuthedRequest, res: Response) => {
  const bookId = req.params["bookId"];
  if (typeof bookId !== "string") {
    res.status(400).json({ error: "Missing book id" });
    return;
  }
  const book = await prisma.book.findFirst({
    where: { OR: [{ id: bookId }, { slug: bookId }] },
    include: { pages: true }
  });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const framework = (typeof req.query["framework"] === "string" ? req.query["framework"] : "KENYA_CBC") as CurriculumFramework;
  const mapping = framework === undefined || framework === ("ALL" as CurriculumFramework)
    ? await mapAllFrameworks(
        book.title,
        book.pages.map((p) => ({ pageNum: p.pageNum, text: p.textExcerpt, chapter: p.chapter, sceneType: p.sceneType }))
      )
    : await mapCurriculum({
        framework,
        bookTitle: book.title,
        pages: book.pages.map((p) => ({ pageNum: p.pageNum, text: p.textExcerpt, chapter: p.chapter, sceneType: p.sceneType }))
      });
  const totalPages = book.pages.length;
  const coverageByStandard = mapping.map((entry) => ({
    ...entry,
    coveragePct: Math.round((entry.pageNums.length / Math.max(1, totalPages)) * 100)
  }));
  const gaps: { standardCode: string; reason: string }[] = [];
  for (let i = 1; i <= totalPages; i++) {
    const covered = coverageByStandard.some((entry) => entry.pageNums.includes(i));
    if (!covered) gaps.push({ standardCode: `Untagged page ${i}`, reason: "No matching curriculum standard" });
  }
  res.json({ framework, totalPages, mapping: coverageByStandard, gaps, frameworks: CURRICULUM_FRAMEWORKS });
});

router.post("/classroom/projection", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const schema = z.object({
    bookSlug: z.string().min(1),
    pageNum: z.number().int().min(1),
    sessionToken: z.string().min(8)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid projection request", details: parsed.error.flatten() });
    return;
  }
  const institution = await prisma.institution.findFirst({ where: { adminUserId: userId } });
  if (!institution) {
    res.status(403).json({ error: "Only institution admins can drive classroom projection" });
    return;
  }
  res.json({
    session: parsed.data.sessionToken,
    bookSlug: parsed.data.bookSlug,
    pageNum: parsed.data.pageNum,
    institution: institution.id,
    startedAt: new Date().toISOString()
  });
});

export default router;