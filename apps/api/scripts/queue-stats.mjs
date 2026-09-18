// Quick queue stats — what's waiting, active, completed, failed.
// Run via:  railway run -- node scripts/queue-stats.mjs
import { Queue } from "bullmq";
import IORedis from "ioredis";

const conn = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
const q = new Queue("animbook-pipeline", { connection: conn });

const counts = await q.getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused");
console.log(JSON.stringify(counts, null, 2));

const waiting = await q.getJobs(["waiting", "active"], 0, 8);
for (const j of waiting) {
  console.log(j.id, j.name, "data.triggerStage:", j.data?.triggerStage, "data.pageId:", j.data?.pageId);
}

await q.close();
await conn.quit();
