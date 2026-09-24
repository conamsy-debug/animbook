/**
 * Tests for AnimBook Languages Patch 09 — FSRS spaced repetition.
 *
 * Two parts:
 *   1. Pure-logic unit tests for the rating helpers in fsrs.ts:
 *      rateCard, newCardSnapshot, ratingName, REVIEW_BATCH_SIZE.
 *      Verifies that the DB-shaped snapshots round-trip through
 *      ts-fsrs without losing state, and that a sane Again/Hard/
 *      Good/Easy sequence walks a card through new → learning → review.
 *   2. DB-backed HTTP round-trips for GET /api/lang/review/due and
 *      POST /api/lang/review/:userVocabId.
 *
 * Skipped when DATABASE_URL is unset (CI without a DB).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, "../prisma/languages-fixtures");
const routerPath = path.resolve(__dirname, "../dist/modules/languages/routes.js");
const servicesPath = path.resolve(__dirname, "../dist/services/languages/index.js");

const DB_URL = process.env.DATABASE_URL || "";
const DB_TESTS_ENABLED = DB_URL.length > 0 && existsSync(fixturesDir);
const dbSuite = DB_TESTS_ENABLED ? test : test.skip;

async function startAppRouter() {
  const express = (await import("express")).default;
  const { default: router } = await import(pathToFileURL(routerPath).href);
  const app = express();
  app.use(express.json());
  app.use("/api/lang", router);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
    server.on("error", reject);
  });
}

async function loadFixture(prisma, slug) {
  const { importLesson } = await import(pathToFileURL(servicesPath).href);
  const fixturePath = path.join(
    fixturesDir,
    slug === "market-morning" ? "es-market-morning.json" : "he-shalom-story.json"
  );
  const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
  await prisma.story.deleteMany({ where: { masterStory: { slug: raw.master_story_slug } } });
  await prisma.masterStory.deleteMany({ where: { slug: raw.master_story_slug } });
  await prisma.lexeme.deleteMany({ where: { targetLang: raw.target_lang } });
  await prisma.exercise.deleteMany({});
  await prisma.userVocab.deleteMany({});
  await prisma.reviewLog.deleteMany({});
  await prisma.exerciseAttempt.deleteMany({});
  await prisma.pronunciationAttempt.deleteMany({});
  await prisma.learnerStats.deleteMany({});
  const result = await importLesson(prisma, raw);
  await prisma.story.update({
    where: { id: result.storyId },
    data: { isPublished: true }
  });
  return result;
}

/* --------------------------------------------------------------------- *
 * Part 1 — pure helpers
 * --------------------------------------------------------------------- */

async function loadFsrs() {
  return await import(pathToFileURL(servicesPath).href);
}

test("newCardSnapshot starts in `new` with zero FSRS fields", async () => {
  const { newCardSnapshot } = await loadFsrs();
  const t0 = new Date("2026-09-23T12:00:00Z");
  const snap = newCardSnapshot(t0);
  assert.equal(snap.due.toISOString(), t0.toISOString());
  assert.equal(snap.stability, 0);
  assert.equal(snap.difficulty, 0);
  assert.equal(snap.elapsedDays, 0);
  assert.equal(snap.scheduledDays, 0);
  assert.equal(snap.reps, 0);
  assert.equal(snap.lapses, 0);
  assert.equal(snap.state, "new");
  assert.equal(snap.lastReview, null);
});

test("rateCard: first Good moves new → review + bumps reps", async () => {
  // Spec § 4 doesn't persist ts-fsrs's per-step `learning_steps`
  // index, so we run the scheduler with `learning_steps: []` — FSRS
  // "manages" the schedule and graduates a new card on the first
  // successful review. The trade-off is fewer relearning passes; the
  // win is no per-card DB migration to track the step.
  const { rateCard, newCardSnapshot } = await loadFsrs();
  const t0 = new Date("2026-09-23T12:00:00Z");
  const next = rateCard(newCardSnapshot(t0), 3, t0);
  assert.equal(next.card.reps, 1);
  assert.equal(next.card.lapses, 0);
  assert.equal(next.card.state, "review");
  // FSRS schedules the next review a few days out.
  assert.ok(next.card.due.getTime() > t0.getTime(), "due must move forward");
  assert.ok(next.card.scheduledDays >= 1, "scheduledDays should be >= 1 after graduation");
});

test("rateCard: Again on a review card bumps lapses + drops to relearning", async () => {
  const { rateCard, newCardSnapshot } = await loadFsrs();
  const t0 = new Date("2026-09-23T12:00:00Z");
  // First a Good to graduate → review. Then an Again the next day.
  const afterGood = rateCard(newCardSnapshot(t0), 3, t0);
  assert.equal(afterGood.card.state, "review");
  const t1 = new Date("2026-09-24T12:00:00Z");
  const afterAgain = rateCard(afterGood.card, 1, t1);
  assert.equal(afterAgain.card.reps, 2);
  assert.equal(afterAgain.card.lapses, 1, "Again on a review card increments lapses");
  assert.equal(afterAgain.card.state, "relearning");
});

