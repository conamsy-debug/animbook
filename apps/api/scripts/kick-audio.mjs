#!/usr/bin/env node
// Kick audio narration for a project via the same Bull queue the route uses.
// Mirrors POST /api/studio/projects/:id/audio but bypasses HTTP auth (operator only).
//
// The running API service worker on Railway picks up the job and runs
// `runAudioOnly` -> `runAudioStage(projectId)`, which narrates every page
// that has audioUrl=null sequentially via ElevenLabs.
//
// Usage:
//   node apps/api/scripts/kick-audio.mjs <projectId> [--dry-run]
//
// --dry-run:  print what would happen, don't enqueue or mutate
import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const [, , projectIdArg, ...rest] = process.argv;
const dryRun = rest.includes("--dry-run");
if (!projectIdArg) {
  console.error("usage: kick-audio.mjs <projectId> [--dry-run]");
  process.exit(1);
}

const prisma = new PrismaClient();

const project = await prisma.studioProject.findUnique({
  where: { id: projectIdArg },
  select: { id: true, status: true, currentStage: true, bookId: true, book: { select: { id: true, title: true, splitPipeline: true } } },
});
if (!project) {
  console.error(`project ${projectIdArg} not found`);
  process.exit(1);
}
console.log("project:", { id: project.id, status: project.status, currentStage: project.currentStage, book: project.book?.title });

const pagesTotal = await prisma.page.count({ where: { bookId: project.bookId } });
const pagesNeedAudio = await prisma.page.count({ where: { bookId: project.bookId, audioUrl: null } });
const pagesHaveAudio = await prisma.page.count({ where: { bookId: project.bookId, audioUrl: { not: null } } });
console.log(`pages: total=${pagesTotal}, with-audio=${pagesHaveAudio}, need-audio=${pagesNeedAudio}`);

const brain = await prisma.bookBrain.findFirst({
  where: { bookId: project.bookId },
  select: { narratorVoiceId: true },
});
console.log("brain narratorVoiceId:", brain?.narratorVoiceId ?? "(none -> falls through to vertical default)");

if (dryRun) {
  console.log("\n[dry-run] would do:");
  console.log(`  prisma.studioProject.update id=${project.id} status=AUDIO currentStage=AUDIO_PRODUCTION`);
  console.log(`  bullmq.animbook-pipeline.add({ projectId: "${project.id}", triggerStage: "AUDIO_PRODUCTION" })`);
  console.log(`  -> running API worker would narrate ${pagesNeedAudio} pages sequentially`);
  await prisma.$disconnect();
  process.exit(0);
}

console.log("\n[live] updating project + enqueueing...");
await prisma.studioProject.update({
  where: { id: project.id },
  data: { status: "AUDIO", currentStage: "AUDIO_PRODUCTION" },
});
console.log("  project.status -> AUDIO");

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error("REDIS_URL not set in env (apps/api/.env)");
  process.exit(1);
}
const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue("animbook-pipeline", { connection: redis });
const job = await queue.add("pipeline", {
  projectId: project.id,
  triggerStage: "AUDIO_PRODUCTION",
});
console.log("  bull job id:", job.id, "(worker on Railway will pick it up)");

await queue.close();
await redis.quit();
await prisma.$disconnect();
console.log("done.");