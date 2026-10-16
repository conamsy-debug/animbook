/**
 * Post-deploy smoke probe — exactly ONE narration through the new
 * MiniMax (Hailuo) TTS pipeline against page 1 of one test book.
 *
 *   tsx scripts/probe-minimax-narration.ts                   # uses PROBE_BOOK_ID below
 *   PROBE_BOOK_ID=cmu5… PROBE_PAGE_NUM=1 tsx …               # explicit
 *
 * Picks the lowest-pageNum row of the target book, runs the live
 * `generateNarration` (which dispatches via ttsProvider.ts to
 * minimax-speech.ts when TTS_PROVIDER=minimax), uploads to R2 under
 * narration/<bookId>/p<n>-<hash>.mp3, records one usage_events row,
 * and prints a precise summary.
 *
 * Schema-drift safety: same defensive pattern as probe-minimax-video.ts.
 * No `select` clause on Page / Book / User — use include and cast to
 * Record<string, unknown>, then read defensively. The probe keeps
 * working even if a column is missing on production.
 *
 * Guard rails:
 *   - Refuses to run if MINIMAX_TTS feature is off, R2 is unconfigured,
 *     or TTS_PROVIDER ≠ minimax. Never logs the API key.
 *   - hasNarration guard: if Page.audioUrl is non-empty, the narration +
 *     mirror still happen, but the Page row UPDATE is suppressed.
 *
 * Usage row userId resolution (NEVER a fake id — Postgres rejects
 * with P2003):
 *   1. Book.creatorId (read defensively).
 *   2. Else, look up a real "admin"-prefixed user (the conventional
 *      Cloudflare / Sentry / Railway pattern when the User model has
 *      no dedicated admin flag).
 *   3. Else, skip writing the usage_events row entirely and print
 *      the cost in the JSON summary.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { appEnv, isFeatureEnabled } from "../src/config/env.js";
import { generateNarration, currentTtsProvider } from "../src/services/ttsProvider.js";
import { findVoice, pickProviderVoiceId } from "../src/config/voices.js";
import { estimateMinimaxTtsCostUsd } from "../src/services/usageTracking.js";

const prisma = new PrismaClient();

function fail(message: string): never {
  console.error("[probe-narration] " + message);
  process.exit(1);
}

if (!isFeatureEnabled("MINIMAX_TTS")) {
  fail("MINIMAX_TTS feature is not enabled (MINIMAX_API_KEY unset) — refusing to spend against the fallback.");
}
if ((process.env["TTS_PROVIDER"] ?? "minimax").toLowerCase().trim() !== "minimax") {
  fail("TTS_PROVIDER is not 'minimax' — flip it back, this probe is MiniMax-only.");
}
if (!isFeatureEnabled("CLOUDFLARE")) {
  fail("R2 not configured — mirroring will be a no-op. Set CLOUDFLARE_* keys first.");
}

const explicitBook = process.env["PROBE_BOOK_ID"] ?? "cmu5mod660003pb1553fnqaur";
const explicitPage = process.env["PROBE_PAGE_NUM"] ? Number.parseInt(process.env["PROBE_PAGE_NUM"], 10) : 1;

async function main() {
  /* --------------------------------------------------------------------- *
   * Defensive readers — same pattern as probe-minimax-video.ts.
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
   * Fetch the target page + its book. No `select` clause on Page / Book —
   * PrismaClient won't reject any keys; runtime just returns whatever
   * columns it knows about. Defensive readers handle missing/different
   * shapes.
   * --------------------------------------------------------------------- */

  interface PageWithBook {
    id: string;
    bookId: string;
    pageNum: number;
    audioUrl: string | null;
    vttUrl: string | null;
    textExcerpt: string;
    book: unknown;
  }

  const picked = await prisma.page.findUnique({
    where: { bookId_pageNum: { bookId: explicitBook, pageNum: explicitPage } },
    include: { book: true }
  });
  if (!picked) {
    fail(`No page found — PROBE_BOOK_ID=${explicitBook} PROBE_PAGE_NUM=${explicitPage}. Check the id.`);
  }
  const targetPage = picked as unknown as PageWithBook;
  const targetBook = (picked as { book: unknown }).book as AnyRecord;

  const pageAny = targetPage as unknown as AnyRecord;
  const pageId: string = pickString(pageAny, "id") || targetPage.id;
  const bookId: string = pickString(pageAny, "bookId") || targetPage.bookId;
  const pageNum: number = pickNumber(pageAny, "pageNum") || targetPage.pageNum;
  const pageText: string = pickString(pageAny, "textExcerpt") || targetPage.textExcerpt || "";

  const bookSlug = pickString(targetBook, "slug");
  const bookTitle = pickString(targetBook, "title");
  const bookCreatorId = pickString(targetBook, "creatorId");
  const existingAudioUrl = pickString(pageAny, "audioUrl");
  const existingVttUrl = pickString(pageAny, "vttUrl");
  const hasNarration = existingAudioUrl.length > 0;

  /* --------------------------------------------------------------------- *
   * Voice: nigerian-storyteller's active MiniMax voice (the user picked
   * English_expressive_narrator during the migration; this reads the
   * same mapping via pickProviderVoiceId()).
   * --------------------------------------------------------------------- */

  const voice = findVoice("nigerian-storyteller");
  const voiceId = pickProviderVoiceId(voice);
  if (!voiceId) {
    fail("nigerian-storyteller has no provider voice id — check config/voices.ts");
  }

  const startedAt = new Date();

  console.log(`[probe-narration] starting one-page probe`);
  console.log(`  book    : ${bookTitle || bookSlug || bookId}`);
  console.log(`  page    : ${pageNum} (id=${pageId})`);
  console.log(`  voice   : nigerian-storyteller -> ${voiceId}`);
  console.log(`  owner   : ${bookCreatorId || "<none>"}`);
  console.log(`  provider: ${currentTtsProvider()} (${appEnv.MINIMAX_TTS_MODEL})`);
  console.log(`  text    : ${pageText.length} chars`);
  console.log(`  existing: ${hasNarration ? `${existingAudioUrl} (REAL — Page row will be LEFT AS-IS)` : "(none)"}`);

  /* --------------------------------------------------------------------- *
   * Generate. Storage key follows the pipeline convention
   * `narration/<bookId>/p<pageNum>-<hash>.mp3` so the probe's output
   * slots into the same R2 tree the production narration stage uses.
   * --------------------------------------------------------------------- */

  const storageKey = `narration/${bookId}/p${pageNum}-probe-${Date.now().toString(36)}.mp3`;

  const result = await generateNarration({
    text: pageText,
    voiceId,
    storageKey,
    strict: true
  });

  const finishedAt = new Date();
  const elapsedSec = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
  const characters = result.characters ?? pageText.length;
  const costUsd = estimateMinimaxTtsCostUsd({ characters, model: appEnv.MINIMAX_TTS_MODEL });

  /* --------------------------------------------------------------------- *
   * Page row: only update when the page had no narration before. If the
   * probe found an existing audioUrl/vttUrl, we still emit the new
   * generation (so the user can hear the new voice) but leave the page
   * fields untouched.
   * --------------------------------------------------------------------- */

  let pageUpdated = false;
  if (!hasNarration && result.audioUrl) {
    // Cast audioStatus to the AudioStatus enum (Prisma typing rejects raw
    // strings). The local schema has AudioStatus = NONE|GENERATING|READY|FAILED.
    const data: { audioUrl: string; vttUrl?: string | null; audioStatus: "READY" } = {
      audioUrl: result.audioUrl,
      audioStatus: "READY"
    };
    if (result.vttUrl) data.vttUrl = result.vttUrl;
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
   *   2. Else, look up a real "admin"-prefixed user.
   *   3. Else, skip the usage_events write entirely and print the cost.
   *      **Never** fallback to a literal string like "probe" — Postgres
   *      rejects with P2003.
   * --------------------------------------------------------------------- */

  let usageUserId: string | null = bookCreatorId;
  let usageRowWritten = false;
  let usageRowSkippedReason: string | null = null;

  if (!usageUserId) {
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
      console.warn(`[probe-narration] book.creatorId empty — fell back to admin user ${adminCandidate.email}`);
    } else {
      usageRowSkippedReason = "book has no creatorId and no admin user was found by email-prefix 'admin'";
      console.warn(`[probe-narration] ${usageRowSkippedReason}; skipping usage_events write, reporting cost only.`);
    }
  }

  if (usageUserId && result.audioUrl) {
    await prisma.usageEvent.create({
      data: {
        userId: usageUserId,
        bookId,
        pageId,
        kind: "NARRATION_KICK",
        provider: "MINIMAX_TTS",
        units: characters,
        unitCostUsd: costUsd / Math.max(1, characters),
        totalUsd: costUsd,
        status: "SUCCESS",
        metadata: {
          model: appEnv.MINIMAX_TTS_MODEL,
          voiceId,
          role: "nigerian-storyteller",
          elapsedSec,
          pageUpdated,
          skippedPageRow: hasNarration,
          usageUserSource: bookCreatorId ? "book.creatorId" : "admin-email-fallback",
          source: result.source
        }
      }
    });
    usageRowWritten = true;
  }

  console.log("--- probe summary -----------------------------------------------------------");
  console.log(JSON.stringify({
    bookId,
    pageId,
    pageNum,
    voiceId,
    provider: currentTtsProvider(),
    model: appEnv.MINIMAX_TTS_MODEL,
    characters,
    durationSeconds: result.durationSeconds,
    audioUrl: result.audioUrl,
    vttUrl: result.vttUrl,
    costUsd,
    elapsedSec,
    usageRowWritten,
    usageRowSkippedReason,
    pageUpdated,
    skippedPageRow: hasNarration,
    existingAudioUrl: hasNarration ? existingAudioUrl : null,
    existingVttUrl: hasNarration ? existingVttUrl : null,
    finishedAt: finishedAt.toISOString()
  }, null, 2));
  console.log("-----------------------------------------------------------------------------");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[probe-narration] unexpected:", err);
  process.exit(1);
});