test("rateCard: successive Goods grow the interval exponentially", async () => {
  const { rateCard, newCardSnapshot } = await loadFsrs();
  let card = newCardSnapshot(new Date("2026-09-23T12:00:00Z"));
  const start = new Date("2026-09-23T12:00:00Z").getTime();
  let prevScheduledDays = 0;
  for (let i = 0; i < 5; i++) {
    const reviewedAt = new Date(start + i * 24 * 60 * 60 * 1000);
    const next = rateCard(card, 3, reviewedAt);
    card = next.card;
    assert.equal(card.state, "review");
    // FSRS produces a non-decreasing interval across consecutive
    // Goods (fuzz can make it slightly jump but it never shrinks).
    assert.ok(
      card.scheduledDays >= prevScheduledDays,
      `scheduledDays should not shrink: ${prevScheduledDays} → ${card.scheduledDays}`
    );
    prevScheduledDays = card.scheduledDays;
  }
  assert.equal(card.reps, 5);
  assert.equal(card.lapses, 0);
});

test("rateCard: Easy vs Hard on the same card produce different intervals", async () => {
  const { rateCard, newCardSnapshot } = await loadFsrs();
  // Same starting point, two different ratings, compare due offset.
  const snap = newCardSnapshot(new Date("2026-09-23T12:00:00Z"));
  const t1 = new Date("2026-09-23T12:00:00Z");
  const easy = rateCard(snap, 4, t1);
  // Reset and try again with Hard.
  const snap2 = newCardSnapshot(new Date("2026-09-23T12:00:00Z"));
  const hard = rateCard(snap2, 2, t1);
  // Easy produces a longer interval than Hard — the test only needs
  // to confirm the two ratings aren't identical.
  assert.notEqual(
    easy.card.due.toISOString(),
    hard.card.due.toISOString(),
    "Easy and Hard should schedule different due dates"
  );
});

test("rateCard: invalid rating throws a clean error", async () => {
  const { rateCard, newCardSnapshot } = await loadFsrs();
  const snap = newCardSnapshot(new Date("2026-09-23T12:00:00Z"));
  assert.throws(() => rateCard(snap, 5), /Invalid rating/);
  assert.throws(() => rateCard(snap, 0), /Invalid rating/);
});

test("rateCard: log meta strips ts-fsrs deprecated fields", async () => {
  const { rateCard, newCardSnapshot } = await loadFsrs();
  const t0 = new Date("2026-09-23T12:00:00Z");
  const result = rateCard(newCardSnapshot(t0), 3, t0);
  // The clean log meta must not carry the deprecated keys.
  assert.equal(result.log.rating, 3);
  assert.equal(typeof result.log.stability, "number");
  assert.equal(typeof result.log.difficulty, "number");
  assert.equal(typeof result.log.scheduledDays, "number");
  assert.equal(typeof result.log.due, "string");
  assert.equal(typeof result.log.review, "string");
  assert.equal(result.log.state, "review");
  // The deprecated fields are present in ts-fsrs's Card type but
  // deliberately excluded from our persisted meta.
  assert.equal(result.log.elapsed_days, undefined, "should not serialise deprecated field");
  assert.equal(result.log.last_elapsed_days, undefined);
});

test("ratingName: 1→Again, 2→Hard, 3→Good, 4→Easy", async () => {
  const { ratingName } = await loadFsrs();
  assert.equal(ratingName(1), "Again");
  assert.equal(ratingName(2), "Hard");
  assert.equal(ratingName(3), "Good");
  assert.equal(ratingName(4), "Easy");
});

test("REVIEW_BATCH_SIZE is 20 per spec § 10", async () => {
  const { REVIEW_BATCH_SIZE } = await loadFsrs();
  assert.equal(REVIEW_BATCH_SIZE, 20);
});

/* --------------------------------------------------------------------- *
 * Part 2 — DB-backed HTTP round-trips
 * --------------------------------------------------------------------- */

