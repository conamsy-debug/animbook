/**
 * Release schedule — how a book reaches its readers.
 *
 * Three modes:
 *  - IMMEDIATE: every page is live the moment the book is published.
 *  - TIME:      pages drip on a calendar cadence the author picked.
 *  - TASK:      a reader unlocks the next chunk by submitting any text as
 *               today's reflection on the chunk the author wrote.
 *
 * Chunks are computed at publish time and stored in `book_chunks`. For TIME
 * books the server ticks `released_at` lazily on first read — no cron.
 * For TASK books the unlock is per-reader, recorded in `book_task_submissions`.
 *
 * "Generous" latecomers: a reader who arrives on day 30 of a daily drip sees
 * every chunk whose scheduledFor has passed (i.e. everything up to today).
 */

import type { Book, BookChunk } from "@prisma/client";
import { prisma } from "../db.js";

export type ReleaseMode = "IMMEDIATE" | "TIME" | "TASK";
export type ReleaseCadence = "DAILY" | "WEEKLY" | "MONTHLY";

export const CHUNK_PERCENT_OPTIONS = [10, 25] as const;
export type ChunkPercent = (typeof CHUNK_PERCENT_OPTIONS)[number];

export interface ScheduleInput {
  mode: ReleaseMode;
  cadence?: ReleaseCadence;
  chunkPercent?: ChunkPercent;
  startAt?: Date | null;
  dailyTaskPrompt?: string;
}

interface ChunkPlan {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  scheduledFor: Date;
}

const MS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000 // calendar-month approximation; we round to a day boundary at apply time
};

function cadenceMs(cadence: ReleaseCadence): number {
  switch (cadence) {
    case "DAILY":
      return MS.day;
    case "WEEKLY":
      return MS.week;
    case "MONTHLY":
      return MS.month;
  }
}

/**
 * Compute the chunk plan for a book of `totalPages` pages. Always returns at
 * least one chunk (even if totalPages is 0). The last chunk may be smaller
 * than the rest, never bigger.
 */
export function computeChunks(input: {
  totalPages: number;
  chunkPercent: ChunkPercent;
  cadence: ReleaseCadence;
  startAt: Date;
}): ChunkPlan[] {
  const { totalPages, chunkPercent, cadence, startAt } = input;
  if (totalPages <= 0) {
    return [{ chunkIndex: 0, pageStart: 1, pageEnd: 0, scheduledFor: startAt }];
  }
  const rawSize = Math.max(1, Math.ceil((totalPages * chunkPercent) / 100));
  const chunks: ChunkPlan[] = [];
  let page = 1;
  let idx = 0;
  while (page <= totalPages) {
    const pageEnd = Math.min(totalPages, page + rawSize - 1);
    chunks.push({
      chunkIndex: idx,
      pageStart: page,
      pageEnd,
      scheduledFor: new Date(startAt.getTime() + idx * cadenceMs(cadence))
    });
    page = pageEnd + 1;
    idx += 1;
  }
  return chunks;
}

/**
 * Validate a schedule input. Throws with a useful `status` field on failure.
 * `totalPages` is needed so IMMEDIATE / no-page cases are caught early.
 */
export function validateSchedule(input: ScheduleInput, totalPages: number): void {
  if (input.mode === "IMMEDIATE") return;
  if (!input.cadence) throw Object.assign(new Error("Cadence is required for a dripped release"), { status: 400 });
  if (!input.chunkPercent || !CHUNK_PERCENT_OPTIONS.includes(input.chunkPercent)) {
    throw Object.assign(new Error("Chunk percentage must be 10 or 25"), { status: 400 });
  }
  if (input.startAt && input.startAt.getTime() < Date.now() - 60_000) {
    throw Object.assign(new Error("Start date must be in the future"), { status: 400 });
  }
  if (totalPages < 1) {
    throw Object.assign(new Error("Add at least one page before scheduling a release"), { status: 400 });
  }
  if (input.mode === "TASK" && (!input.dailyTaskPrompt || input.dailyTaskPrompt.trim().length < 4)) {
    throw Object.assign(new Error("Daily task prompt is required for task-dripped release"), { status: 400 });
  }
}

/**
 * Persist the schedule for a book and write out the chunk rows. Idempotent
 * in the sense that re-running replaces chunks and resets `released_at`, but
 * the studio never calls this once the schedule is locked.
 */
