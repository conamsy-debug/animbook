// Resume the queue (it was paused by pause-and-drain.mjs) and re-queue
// every FLAGGED page on the Practical Physical Immortality project.
// Run via:  railway run -- node scripts/requeue-failed.mjs
import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const projectId = process.argv[2] ?? "cmu5modam0005pb15hnka8rj7";
const prisma = new PrismaClient();
const conn = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
const queue = new Queue("animbook-pipeline", { connection: conn });

await queue.resume();
console.log("queue resumed");

const project = await prisma.studioProject.findUnique({
  where: { id: projectId },
  select: { id: true, bookId: true, name: true }
});
if (!project?.bookId) { console.error("project not found"); process.exit(1); }

const flagged = await prisma.page.findMany({
  where: { bookId: project.bookId, status: "FLAGGED" },
  select: { id: true, pageNum: true, regenerationCount: true },
  orderBy: { pageNum: "asc" }
});
console.log("project:", project.name, "— flagged pages:", flagged.length);
console.log("regenCounts:", [...new Set(flagged.map(p => p.regenerationCount))].sort());
if (flagged.length === 0) {
  await queue.close();
  await conn.quit();
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.page.updateMany({
  where: { id: { in: flagged.map(p => p.id) } },
  data: { status: "REGENERATING", regenerationCount: { increment: 1 } }
});

let queued = 0;
for (const p of flagged) {
  const job = await queue.add(
    "pipeline",
    { projectId: project.id, triggerStage: "VIDEO_GENERATION", pageId: p.id },
    { removeOnComplete: 50, removeOnFail: 50, attempts: 1 }
  );
  if (job.id) queued++;
}
console.log("queued:", queued, "jobs");

await prisma.$disconnect();
await queue.close();
await conn.quit();
