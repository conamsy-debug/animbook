import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";

const router = Router();

const modeSchema = z.object({
  mode: z.enum(["WATCH", "BOTH", "READ"]).optional()
});

router.use(authMiddleware);

router.get("/", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const entries = await prisma.libraryEntry.findMany({
    where: { userId },
    include: {
      book: {
        select: {
          id: true,
          slug: true,
          title: true,
          author: true,
          synopsis: true,
          vertical: true,
          genreTags: true,
          coverUrl: true,
          totalPages: true
        }
      }
    },
    orderBy: { lastRead: "desc" }
  });
  res.json({ items: entries });
});

router.post("/:bookId", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const bookId = req.params["bookId"];
  if (typeof bookId !== "string") {
    res.status(400).json({ error: "Missing book id" });
    return;
  }
  const parsed = modeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid mode", details: parsed.error.flatten() });
    return;
  }
  const book = await prisma.book.findFirst({ where: { OR: [{ id: bookId }, { slug: bookId }] } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const entry = await prisma.libraryEntry.upsert({
    where: { userId_bookId: { userId, bookId: book.id } },
    create: { userId, bookId: book.id, mode: parsed.data.mode ?? "BOTH" },
    update: { mode: parsed.data.mode ?? undefined }
  });
  res.json(entry);
});

router.put("/:bookId/progress", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const bookId = req.params["bookId"];
  if (typeof bookId !== "string") {
    res.status(400).json({ error: "Missing book id" });
    return;
  }
  const schema = z.object({
    progressPage: z.number().int().min(1),
    completed: z.boolean().optional(),
    mode: z.enum(["WATCH", "BOTH", "READ"]).optional(),
    narrationLanguage: z.string().min(2).max(8).optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid progress", details: parsed.error.flatten() });
    return;
  }
  const book = await prisma.book.findFirst({ where: { OR: [{ id: bookId }, { slug: bookId }] } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  if (parsed.data.progressPage > Math.max(1, book.totalPages) && book.totalPages > 0) {
    res.status(400).json({ error: "Progress exceeds book length" });
    return;
  }
  const entry = await prisma.libraryEntry.upsert({
    where: { userId_bookId: { userId, bookId: book.id } },
    create: {
      userId,
      bookId: book.id,
      progressPage: parsed.data.progressPage,
      completed: parsed.data.completed ?? false,
      mode: parsed.data.mode ?? "BOTH",
      narrationLanguage: parsed.data.narrationLanguage ?? book.language
    },
    update: {
      progressPage: parsed.data.progressPage,
      completed: parsed.data.completed ?? undefined,
      mode: parsed.data.mode ?? undefined,
      narrationLanguage: parsed.data.narrationLanguage ?? undefined,
      lastRead: new Date()
    }
  });

  const newAchievements: { code: string; title: string }[] = [];
  try {
    const first = await maybeAwardAchievement(userId, "first_flip");
    if (first) newAchievements.push(first);
    if (parsed.data.progressPage >= Math.max(1, book.totalPages) || parsed.data.completed === true) {
      const completed = await maybeAwardAchievement(userId, "book_completed");
      if (completed) newAchievements.push(completed);
      const recently = await prisma.libraryEntry.count({
        where: {
          userId,
          lastRead: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        }
      });
      if (recently >= 3) {
        const streak = await maybeAwardAchievement(userId, "three_in_seven");
        if (streak) newAchievements.push(streak);
      }
    }
    if (parsed.data.mode === "READ" && book.vertical === "KIDS") {
      const bedtime = await maybeAwardBedtimeStreak(userId);
      if (bedtime) newAchievements.push(bedtime);
    }
  } catch (err) {
    console.warn("[library] achievement award failed:", (err as Error).message);
  }

  res.json({ entry, newAchievements });
});

router.get("/:bookId/progress", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const bookId = req.params["bookId"];
  if (typeof bookId !== "string") {
    res.status(400).json({ error: "Missing book id" });
    return;
  }
  const book = await prisma.book.findFirst({ where: { OR: [{ id: bookId }, { slug: bookId }] }, select: { id: true } });
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  const entry = await prisma.libraryEntry.findUnique({
    where: { userId_bookId: { userId, bookId: book.id } }
  });
  res.json(entry ?? { bookId: book.id, progressPage: 1, completed: false, mode: "BOTH" });
});

async function maybeAwardAchievement(userId: string, code: string): Promise<{ code: string; title: string } | null> {
  const existing = await prisma.achievement.findUnique({ where: { userId_code: { userId, code } } });
  if (existing) return null;
  const title = code === "first_flip" ? "First flip" :
                code === "book_completed" ? "Storyteller" :
                code === "three_in_seven" ? "Reading streak" :
                code === "bedtime_streak" ? "Bedtime ritual" :
                code === "edu_first_checkpoint" ? "Scholar" :
                code;
  const description = code === "first_flip" ? "You flipped your first AnimPage. The world is awake." :
                      code === "book_completed" ? "You read an AnimBook all the way to the end." :
                      code === "three_in_seven" ? "Three AnimBooks in seven days. The medium loves you back." :
                      code === "bedtime_streak" ? "Five bedtime-mode sessions. Sweet dreams, official." :
                      code === "edu_first_checkpoint" ? "You answered your first EDU checkpoint." :
                      "Achievement unlocked.";
  await prisma.achievement.create({
    data: { userId, code, title, description }
  });
  return { code, title };
}

async function maybeAwardBedtimeStreak(userId: string): Promise<{ code: string; title: string } | null> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const bedtimeReads = await prisma.libraryEntry.count({
    where: {
      userId,
      mode: "READ",
      book: { vertical: "KIDS" },
      lastRead: { gte: sevenDaysAgo }
    }
  });
  if (bedtimeReads >= 5) return maybeAwardAchievement(userId, "bedtime_streak");
  return null;
}

export default router;