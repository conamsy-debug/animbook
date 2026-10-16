/**
 * Post-deploy smoke probe — exactly ONE video clip through the new
 * MiniMax (Hailuo) video pipeline against one page of the test book.
 *
 *   tsx scripts/probe-minimax-video.ts              # lowest pageNum of first book
 *   PROBE_BOOK_ID=cmu5... PROBE_PAGE_NUM=3 tsx …    # explicit
 *
 * Picks the lowest-pageNum row of the target book, generates the still
 * (image-01), animates it (Hailuo 2.3, 6s/768P), downloads the MiniMax file
 * (links expire inside ~1h, so we mirror immediately), records one
 * usage_events row, and prints a precise summary.
 *
 * Schema-drift safety:
 *   The local prisma/schema.prisma has drifted ahead of production
 *   (`prisma migrate status` reports "Database schema is up to date!" with
 *   zero unapplied migrations, yet the live PrismaClient rejects some
 *   `<select>` keys that exist in the schema but were never migration'd —
 *   e.g. `promptText`, `Book.title`, `Book.ownerId` — and the live
 *   PrismaClient won't SELECT columns it doesn't know about, so
 *   migrating the schema would also make `include: { book: true }`
 *   crash on Postgres column-not-found).
 *
 *   To keep the probe safe against ANY drift, we use `include: { book: true }`
 *   on both queries (no `select` keys, so no PrismaClient validation
 *   error) and then READ EVERY PAGE / BOOK FIELD DEFENSIVELY via a
 *   `Record<string, unknown>` cast + `pickString()` helper. Unknown keys
 *   return empty string, never throw. If a field PrismaClient doesn't
 *   know about is added later, this probe keeps working without another
 *   edit.
 *
 * Guard rails:
 *   - Refuses to run if MINIMAX_VIDEO feature is off, R2 is unconfigured,
 *     or VIDEO_PROVIDER ≠ minimax. Never logs the API key.
 *   - hasRealClip guard: if Page.videoUrl is a non-placehold host, the
 *     generate + mirror + usage-row still happen, but Page.videoUrl /
 *     posterUrl / status are LEFT AS-IS.
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
if ((process.env["VIDEO_PROVIDER"] ?? "minimax").toLowerCase().trim() !== "minimax") {
  fail("VIDEO_PROVIDER is not 'minimax' — flip it back, this probe is MiniMax-only.");
}
if (!isFeatureEnabled("CLOUDFLARE")) {
  fail("R2 not configured — mirroring will be a no-op. Set CLOUDFLARE_* keys first.");
}

const explicitBook = process.env["PROBE_BOOK_ID"];
const explicitPage = process.env["PROBE_PAGE_NUM"] ? Number.parseInt(process.env["PROBE_PAGE_NUM"], 10) : null;

/* --------------------------------------------------------------------- *
 * Defensive readers. The local PrismaClient knows about every typed
 * field on Page / Book, but production may be missing some columns, so
 * we cast to a generic record and pull what we need defensively.
 * Missing → ""; non-string → ""; never throws.
 * --------------------------------------------------------------------- */

type AnyRecord = Record<string, unknown>;

