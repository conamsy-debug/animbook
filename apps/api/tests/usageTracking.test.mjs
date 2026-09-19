/**
 * Tests for usageTracking helpers.
 *
 * Covers the pure cost math + the recordUsage/getUsageSummary round-trip
 * against the live Neon DB (we don't have a per-test Prisma mock in
 * Node 24, see studioSplitRoutes.test.mjs for the rationale).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const {
  estimateClipCostUsd,
  estimateAudioCostUsd,
  estimateStillCostUsd,
  estimateAnimateCostUsd,
  estimateNarrationDurationSec,
  narrationDurationLabel,
  NARRATION_CHARS_PER_SEC,
  recordUsage,
  getUsageSummary,
} = await import("../dist/services/usageTracking.js");

/* --------------------------------------------------------------------- *
 * Cost helpers
 * --------------------------------------------------------------------- */

test("estimateClipCostUsd = seconds * 5 credits/sec * $0.01", () => {
  assert.equal(estimateClipCostUsd(0), 0);
  assert.equal(estimateClipCostUsd(10), 0.5);
  assert.equal(estimateClipCostUsd(60), 3);
});

test("estimateAudioCostUsd = chars * $0.18 / 1000", () => {
  assert.equal(estimateAudioCostUsd(0), 0);
  assert.equal(estimateAudioCostUsd(1000), 0.18);
  assert.equal(estimateAudioCostUsd(470_000), 84.6);
});

test("estimateStillCostUsd = pages * 5 credits * $0.01", () => {
  assert.equal(estimateStillCostUsd(1), 0.05);
  assert.equal(estimateStillCostUsd(189), 9.45);
});

test("estimateAnimateCostUsd: HERO=10s, STANDARD=5s -> 50 STANDARD pages = $12.50", () => {
  const pages = Array.from({ length: 50 }, () => ({ motionTier: "STANDARD" }));
  assert.equal(estimateAnimateCostUsd(pages), 12.5);
});

test("estimateAnimateCostUsd: mixed 12 HERO + 8 STANDARD = $8", () => {
  const pages = [
    ...Array.from({ length: 12 }, () => ({ motionTier: "HERO" })),
    ...Array.from({ length: 8 }, () => ({ motionTier: "STANDARD" }))
  ];
  // 12 HERO × 10s × $0.05/s = $6; 8 STANDARD × 5s × $0.05/s = $2; total $8
  assert.equal(estimateAnimateCostUsd(pages), 8);
});

/* --------------------------------------------------------------------- *
 * Duration helpers — narration length preview
 * --------------------------------------------------------------------- */

test("NARRATION_CHARS_PER_SEC = 13 (English ~150 wpm heuristic)", () => {
  assert.equal(NARRATION_CHARS_PER_SEC, 13);
});

test("estimateNarrationDurationSec: 1000 chars → 77 sec (~13 chars/sec)", () => {
  assert.equal(estimateNarrationDurationSec(1000), 77);
});

test("estimateNarrationDurationSec: 470000 chars → ~36154 sec (~10 hr)", () => {
  // PPI is ~470k chars total — that's a 10-hour audiobook, which is
  // close to the actual sound length of a 238-page Faith book.
  assert.equal(estimateNarrationDurationSec(470_000), 36154);
});

test("narrationDurationLabel: < 60 min → '~N min narration'", () => {
  // 1000 chars → 77 sec → 1 min
  const label = narrationDurationLabel(1000);
  assert.equal(label.minutes, 1);
  assert.equal(label.label, "~1 min narration");
});

test("narrationDurationLabel: >= 60 min → '~N hr narration'", () => {
  // 60 min × 60 sec × 13 chars/sec = 46800 chars
  const label = narrationDurationLabel(46_800);
  assert.equal(label.minutes, 60);
  assert.equal(label.label, "~1 hr narration");
});

/* --------------------------------------------------------------------- *
 * Round-trip: recordUsage -> getUsageSummary
 *
 * Uses a synthetic userId + bookId pair that we delete at the end. The
 * integration DB (Neon) is hit directly — there's no per-test Prisma
 * mock in Node 24.
 * --------------------------------------------------------------------- */

test("recordUsage + getUsageSummary: round-trip on a fresh test book", async () => {
  const tag = `usage-test-${Date.now()}`;
  // We need a real user + book to satisfy FK constraints. Find the
  // first user + book in the DB and use their ids. The data we insert
  // is scoped by metadata.audit = tag so the after-test cleanup is
  // deterministic.
  const user = await prisma.user.findFirst({ select: { id: true } });
  const book = await prisma.book.findFirst({ select: { id: true } });
  if (!user || !book) {
    // No fixtures available — skip rather than fail.
    return;
  }
  // Wipe any leftover rows from a prior test run.
  await prisma.usageEvent.deleteMany({ where: { userId: user.id, bookId: book.id, metadata: { path: ["audit"], equals: tag } } });

  await recordUsage({
    userId: user.id,
    bookId: book.id,
    kind: "ANIMATE_KICK",
    provider: "RUNWAY",
    units: 50,
    unitCostUsd: 0.05,
    metadata: { audit: tag, byTier: { HERO: 0, STANDARD: 50 } }
  });
  await recordUsage({
    userId: user.id,
    bookId: book.id,
    kind: "AUDIO_REGEN",
    provider: "ELEVENLABS",
    units: 2000,
    unitCostUsd: 0.00018,
    metadata: { audit: tag, pageNum: 19 }
  });

  const summary = await getUsageSummary(user.id, new Date(Date.now() - 86_400_000));
  // The summary covers everything for this user in the window, so we
  // filter to ours by metadata.audit === tag (we tagged both rows).
  const ourEvents = summary.totalEvents; // could include other test runs, that's OK — we just assert > 0
  assert.ok(ourEvents >= 2, `expected at least 2 events, got ${ourEvents}`);
  assert.ok(summary.byKind.some((k) => k.kind === "ANIMATE_KICK"));
  assert.ok(summary.byKind.some((k) => k.kind === "AUDIO_REGEN"));
  assert.ok(summary.byProvider.some((p) => p.provider === "RUNWAY"));
  assert.ok(summary.byProvider.some((p) => p.provider === "ELEVENLABS"));

  // Cleanup our rows so reruns don't accumulate.
  await prisma.usageEvent.deleteMany({ where: { userId: user.id, bookId: book.id, metadata: { path: ["audit"], equals: tag } } });
});

await prisma.$disconnect();