/**
 * Poll the throwaway book (set below) to REVIEW, then run the same
 * checks the runBook + cleanup script would. Standalone companion to
 * throwaway-pipeline-test.ts.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const projectId = process.env["POLL_PROJECT_ID"] ?? "cmvbc10pz00037kzo5n1viwgt";
const bookId = process.env["POLL_BOOK_ID"] ?? "cmvbc10ap00017kzocra51bz6";

async function main() {
  const startedAt = Date.now();
  let last = "";
  while (Date.now() - startedAt < 25 * 60 * 1000) {
    const fresh = await prisma.studioProject.findUnique({
      where: { id: projectId },
      select: { status: true, currentStage: true }
    });
    if (fresh && (fresh.status + "/" + fresh.currentStage) !== last) {
      console.log(`[poll] ${new Date().toISOString()} status=${fresh.status} stage=${fresh.currentStage}`);
      last = fresh.status + "/" + fresh.currentStage;
    }
    if (fresh?.status === "REVIEW") break;
    await new Promise((r) => setTimeout(r, 15_000));
  }

  const pages = await prisma.page.findMany({
    where: { bookId },
    orderBy: { pageNum: "asc" }
  });
  const usage = await prisma.usageEvent.findMany({
    where: { bookId },
    select: { kind: true, provider: true, units: true, totalUsd: true }
  });
  const totalUsd = usage.reduce((s, r) => s + r.totalUsd, 0);
  const animateKicks = usage.filter((u) => u.kind === "ANIMATE_KICK" && u.provider === "MINIMAX_VIDEO");
  const narrationKicks = usage.filter((u) => u.kind === "NARRATION_KICK" && u.provider === "MINIMAX_TTS");

  const result = {
    bookId,
    projectId,
    elapsedSec: Math.round((Date.now() - startedAt) / 1000),
    pages: pages.map((p) => ({
      pageNum: p.pageNum,
      hasVideo: !!p.videoUrl,
      hasPoster: !!p.posterUrl,
      hasAudio: !!p.audioUrl,
      audioStatus: p.audioStatus
    })),
    usageByKind: usage.reduce<Record<string, { count: number; usd: number; provider?: string }>>((acc, u) => {
      if (!acc[u.kind]) acc[u.kind] = { count: 0, usd: 0, provider: u.provider };
      acc[u.kind].count += 1;
      acc[u.kind].usd += u.totalUsd;
      return acc;
    }, {}),
    totalUsd,
    animateKicks: animateKicks.length,
    narrationKicks: narrationKicks.length,
    asserts: {
      videoOnEveryPage: pages.every((p) => !!p.videoUrl),
      audioOnEveryPage: pages.every((p) => !!p.audioUrl && p.audioStatus === "READY"),
      animateKicksPerPage: animateKicks.length === pages.length,
      narrationKicksPerPage: narrationKicks.length === pages.length
    }
  };
  const passed = Object.values(result.asserts).every(Boolean);
  console.log("\n=== POLL RESULT =========================================================");
  console.log(JSON.stringify(result, null, 2));
  console.log("PASS:", passed);
  console.log("======================================================================");

  // Cleanup
  console.log("[poll] cleaning up book " + bookId);
  await prisma.usageEvent.deleteMany({ where: { bookId } });
  await prisma.page.deleteMany({ where: { bookId } });
  await prisma.bookBrain.deleteMany({ where: { bookId } });
  await prisma.studioProject.deleteMany({ where: { bookId } });
  await prisma.book.delete({ where: { id: bookId } });
  console.log("CLEANUP OK");

  if (!passed) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});