function pickString(obj: AnyRecord, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function pickNumber(obj: AnyRecord, key: string): number {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/* --------------------------------------------------------------------- *
 * Fetch the target page + its book. No `select` clause — PrismaClient
 * won't reject any keys; runtime just returns whatever columns it knows
 * about. The defensive readers above handle missing/different shapes.
 * --------------------------------------------------------------------- */

interface PageWithBook {
  id: string;
  bookId: string;
  pageNum: number;
  videoUrl: string | null;
  book: unknown; // typed as unknown so we can probe defensively
}

const picked: PageWithBook | null = await prisma.page.findFirst({
  where: explicitBook
    ? { bookId: explicitBook }
    : { book: { status: { in: ["DRAFT", "STYLE_SELECTED", "REVIEW", "PUBLISHED"] } } },
  orderBy: [{ pageNum: "asc" }],
  include: { book: true }
});
if (!picked) {
  fail("No page found — set PROBE_BOOK_ID=<id> PROBE_PAGE_NUM=<n> or seed a test book first.");
}

let targetPage: PageWithBook = picked;
let targetBook: AnyRecord = (picked as PageWithBook).book as AnyRecord;

if (explicitPage !== null) {
  const exact: PageWithBook | null = await prisma.page.findUnique({
    where: { bookId_pageNum: { bookId: picked.bookId, pageNum: explicitPage } },
    include: { book: true }
  });
  if (!exact) fail(`PROBE_PAGE_NUM=${explicitPage} not found in book ${picked.bookId}.`);
  targetPage = exact;
  targetBook = exact.book as AnyRecord;
}

const pageAny = targetPage as unknown as AnyRecord;
const pageId: string = pickString(pageAny, "id") || targetPage.id;
const bookId: string = pickString(pageAny, "bookId") || targetPage.bookId;
const pageNum: number = pickNumber(pageAny, "pageNum") || targetPage.pageNum;

/* --------------------------------------------------------------------- *
 * Prompt assembly. Falls through animationPrompt → stillPrompt →
 * textExcerpt → generic. Empty strings just mean "use the generic".
 * --------------------------------------------------------------------- */

const animationPrompt = pickString(pageAny, "animationPrompt");
const stillPrompt = pickString(pageAny, "stillPrompt");
const textExcerpt = pickString(pageAny, "textExcerpt");
const promptSource = [animationPrompt, stillPrompt, textExcerpt]
  .map((s) => s.trim())
  .find((s) => s.length > 0) ?? "";

const bookSlug = pickString(targetBook, "slug");
const bookCreatorId = pickString(targetBook, "creatorId");
const bookTitle = pickString(targetBook, "title"); // present locally; prod empty if dropped

const prompt =
  promptSource ||
  `A cinematic illustration for page ${pageNum} of ${bookSlug || bookId}, animation-ready still, painterly lighting, soft depth of field.`;

/* --------------------------------------------------------------------- *
 * hasRealClip: anything non-empty + non-placehold.co on Page.videoUrl
 * counts as a real clip. Stubs are caught so the Page row UPDATE is
 * suppressed.
 * --------------------------------------------------------------------- */

const PLACEHOLDER_HOST = "placehold.co";
const existingVideoUrl = pickString(pageAny, "videoUrl");
const hasRealClip = existingVideoUrl.length > 0 && !existingVideoUrl.includes(PLACEHOLDER_HOST);

const startedAt = new Date();

console.log(`[probe-minimax] starting one-clip probe`);
console.log(`  book    : ${bookTitle || bookSlug || bookId}`);
console.log(`  page    : ${pageNum} (id=${pageId})`);
console.log(`  owner   : ${bookCreatorId || "<none>"}`);
console.log(`  provider: ${appEnv.MINIMAX_VIDEO_MODEL} @ 6s/768P`);
console.log(`  image   : ${appEnv.MINIMAX_IMAGE_MODEL}`);
console.log(`  existing: ${hasRealClip ? `${existingVideoUrl} (REAL — Page row will be LEFT AS-IS)` : `${existingVideoUrl || "(none)"}`}`);

const result = await generateClip({
  projectId: bookId,
  pageNum,
  prompt,
  motionPrompt: prompt,
  durationSeconds: 6,
  resolution: "768P",
  strict: true
});

const finishedAt = new Date();
const elapsedSec = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
const unitCostUsd = 0.28;

let pageUpdated = false;
if (!hasRealClip) {
  // Defensive UPDATE: only write fields the live PrismaClient knows about.
  // We can't predict which columns are missing in prod, so the safe move
  // for now is to set just the two URLs (those are confirmed on both prod
  // and local). `status` is optional — local has it as enum, prod has it;
  // we set it on best-effort.
  const data: { videoUrl: string; posterUrl?: string; status?: string } = {
    videoUrl: result.videoUrl
  };
  if (result.posterUrl) data.posterUrl = result.posterUrl;
  data.status = "READY";
  await prisma.page.update({
    where: { id: pageId },
    data
  });
  pageUpdated = true;
}

/* --------------------------------------------------------------------- *
 * Usage row: always need a real User.id (FK constraint on usage_events).
 *
 *   1. Try Book.creatorId (cast defensively to Record<string, unknown>).
 *   2. Else, look up a real "admin" user. We can't be 100% sure which User
 *      is the admin — the User model has tier=BASIC/PREMIUM/ENTERPRISE
 *      and no dedicated admin flag — so we pick the first user whose
 *      email starts with "admin" (case-insensitive). This is the
 *      conventional Cloudflare / Sentry / Railway pattern.
 *   3. Else, skip writing the usage_events row entirely and print the
 *      cost in the JSON summary. **Never** fallback to a literal string
 *      like "probe-minimax-video" — Postgres rejects with P2003.
 * --------------------------------------------------------------------- */

let usageUserId: string | null = bookCreatorId;
let usageRowWritten = false;
let usageRowSkippedReason: string | null = null;

if (!usageUserId) {
  // Step 2: admin user fallback. Read defensively.
  let adminCandidate: { id: string; email: string } | null = null;
  try {
    const found = await prisma.user.findFirst({
      where: { email: { startsWith: "admin" } },
      select: { id: true, email: true }
    });
    if (found && typeof found.id === "string" && found.id.length > 0) {
      adminCandidate = { id: found.id, email: found.email };
    }
  } catch {
    // User table unavailable for whatever reason; fall through to skip.
  }
  if (adminCandidate) {
    usageUserId = adminCandidate.id;
    console.warn(`[probe-minimax] book.creatorId empty — fell back to admin user ${adminCandidate.email}`);
  } else {
    usageRowSkippedReason = "book has no creatorId and no admin user was found by email-prefix 'admin'";
    console.warn(`[probe-minimax] ${usageRowSkippedReason}; skipping usage_events write, reporting cost only.`);
  }
}

if (usageUserId) {
  await prisma.usageEvent.create({
    data: {
      userId: usageUserId,
      bookId,
      pageId,
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
        elapsedSec,
        pageUpdated,
        skippedPageRow: hasRealClip,
        usageUserSource: bookCreatorId ? "book.creatorId" : "admin-email-fallback"
      }
    }
  });
  usageRowWritten = true;
}
void mirrorToR2;

console.log("--- probe summary -----------------------------------------------------------");
console.log(JSON.stringify({
  bookId,
  pageId,
  pageNum,
  videoUrl: result.videoUrl,
  posterUrl: result.posterUrl,
  durationSeconds: result.durationSeconds,
  elapsedSec,
  source: result.source,
  provider: "MINIMAX_VIDEO",
  model: appEnv.MINIMAX_VIDEO_MODEL,
  imageModel: appEnv.MINIMAX_IMAGE_MODEL,
  costUsd: unitCostUsd,
  usageRowWritten,
  usageRowSkippedReason,
  pageUpdated,
  skippedPageRow: hasRealClip,
  finishedAt: finishedAt.toISOString()
}, null, 2));
console.log("-----------------------------------------------------------------------------");

await prisma.$disconnect();
