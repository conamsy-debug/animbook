// Bulk re-animate every FLAGGED page on Practical Physical Immortality.
// Runs inside Railway (DATABASE_URL + REDIS_URL auto-provided) via:
//   railway run -- node scripts/reanimate-pi.mjs
import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const projectId = process.argv[2] ?? "cmu5modam0005pb15hnka8rj7";
const prisma = new PrismaClient();
const conn = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
const queue = new Queue("animbook-pipeline", { connection: conn });

const project = await prisma.studioProject.findUnique({
  where: { id: projectId },
  select: { id: true, bookId: true, name: true }
});
if (!project?.bookId) { console.error("project not found"); process.exit(1); }

const flagged = await prisma.page.findMany({
  where: { bookId: project.bookId, status: "FLAGGED" },
  select: { id: true, pageNum: true },
  orderBy: { pageNum: "asc" }
});
console.log("project:", project.name, "— flagged pages:", flagged.length);

if (flagged.length === 0) {
  await prisma.$disconnect();
  await queue.close();
  await conn.quit();
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
process.exit(0);
