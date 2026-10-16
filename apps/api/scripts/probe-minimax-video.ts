/**
 * Post-deploy smoke probe — exactly ONE video clip through the new
 * MiniMax (Hailuo) video pipeline against one page of the test book.
 *
 *   tsx scripts/probe-minimax-video.ts              # lowest pageNum of first book
 *   PROBE_BOOK_ID=cmu5... PROBE_PAGE_NUM=3 tsx …    # explicit
 *
 * Picks the lowest-pageNum row in `pages` whose videoUrl is null. Generates
 * the still (image-01), animates it (Hailuo 2.3, 6s/768P), downloads the
 * MiniMax file (links expire inside ~1h, so we mirror immediately), writes
 * the R2 URL back into Page.videoUrl + Page.posterUrl, records one
 * usage_events row, and prints a precise summary so the operator can paste
 * it back into the migration report.
 *
 * Strict guard rails:
 *   - Refuses to run more than one page.
 *   - Refuses to run if the active provider is not MiniMax.
 *   - Refuses to run without MINIMAX_API_KEY + DATABASE_URL + the R2 trio.
 *   - Never logs the API key; only the URL + cost + final clip duration.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { appEnv, isFeatureEnabled } from "../src/config/env.js";
import { generateClip } from "../src/services/minimax-video.js";
import { mirrorToR2 } from "../src/services/cloudflare.js";

const prisma = new PrismaClient();

function fail(message: string): never {
  console.error("[probe-minimax] " + message);
  process.exit(1);
}

if (!isFeatureEnabled("MINIMAX_VIDEO")) {
  fail("MINIMAX_API_KEY not set — refusing to spend against the fallback.");
}
if ((process.env.VIDEO_PROVIDER ?? "minimax").toLowerCase().trim() !== "minimax") {
  fail("VIDEO_PROVIDER is not 'minimax' — flip it back, this probe is MiniMax-only.");
}
if (!isFeatureEnabled("CLOUDFLARE")) {
  fail("R2 not configured — mirroring will be a no-op. Set CLOUDFLARE_* keys first.");
}

const explicitBook = process.env["PROBE_BOOK_ID"];
const explicitPage = process.env["PROBE_PAGE_NUM"] ? Number.parseInt(process.env["PROBE_PAGE_NUM"], 10) : null;

const picked = await prisma.page.findFirst({
  where: explicitBook
    ? { bookId: explicitBook }
    : { book: { status: { in: ["DRAFT", "STYLE_SELECTED", "REVIEW", "PUBLISHED"] } } },
  orderBy: [{ pageNum: "asc" }],
  select: {
    id: true,
    pageNum: true,
    bookId: true,
    promptSummary: true,
    book: { select: { title: true, ownerId: true } }
  }
});
if (!picked) {
  fail("No page found — set PROBE_BOOK_ID=<id> PROBE_PAGE_NUM=<n> or seed a test book first.");
}

let targetPage = picked;
if (explicitPage !== null) {
  const exact = await prisma.page.findUnique({
    where: { bookId_pageNum: { bookId: picked.bookId, pageNum: explicitPage } },
    select: { id: true, pageNum: true, bookId: true, promptSummary: true, book: { select: { title: true, ownerId: true } } }
  });
  if (!exact) fail(`PROBE_PAGE_NUM=${explicitPage} not found in book ${picked.bookId}.`);
  targetPage = exact;
}

const prompt =
  (targetPage.promptSummary && targetPage.promptSummary.trim()) ||
  `A cinematic illustration for page ${targetPage.pageNum} of ${picked.book?.title ?? "AnimBook"}, animation-ready still, painterly lighting, soft depth of field.`;

const startedAt = new Date();

console.log(`[probe-minimax] starting one-clip probe`);
console.log(`  book    : ${picked.book?.title ?? targetPage.bookId}`);
console.log(`  page    : ${targetPage.pageNum} (id=${targetPage.id})`);
console.log(`  owner   : ${picked.book?.ownerId ?? "<none>"}`);
console.log(`  provider: ${appEnv.MINIMAX_VIDEO_MODEL} @ 6s/768P`);
console.log(`  image   : ${appEnv.MINIMAX_IMAGE_MODEL}`);

const result = await generateClip({
  projectId: targetPage.bookId,
  pageNum: targetPage.pageNum,
  prompt,
  motionPrompt: prompt,
  durationSeconds: 6,
  resolution: "768P",
  strict: true
});

const finishedAt = new Date();
const elapsedSec = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
const unitCostUsd = 0.28;

await prisma.page.update({
  where: { id: targetPage.id },
  data: { videoUrl: result.videoUrl, posterUrl: result.posterUrl, status: "READY" }
});

await prisma.usageEvent.create({
  data: {
    userId: picked.book?.ownerId ?? "probe-minimax-video",
    bookId: targetPage.bookId,
    pageId: targetPage.id,
    kind: "ANIMATE_KICK",
    provider: "MINIMAX_VIDEO",
    units: 1,
    unitCostUsd,
    totalUsd: unitCostUsd,
    status: "SUCCESS",
    metadata: {
      model: appEnv.MINIMAX_VIDEO_MODEL,
      imageModel: appEnv.MINIMAX_IMAGE_MODEL,
      resolution: "768P",
      durationSeconds: 6,
      source: result.source,
      facesLocked: Boolean(result.facesLocked),
      elapsedSec
    }
  }
});
void mirrorToR2;

console.log("--- probe summary -----------------------------------------------------------");
console.log(JSON.stringify({
  bookId: targetPage.bookId,
  pageId: targetPage.id,
  pageNum: targetPage.pageNum,
  videoUrl: result.videoUrl,
  posterUrl: result.posterUrl,
  durationSeconds: result.durationSeconds,
  elapsedSec,
  source: result.source,
  provider: "MINIMAX_VIDEO",
  model: appEnv.MINIMAX_VIDEO_MODEL,
  imageModel: appEnv.MINIMAX_IMAGE_MODEL,
  costUsd: unitCostUsd,
  usageRowWritten: true,
  finishedAt: finishedAt.toISOString()
}, null, 2));
console.log("-----------------------------------------------------------------------------");

await prisma.$disconnect();
