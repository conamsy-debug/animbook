/**
 * Manual run of generateNarration on page 1 of the demo book to see
 * whether the audio stage actually emits a non-null audioUrl when
 * called outside the pipeline worker.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { generateNarration, currentTtsProvider, activeTtsProviderLive } from "../src/services/ttsProvider.js";
import { appEnv } from "../src/config/env.js";

const prisma = new PrismaClient();

async function main() {
  console.log(`[manual-audio] provider=${currentTtsProvider()} live=${activeTtsProviderLive()} model=${appEnv.MINIMAX_TTS_MODEL}`);
  const page = await prisma.page.findFirst({
    where: { bookId: "cmvb7dxzs00017kukbsf9sxcx", pageNum: 1 }
  });
  if (!page) {
    console.error("[manual-audio] page 1 not found");
    process.exit(1);
  }
  console.log(`[manual-audio] page 1 textLen=${page.textExcerpt.length} audioUrl=${page.audioUrl}`);

  const storageKey = `narration/cmvb7dyr200037kukmly9g58s/p${page.pageNum}-manual-${Date.now().toString(36)}.mp3`;
  const result = await generateNarration({
    text: page.textExcerpt,
    voiceId: "English_expressive_narrator",
    storageKey,
    strict: true
  });
  console.log("[manual-audio] result:", JSON.stringify({
    audioUrl: result.audioUrl,
    vttUrl: result.vttUrl,
    durationSeconds: result.durationSeconds,
    characters: result.characters,
    source: result.source,
    error: result.error
  }, null, 2));
}

main().catch((e) => {
  console.error("[manual-audio] err:", e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});