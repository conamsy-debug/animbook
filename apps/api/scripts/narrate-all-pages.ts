/**
 * Manually narrate all pages of the demo book through the live
 * generateNarration code path (the same code runAudioStage uses).
 * The pipeline worker did not pick up our runAudioStage job, so this
 * drives the narration directly. No app code change.
 *
 * Pages that already have audioUrl are skipped (matches runAudioStage
 * behaviour). Each successful narration writes the page row update
 * (audioUrl, vttUrl, audioStatus="READY") the same way the live stage
 * does.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { generateNarration, currentTtsProvider } from "../src/services/ttsProvider.js";

const prisma = new PrismaClient();

async function main() {
  const bookId = "cmvb7dxzs00017kukbsf9sxcx";
  const projectId = "cmvb7dyr200037kukmly9g58s";

  const pages = await prisma.page.findMany({
    where: { bookId },
    orderBy: { pageNum: "asc" }
  });
  console.log(`[narrate-all] provider=${currentTtsProvider()} pages=${pages.length}`);

  let narrated = 0;
  let skipped = 0;
  let failed = 0;
  for (const page of pages) {
    if (page.audioUrl) {
      console.log(`[narrate-all] skip page ${page.pageNum}: has audioUrl`);
      skipped += 1;
      continue;
    }
    try {
      const storageKey = `narration/${projectId}/p${page.pageNum}-${Date.now().toString(36)}.mp3`;
      const result = await generateNarration({
        text: page.textExcerpt,
        voiceId: "English_expressive_narrator",
        storageKey,
        strict: true
      });
      if (!result.audioUrl) {
        console.warn(`[narrate-all] FAIL page ${page.pageNum}: ${result.error}`);
        await prisma.page.update({
          where: { id: page.id },
          data: { audioStatus: "FAILED" }
        }).catch(() => {});
        failed += 1;
        continue;
      }
      const updateData: { audioUrl: string; vttUrl?: string | null; audioStatus: "READY" } = {
        audioUrl: result.audioUrl,
        audioStatus: "READY"
      };
      if (result.vttUrl) updateData.vttUrl = result.vttUrl;
      await prisma.page.update({
        where: { id: page.id },
        data: updateData
      });
      console.log(`[narrate-all] OK page ${page.pageNum}: chars=${result.characters} dur=${result.durationSeconds}s audioUrl=${result.audioUrl}`);
      narrated += 1;
    } catch (err) {
      console.warn(`[narrate-all] THROW page ${page.pageNum}: ${(err as Error).message}`);
      await prisma.page.update({
        where: { id: page.id },
        data: { audioStatus: "FAILED" }
      }).catch(() => {});
      failed += 1;
    }
  }

  console.log(`[narrate-all] done. narrated=${narrated} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => {
  console.error("[narrate-all] err:", e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});