export async function applySchedule(bookId: string, input: ScheduleInput): Promise<void> {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { id: true, status: true, totalPages: true, releaseScheduleLockedAt: true }
  });
  if (!book) throw Object.assign(new Error("Book not found"), { status: 404 });
  if (book.releaseScheduleLockedAt) {
    throw Object.assign(new Error("The release schedule is locked. Archive and re-publish to change it."), {
      status: 409
    });
  }
  validateSchedule(input, book.totalPages);

  // Reset existing chunks and tasks — author is editing before locking.
  await prisma.bookChunk.deleteMany({ where: { bookId } });
  await prisma.bookDailyTask.deleteMany({ where: { bookId } });

  if (input.mode === "IMMEDIATE") {
    await prisma.book.update({
      where: { id: bookId },
      data: {
        releaseMode: "IMMEDIATE",
        releaseCadence: null,
        releaseChunkPercent: null,
        releaseStartAt: null
      }
    });
    return;
  }

  const startAt = input.startAt ?? new Date();
  const plans = computeChunks({
    totalPages: book.totalPages,
    chunkPercent: input.chunkPercent!,
    cadence: input.cadence!,
    startAt
  });

  await prisma.$transaction([
    prisma.book.update({
      where: { id: bookId },
      data: {
        releaseMode: input.mode,
        releaseCadence: input.cadence!,
        releaseChunkPercent: input.chunkPercent!,
        releaseStartAt: startAt
      }
    }),
    prisma.bookChunk.createMany({
      data: plans.map((p) => ({
        bookId,
        chunkIndex: p.chunkIndex,
        pageStart: p.pageStart,
        pageEnd: p.pageEnd,
        scheduledFor: p.scheduledFor,
        // TIME books: chunk 0 is live immediately (so a reader who opens on
        // day 0 sees something); chunk 1+ waits. TASK books: chunk 0 is
        // released too — the daily task unlocks chunk 1 onward.
        releasedAt: p.chunkIndex === 0 ? startAt : null
      }))
    })
  ]);

  if (input.mode === "TASK" && input.dailyTaskPrompt) {
    // The first daily task gates chunk 1. The author can write more in the
    // Studio if they want — for now chunk 0 starts unlocked and chunk 1+ are
    // gated by sequential submissions. (One task per chunk is enough for v1;
    // authors wanting per-day prompts can re-publish after writing more.)
    await prisma.bookDailyTask.create({
      data: { bookId, chunkIndex: 1, prompt: input.dailyTaskPrompt.trim() }
    });
  }
}

/**
 * Lock the schedule. Called when the author hits "publish" on a dripped book.
 * After this, `applySchedule` rejects further edits.
 */
export async function lockSchedule(bookId: string): Promise<void> {
  await prisma.book.update({
    where: { id: bookId },
    data: { releaseScheduleLockedAt: new Date() }
  });
}

/**
 * The number of chunks that are live GLOBALLY for a TIME book right now,
 * regardless of who is asking. Lazy — flips `released_at` on any chunk
 * whose `scheduledFor` has passed. Safe to call from the read path.
 */
export async function tickTimeReleases(bookId: string): Promise<number> {
  const now = new Date();
  const result = await prisma.bookChunk.updateMany({
    where: { bookId, releasedAt: null, scheduledFor: { lte: now } },
    data: { releasedAt: now }
  });
  return result.count;
}

/**
 * For a TASK book: how many chunks this reader has unlocked. A reader unlocks
 * chunk N when they have a submission for chunk N-1.
 */
export async function readerUnlockedChunkCount(bookId: string, userId: string): Promise<number> {
  const submissions = await prisma.bookTaskSubmission.findMany({
    where: { bookId, userId },
    select: { chunkIndex: true },
    orderBy: { chunkIndex: "asc" }
  });
  // Sequential unlock — submissions for chunk 5 don't unlock chunk 3.
  let unlocked = 1; // chunk 0 is always free
  for (const s of submissions) {
    if (s.chunkIndex === unlocked) unlocked += 1;
    else if (s.chunkIndex < unlocked) continue;
    else break;
  }
  return unlocked;
}

