/**
 * Queue a book's shots for rendering.
 *
 *   npx tsx apps/api/scripts/render-book-shots.ts <slug> [--dry-run]
 *
 * The video provider credentials live on the API server, not on a laptop, so
 * the clips are rendered by the server's Bull worker: this script puts the
 * page on the split-pipeline queue exactly the way the Studio UI does, and
 * the worker generates the first-frame stills (with the character's reference
 * image attached) and the clips.
 *
 * It only touches books that already have PLANNED shots, so it can never
 * start generating video for a book that was not put on the shot path.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import IORedis from "ioredis";
import { Queue } from "bullmq";

/**
 * Point at the DIRECT Neon endpoint before the Prisma client is created.
 *
 * The pooled endpoint is intermittently unreachable from a laptop, and this
 * script runs over a long-distance link. Prisma's 5s connect timeout is tuned
 * for a server next to the database, so it is lengthened too.
 */
function prepareDatabaseUrl(): void {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  let raw = process.env.DATABASE_URL;
  try {
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*#/.test(line) || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const key = line.slice(0, i).trim();
      if (key !== "DATABASE_URL") continue;
      let value = line.slice(i + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      raw = value;
      break;
    }
  } catch {
    /* fall back to the environment */
  }
  if (!raw) return;
  try {
    const url = new URL(raw.replace("-pooler.", "."));
    if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "30");
    if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "60");
    if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "5");
    process.env.DATABASE_URL = url.toString();
    console.log(`[render] database host: ${url.host}`);
  } catch {
    /* unparseable - leave it for Prisma to report */
  }
}

/** Read REDIS_URL out of the API's .env without printing it. */
function readRedisUrl(): string {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.includes("=")) continue;
    const i = line.indexOf("=");
    if (line.slice(0, i).trim() !== "REDIS_URL") continue;
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  throw new Error("REDIS_URL is not set in apps/api/.env");
}

prepareDatabaseUrl();

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");

if (!slug) {
  console.error("usage: npx tsx apps/api/scripts/render-book-shots.ts <slug> [--dry-run]");
  process.exit(2);
}

const { prisma } = await import("../src/db.js");

const SPLIT_QUEUE_NAME = "animbook-split-pipeline";
const connection = new IORedis(readRedisUrl(), {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});
const queue = new Queue(SPLIT_QUEUE_NAME, { connection });

try {
  const book = await prisma.book.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      splitPipeline: true,
      pages: {
        orderBy: { pageNum: "asc" },
        select: {
          id: true,
          pageNum: true,
          stillStatus: true,
          clipStatus: true,
          stillVersion: true,
          shots: {
            orderBy: { order: "asc" },
            select: { id: true, order: true, status: true, videoUrl: true }
          }
        }
      }
    }
  });
  if (!book) throw new Error(`book "${slug}" not found`);

  console.log(`\n=== ${book.title} (${book.slug}) ===`);
  console.log(`splitPipeline: ${book.splitPipeline}`);

  const pages = book.pages.filter((p) => p.shots.length > 0);
  if (!pages.length) {
    console.log("No pages have shot rows - nothing to render.");
  }

  // The R2 prefix for this book's shots. The book's existing media lives
  // under books/<slug>/, so the clips sit next to it.
  const projectId = `books/${book.slug}`;

  for (const page of pages) {
    const pending = page.shots.filter((s) => s.status !== "READY" || !s.videoUrl);
    console.log(
      `\npage ${page.pageNum}: ${page.shots.length} shot(s), ${pending.length} to render ` +
        `(stillStatus=${page.stillStatus}, clipStatus=${page.clipStatus})`
    );
    if (!pending.length) continue;
    if (dryRun) {
      console.log("  dry run - not queued");
      continue;
    }

    // The clip goes back to QUEUED so the worker's compare-and-set move to
    // GENERATING succeeds.
    if (page.clipStatus !== "QUEUED") {
      await prisma.page.update({
        where: { id: page.id },
        data: { clipStatus: "QUEUED" }
      });
    }

    const job = await queue.add(
      "ANIMATE_PAGE",
      { projectId, pageId: page.id, stillVersion: page.stillVersion },
      {
        jobId: `animate:${page.id}:shots-${Date.now().toString(36)}`,
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 20
      }
    );
    console.log(`  queued job ${job.id}`);
  }

  console.log("\nDone. The server worker renders the clips; poll the DB for status READY.");
} finally {
  await queue.close();
  await connection.quit();
  await prisma.$disconnect();
}
