/**
 * Poll-only companion to produce-demo-book.ts — when the orchestrator
 * hits the local shell timeout, this re-reads projectId from the
 * PROBE_PROJECT_ID env and just polls status + per-page + cost, then
 * prints the report.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const projectId = process.env["PROBE_PROJECT_ID"] ?? "cmvb7dyr200037kukmly9g58s";
  const bookId = process.env["PROBE_BOOK_ID"] ?? "cmvb7dxzs00017kukbsf9sxcx";

  const startedAt = Date.now();
  const timeoutMs = 60 * 60 * 1000;
  let lastStatus = "";
  let lastStage = "";

  const tick = async () => {
    const fresh = await prisma.studioProject.findUnique({
      where: { id: projectId },
      select: { status: true, currentStage: true }
    });
    if (fresh && (fresh.status !== lastStatus || fresh.currentStage !== lastStage)) {
      console.log(`[poll] ${new Date().toISOString()} status=${fresh.status} stage=${fresh.currentStage}`);
      lastStatus = fresh.status ?? "";
      lastStage = fresh.currentStage ?? "";
    }
    return fresh;
  };

  await tick();

  while (Date.now() - startedAt < timeoutMs) {
    const fresh = await tick();
    if (fresh?.status === "REVIEW") break;
    await new Promise((r) => setTimeout(r, 30_000));
  }
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);

  const pages = await prisma.page.findMany({
    where: { bookId },
    orderBy: { pageNum: "asc" },
    select: {
      pageNum: true,
      status: true,
      videoUrl: true,
      posterUrl: true,
      audioUrl: true,
      vttUrl: true,
      audioStatus: true,
      qualityScore: true
    }
  });

  const usageRows = await prisma.usageEvent.findMany({
    where: { bookId },
    select: { provider: true, kind: true, units: true, totalUsd: true }
  });
  const totalUsd = usageRows.reduce((s, r) => s + r.totalUsd, 0);
  const byProvider: Record<string, { events: number; totalUsd: number }> = {};
  for (const r of usageRows) {
    if (!byProvider[r.provider]) byProvider[r.provider] = { events: 0, totalUsd: 0 };
    byProvider[r.provider].events += 1;
    byProvider[r.provider].totalUsd += r.totalUsd;
  }

  const failures = pages
    .filter((p) => p.status === "FLAGGED" || (p.audioStatus && p.audioStatus !== "READY" && p.audioStatus !== "NONE"))
    .map((p) => ({ pageNum: p.pageNum, pageStatus: p.status, audioStatus: p.audioStatus }));

  const report = {
    projectId,
    bookId,
    pollElapsedSec: elapsedSec,
    pipelineStatus: lastStatus,
    pipelineStage: lastStage,
    pages: pages.map((p) => ({
      pageNum: p.pageNum,
      status: p.status,
      videoUrl: p.videoUrl,
      posterUrl: p.posterUrl,
      audioUrl: p.audioUrl,
      vttUrl: p.vttUrl,
      audioStatus: p.audioStatus,
      qualityScore: p.qualityScore
    })),
    costByProvider: byProvider,
    totalCostUsd: totalUsd,
    failures
  };
  console.log("--- final report ----------------------------------------------------------");
  console.log(JSON.stringify(report, null, 2));
  console.log("-----------------------------------------------------------------------------");
}

main().catch((e) => {
  console.error("poll failed:", e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});