export interface ReleaseInfo {
  mode: ReleaseMode;
  cadence: ReleaseCadence | null;
  chunkPercent: number | null;
  startAt: string | null;
  totalChunks: number;
  releasedChunks: number;
  nextChunkAt: string | null;
  /// Index of the next chunk the caller can read. Total - this = how many
  /// pages are still hidden from them.
  myUnlockedChunk: number;
  /// The prompt the author wrote for the next chunk (TASK books only).
  dailyTaskPrompt: string | null;
  scheduleLocked: boolean;
}

/**
 * The single read-side answer for "what can I see right now?". Computes the
 * caller's effective unlock state and returns enough info for the UI to
 * render the next-drop banner.
 */
export async function getReleaseInfo(bookId: string, viewerId: string | null): Promise<ReleaseInfo | null> {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { releaseMode: true, releaseCadence: true, releaseChunkPercent: true, releaseStartAt: true, releaseScheduleLockedAt: true }
  });
  if (!book) return null;
  const mode: ReleaseMode = (book.releaseMode as ReleaseMode | null) ?? "IMMEDIATE";
  if (mode === "IMMEDIATE") {
    return {
      mode,
      cadence: null,
      chunkPercent: null,
      startAt: null,
      totalChunks: 1,
      releasedChunks: 1,
      nextChunkAt: null,
      myUnlockedChunk: 1,
      dailyTaskPrompt: null,
      scheduleLocked: Boolean(book.releaseScheduleLockedAt)
    };
  }

  const chunks = await prisma.bookChunk.findMany({
    where: { bookId },
    orderBy: { chunkIndex: "asc" }
  });
  if (mode === "TIME") {
    // Lazy tick before we count.
    await tickTimeReleases(bookId);
  }
  const refreshed = await prisma.bookChunk.findMany({
    where: { bookId },
    orderBy: { chunkIndex: "asc" }
  });
  const totalChunks = refreshed.length;
  const releasedChunks = refreshed.filter((c) => c.releasedAt !== null).length;
  const nextChunk = refreshed.find((c) => c.releasedAt === null);

  let myUnlockedChunk = 1;
  let dailyTaskPrompt: string | null = null;
  if (mode === "TASK" && viewerId) {
    myUnlockedChunk = await readerUnlockedChunkCount(bookId, viewerId);
    // The next chunk the reader needs to unlock is `myUnlockedChunk`.
    if (myUnlockedChunk < totalChunks) {
      const task = await prisma.bookDailyTask.findUnique({
        where: { bookId_chunkIndex: { bookId, chunkIndex: myUnlockedChunk } }
      });
      dailyTaskPrompt = task?.prompt ?? null;
    }
  }

  return {
    mode,
    cadence: book.releaseCadence as ReleaseCadence | null,
    chunkPercent: book.releaseChunkPercent,
    startAt: book.releaseStartAt ? book.releaseStartAt.toISOString() : null,
    totalChunks,
    releasedChunks,
    nextChunkAt: nextChunk?.scheduledFor.toISOString() ?? null,
    myUnlockedChunk,
    dailyTaskPrompt,
    scheduleLocked: Boolean(book.releaseScheduleLockedAt)
  };
}

/**
 * Resolve the highest page number the caller may read right now. For IMMEDIATE
 * books this is `book.totalPages`. For TIME books it's the pageEnd of the
 * last chunk with `released_at != null`. For TASK books it's the pageEnd of
 * `readerUnlockedChunkCount` minus 1.
 */
export async function maxReadablePage(bookId: string, viewerId: string | null): Promise<number> {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { totalPages: true, releaseMode: true }
  });
  if (!book) return 0;
  const mode: ReleaseMode = (book.releaseMode as ReleaseMode | null) ?? "IMMEDIATE";
  if (mode === "IMMEDIATE") return book.totalPages;

  if (mode === "TIME") {
    await tickTimeReleases(bookId);
    const last = await prisma.bookChunk.findFirst({
      where: { bookId, releasedAt: { not: null } },
      orderBy: { chunkIndex: "desc" }
    });
    return last?.pageEnd ?? 0;
  }

  // TASK
  if (!viewerId) return 0;
  const unlocked = await readerUnlockedChunkCount(bookId, viewerId);
  if (unlocked < 1) return 0;
  const chunk = await prisma.bookChunk.findUnique({
    where: { bookId_chunkIndex: { bookId, chunkIndex: unlocked - 1 } }
  });
  return chunk?.pageEnd ?? 0;
}
