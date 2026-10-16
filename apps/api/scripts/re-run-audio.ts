/**
 * Re-run the audio stage for the demo book project. When runGeneration
 * returns and status is REVIEW, audio sometimes lags — this script just
 * re-fires the audio pass to bring all pages to READY.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { enqueuePipeline } from "../src/services/pipeline.js";

const prisma = new PrismaClient();

async function main() {
  const projectId = process.env["PROBE_PROJECT_ID"] ?? "cmvb7dyr200037kukmly9g58s";

  console.log(`[re-audio] enqueueing AUDIO_PRODUCTION for project ${projectId}`);
  const jobId = await enqueuePipeline({
    projectId,
    triggerStage: "AUDIO_PRODUCTION",
    mode: "full"
  });
  console.log(`[re-audio] jobId=${jobId}`);
}

main()
  .catch((e) => {
    console.error("[re-audio] fail:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });