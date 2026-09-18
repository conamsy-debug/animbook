// Pause the queue and remove every queued/waiting/delayed job so the
// pipeline stops wasting Runway credits on bad-shape requests.
// Run via:  railway run -- node scripts/pause-and-drain.mjs
import { Queue } from "bullmq";
import IORedis from "ioredis";

const conn = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
const q = new Queue("animbook-pipeline", { connection: conn });

await q.pause();
console.log("queue paused");

const beforeCounts = await q.getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused");
console.log("counts BEFORE drain:", JSON.stringify(beforeCounts));

// Pull every waiting + delayed job and remove them.
const all = await q.getJobs(["waiting", "delayed", "paused"], 0, 500);
let removed = 0;
for (const j of all) {
  await j.remove();
  removed++;
}
console.log("removed:", removed, "queued/delayed/paused jobs");

const afterCounts = await q.getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused");
console.log("counts AFTER drain:", JSON.stringify(afterCounts));

await q.close();
await conn.quit();
