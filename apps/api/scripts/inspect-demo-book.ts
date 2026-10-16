/**
 * Diagnostic companion to produce-demo-book.ts. After the pipeline
 * reports REVIEW, dig into why audio is NONE and no usage_events
 * were written.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const projectId = "cmvb7dyr200037kukmly9g58s";
  const bookId = "cmvb7dxzs00017kukbsf9sxcx";

  const proj = await prisma.studioProject.findUnique({
    where: { id: projectId },
    select: { status: true, currentStage: true, ownerId: true, bookId: true }
  });
  console.log("project:", proj);

  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { id: true, title: true, totalPages: true, styleId: true, status: true }
  });
  console.log("book:", book);

  const brain = await prisma.bookBrain.findUnique({
    where: { bookId },
    select: { narratorVoiceId: true, styleSelected: true }
  });
  console.log("brain:", brain);

  /* Check GenerationJob rows for this project */
  const jobs = await prisma.generationJob.findMany({
    where: { projectId },
    select: { id: true, stage: true, status: true, errorMessage: true, startedAt: true, completedAt: true }
  });
  console.log("jobs:", jobs);

  /* Check ALL usage_events for this book */
  const usage = await prisma.usageEvent.findMany({
    where: { bookId },
    select: { id: true, kind: true, provider: true, units: true, totalUsd: true, status: true, createdAt: true }
  });
  console.log("usageEvents for this book:", usage);

  /* Check all usage_events (in case the bookId filter is wrong) */
  const allRecent = await prisma.usageEvent.findMany({
    where: { createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, bookId: true, kind: true, provider: true, totalUsd: true, createdAt: true }
  });
  console.log("recent usage_events (last hour):", allRecent.length, "rows");

  /* Check pages in detail */
  const pages = await prisma.page.findMany({
    where: { bookId },
    orderBy: { pageNum: "asc" },
    select: {
      pageNum: true,
      status: true,
      audioStatus: true,
      audioUrl: true,
      videoUrl: true,
      textExcerpt: true
    }
  });
  console.log("pages:", JSON.stringify(pages.map((p) => ({
    n: p.pageNum,
    s: p.status,
    a: p.audioStatus,
    hasAudio: !!p.audioUrl,
    hasVideo: !!p.videoUrl,
    textLen: p.textExcerpt.length
  })), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});