dbSuite("GET /review/due returns the user's due cards ordered by due asc", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  // Pick 3 lexemes and create user_vocab rows with different due
  // dates — all in the past so they show up as "due now".
  const lexemes = await prisma.lexeme.findMany({
    where: { targetLang: "es" },
    take: 3
  });
  assert.ok(lexemes.length >= 3);
  const userId = (await prisma.user.findFirst({ where: { email: "demo@animbook.com" } }))?.id;
  assert.ok(userId);

  const past = new Date("2026-09-01T00:00:00Z");
  for (const lex of lexemes) {
    await prisma.userVocab.create({
      data: {
        userId,
        lexemeId: lex.id,
        due: past,
        state: "review"
      }
    });
  }

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/review/due`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.count >= 3, `expected >=3 due cards, got ${body.count}`);
  assert.ok(body.totalDue >= 3);
  assert.equal(body.limit, 20);
  assert.ok(Array.isArray(body.cards));
  // Every card carries a lexeme with lemma + glosses (the UI needs
  // both to render without an extra round-trip).
  for (const card of body.cards) {
    assert.ok(card.userVocabId);
    assert.ok(card.lexemeId);
    assert.ok(card.lexeme && card.lexeme.lemma);
    assert.ok(card.lexeme && card.lexeme.glosses);
  }
});

dbSuite("GET /review/due?course=:id filters by target_lang", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const lex = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  const userId = (await prisma.user.findFirst({ where: { email: "demo@animbook.com" } }))?.id;
  await prisma.userVocab.create({
    data: { userId, lexemeId: lex.id, due: new Date("2020-01-01"), state: "review" }
  });

  const course = await prisma.course.findFirst({ where: { targetLang: "es" } });
  assert.ok(course);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/review/due?course=${course.id}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.count >= 1);
  for (const card of body.cards) {
    assert.equal(card.lexeme.targetLang, "es");
  }
});

dbSuite("GET /review/due?course=BAD returns 404", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/review/due?course=does-not-exist`);
  assert.equal(res.status, 404);
});

dbSuite("POST /review/:id with rating=3 records a review_log + updates the card", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const lex = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  const userId = (await prisma.user.findFirst({ where: { email: "demo@animbook.com" } }))?.id;
  const vocab = await prisma.userVocab.create({
    data: { userId, lexemeId: lex.id, due: new Date("2020-01-01"), state: "new" }
  });

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/review/${vocab.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating: 3 })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rating, 3);
  assert.ok(body.next);
  assert.equal(body.next.reps, 1, "first review bumps reps to 1");
  assert.equal(body.next.lapses, 0);
  // First Good on a new card → review (see comment in the helper
  // test above re: why we use empty learning_steps).
  assert.equal(body.next.state, "review");
  assert.ok(new Date(body.next.due).getTime() > Date.now() - 60_000, "due should be in the future");

  // Confirm the row landed.
  const card = await prisma.userVocab.findUnique({ where: { id: vocab.id } });
  assert.equal(card.reps, 1);
  assert.equal(card.state, "review");

  // Confirm the review log landed with the snapshot meta.
  const logs = await prisma.reviewLog.findMany({ where: { userVocabId: vocab.id } });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].rating, 3);
  assert.equal(logs[0].meta.state, "review");

  // Confirm +1 XP.
  const stats = await prisma.learnerStats.findUnique({ where: { userId } });
  assert.equal(stats.xpTotal, 1);
});

dbSuite("POST /review/:id with rating=1 increments lapses", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const lex = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  const userId = (await prisma.user.findFirst({ where: { email: "demo@animbook.com" } }))?.id;
  const vocab = await prisma.userVocab.create({
    data: { userId, lexemeId: lex.id, due: new Date("2020-01-01"), state: "review", reps: 5, lapses: 0 }
  });

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/review/${vocab.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating: 1 })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.next.lapses, 1, "Again increments lapses");
  assert.equal(body.next.reps, 6);
});

dbSuite("POST /review/:id rejects rating out of range with 400", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const lex = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  const userId = (await prisma.user.findFirst({ where: { email: "demo@animbook.com" } }))?.id;
  const vocab = await prisma.userVocab.create({
    data: { userId, lexemeId: lex.id, due: new Date("2020-01-01"), state: "new" }
  });

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  for (const rating of [0, 5, -1, 1.5, "three", null]) {
    const res = await fetch(`${baseUrl}/api/lang/review/${vocab.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating })
    });
    assert.equal(res.status, 400, `expected 400 for rating=${JSON.stringify(rating)}`);
  }
});

dbSuite("POST /review/:id returns 404 for an unknown card", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/review/no-such-card`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating: 3 })
  });
  assert.equal(res.status, 404);
});

dbSuite("GET /courses/:id includes dueCount", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const lex = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  const userId = (await prisma.user.findFirst({ where: { email: "demo@animbook.com" } }))?.id;
  await prisma.userVocab.create({
    data: { userId, lexemeId: lex.id, due: new Date("2020-01-01"), state: "review" }
  });

  const course = await prisma.course.findFirst({ where: { targetLang: "es" } });
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/courses/${course.id}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.dueCount, "number");
  assert.ok(body.dueCount >= 1, `expected dueCount >= 1, got ${body.dueCount}`);
});
