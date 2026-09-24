/**
 * Tests for AnimBook Languages Patch 10 — streaks + stats endpoint.
 *
 * Two parts:
 *   1. Pure-logic unit tests for `streaks.ts` (bumpStreak, daysBetween,
 *      localDateInTz, resolveTz) covering the spec § 7.3 invariants:
 *      same-day = no bump, consecutive day = +1, gap = reset to 1,
 *      timezone changes the "today" calculation.
 *   2. DB-backed HTTP round-trips for GET /api/lang/stats + the
 *      streak-bumping behaviour on /vocab, /exercises/.../attempts,
 *      /pronunciation, /review/:id, /stories/.../progress.
 *
 * Skipped when DATABASE_URL is unset.
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
  await prisma.storyProgress.deleteMany({});
  await prisma.learnerStats.deleteMany({});
  const result = await importLesson(prisma, raw);
  await prisma.story.update({
    where: { id: result.storyId },
    data: { isPublished: true }
  });
  return result;
}

/** Build a UTC noon timestamp for a calendar date — same trick the
 *  streak helper uses so DST shifts can't throw the math. */
function noonUtc(iso) {
  const [date, time] = iso.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm));
}

/* --------------------------------------------------------------------- *
 * Part 1 — pure streak helpers
 * --------------------------------------------------------------------- */

async function loadStreaks() {
  return await import(pathToFileURL(servicesPath).href);
}

test("localDateInTz: same UTC instant maps to different local dates", async () => {
  const { localDateInTz } = await loadStreaks();
  // 23:30 UTC on 2026-09-23 → 00:30 Lagos (next day) and 19:30 NYC (same).
  const t = new Date("2026-09-23T23:30:00Z");
  assert.equal(localDateInTz(t, "Africa/Lagos"), "2026-09-24");
  assert.equal(localDateInTz(t, "America/New_York"), "2026-09-23");
  assert.equal(localDateInTz(t, "Asia/Tokyo"), "2026-09-24");
  assert.equal(localDateInTz(t, "UTC"), "2026-09-23");
});

test("daysBetween: 0 / 1 / 2", async () => {
  const { daysBetween } = await loadStreaks();
  const tz = "UTC";
  assert.equal(daysBetween("2026-09-23", "2026-09-23", tz), 0);
  assert.equal(daysBetween("2026-09-23", "2026-09-24", tz), 1);
  assert.equal(daysBetween("2026-09-23", "2026-09-25", tz), 2);
  assert.equal(daysBetween("2026-09-25", "2026-09-23", tz), -2);
});

test("resolveTz: bad tz falls back to UTC", async () => {
  const { resolveTz } = await loadStreaks();
  assert.equal(resolveTz("Africa/Lagos"), "Africa/Lagos");
  assert.equal(resolveTz(""), "UTC");
  assert.equal(resolveTz(null), "UTC");
  // Mars/Moon tz IDs aren't valid → fallback.
  assert.equal(resolveTz("Mars/Olympus_Mons"), "UTC");
});

test("bumpStreak: first-ever activity lands on streak=1", async () => {
  const { bumpStreak } = await loadStreaks();
  const r = bumpStreak({
    lastActivityDate: null,
    currentStreakDays: 0,
    longestStreakDays: 0,
    now: noonUtc("2026-09-23T12:00:00Z"),
    tz: "UTC"
  });
  assert.equal(r.currentStreakDays, 1);
  assert.equal(r.longestStreakDays, 1);
  assert.equal(r.lastActivityDate, "2026-09-23");
});

test("bumpStreak: consecutive days extend the streak", async () => {
  const { bumpStreak } = await loadStreaks();
  const r1 = bumpStreak({
    lastActivityDate: null,
    currentStreakDays: 0,
    longestStreakDays: 0,
    now: noonUtc("2026-09-23T12:00:00Z"),
    tz: "UTC"
  });
  const r2 = bumpStreak({
    lastActivityDate: r1.lastActivityDate,
    currentStreakDays: r1.currentStreakDays,
    longestStreakDays: r1.longestStreakDays,
    now: noonUtc("2026-09-24T12:00:00Z"),
    tz: "UTC"
  });
  assert.equal(r2.currentStreakDays, 2);
  assert.equal(r2.longestStreakDays, 2);
});

test("bumpStreak: same-day activity is idempotent", async () => {
  const { bumpStreak } = await loadStreaks();
  const r1 = bumpStreak({
    lastActivityDate: null,
    currentStreakDays: 0,
    longestStreakDays: 0,
    now: noonUtc("2026-09-23T08:00:00Z"),
    tz: "UTC"
  });
  const r2 = bumpStreak({
    lastActivityDate: r1.lastActivityDate,
    currentStreakDays: r1.currentStreakDays,
    longestStreakDays: r1.longestStreakDays,
    now: noonUtc("2026-09-23T22:00:00Z"), // same date, later hour
    tz: "UTC"
  });
  assert.equal(r2.currentStreakDays, 1, "same-day activity doesn't double-bump");
  assert.equal(r2.longestStreakDays, 1);
});

test("bumpStreak: gap ≥ 2 days resets to 1, longest preserved", async () => {
  const { bumpStreak } = await loadStreaks();
  const r1 = bumpStreak({
    lastActivityDate: null,
    currentStreakDays: 0,
    longestStreakDays: 0,
    now: noonUtc("2026-09-20T12:00:00Z"),
    tz: "UTC"
  });
  const r2 = bumpStreak({
    lastActivityDate: r1.lastActivityDate,
    currentStreakDays: r1.currentStreakDays,
    longestStreakDays: r1.longestStreakDays,
    now: noonUtc("2026-09-21T12:00:00Z"),
    tz: "UTC"
  });
  // 2-day streak, longest = 2.
  const r3 = bumpStreak({
    lastActivityDate: r2.lastActivityDate,
    currentStreakDays: r2.currentStreakDays,
    longestStreakDays: r2.longestStreakDays,
    now: noonUtc("2026-09-25T12:00:00Z"), // 4 days later, gap > 2
    tz: "UTC"
  });
  assert.equal(r3.currentStreakDays, 1, "long gap resets the current streak");
  assert.equal(r3.longestStreakDays, 2, "longest is preserved");
});

test("bumpStreak: clock skew (negative delta) is forgiven", async () => {
  const { bumpStreak } = await loadStreaks();
  const r = bumpStreak({
    lastActivityDate: "2026-09-23",
    currentStreakDays: 5,
    longestStreakDays: 5,
    now: noonUtc("2026-09-20T12:00:00Z"), // server clock went BACKWARDS
    tz: "UTC"
  });
  assert.equal(r.currentStreakDays, 5, "negative delta must not reset the streak");
  assert.equal(r.longestStreakDays, 5);
  assert.equal(r.lastActivityDate, "2026-09-23");
});

test("bumpStreak: timezone changes what counts as 'today'", async () => {
  const { bumpStreak } = await loadStreaks();
  // 23:30 UTC on 2026-09-23 → 2026-09-24 in Lagos, 2026-09-23 in NYC.
  // For a learner in Lagos whose last activity was 2026-09-23 (their
  // local date), an activity at this UTC instant should EXTEND the
  // streak (delta = 1).
  const t = new Date("2026-09-23T23:30:00Z");
  const r = bumpStreak({
    lastActivityDate: "2026-09-23",
    currentStreakDays: 1,
    longestStreakDays: 1,
    now: t,
    tz: "Africa/Lagos"
  });
  assert.equal(r.currentStreakDays, 2);
});

/* --------------------------------------------------------------------- *
 * Part 2 — DB-backed HTTP round-trips
 * --------------------------------------------------------------------- */

dbSuite("GET /stats returns zeros for a brand-new learner", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/stats`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.xpTotal, 0);
  assert.equal(body.currentStreakDays, 0);
  assert.equal(body.longestStreakDays, 0);
  assert.equal(body.lastActivityDate, null);
  assert.equal(body.timezone, "UTC");
  assert.equal(body.vocabCount, 0);
  assert.equal(body.exerciseAttemptCount, 0);
});

dbSuite("POST /vocab bumps the streak + records last_activity_date", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const lex = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  const userId = (await prisma.user.findFirst({ where: { email: "demo@animbook.com" } }))?.id;
  const line = await prisma.line.findFirst({ where: { scene: { story: { isPublished: true } } } });

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/vocab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // /vocab uses snake_case per spec § 11 (set in Patch 06).
    body: JSON.stringify({
      lexeme_id: lex.id,
      source_line_id: line.id
    })
  });
  assert.equal(res.status, 201);

  // Confirm the streak row landed.
  const stats = await prisma.learnerStats.findUnique({ where: { userId } });
  assert.ok(stats, "stats row must exist after a vocab save");
  assert.equal(stats.xpTotal, 2, "vocab save awards 2 XP");
  assert.equal(stats.currentStreakDays, 1);
  assert.equal(stats.longestStreakDays, 1);
  assert.ok(stats.lastActivityDate, "last_activity_date must be set");
});

dbSuite("GET /stats reflects vocab save's XP + streak + vocabCount", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const lex = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  const line = await prisma.line.findFirst({ where: { scene: { story: { isPublished: true } } } });

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  // Save one word.
  await fetch(`${baseUrl}/api/lang/vocab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lexeme_id: lex.id, source_line_id: line.id })
  });

  const res = await fetch(`${baseUrl}/api/lang/stats`);
  const body = await res.json();
  assert.equal(body.xpTotal, 2);
  assert.equal(body.currentStreakDays, 1);
  assert.equal(body.vocabCount, 1);
  assert.equal(body.exerciseAttemptCount, 0);
});

dbSuite("Streak accumulates across multiple activities in the same day", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const lexemes = await prisma.lexeme.findMany({
    where: { targetLang: "es" },
    take: 3
  });
  const line = await prisma.line.findFirst({ where: { scene: { story: { isPublished: true } } } });
  const userId = (await prisma.user.findFirst({ where: { email: "demo@animbook.com" } }))?.id;

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  // Three saves in a row — same day, so streak stays at 1.
  for (const lex of lexemes) {
    const res = await fetch(`${baseUrl}/api/lang/vocab`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lexeme_id: lex.id, source_line_id: line.id })
    });
    assert.equal(res.status, 201);
  }

  const stats = await prisma.learnerStats.findUnique({ where: { userId } });
  assert.equal(stats.currentStreakDays, 1, "same-day activity doesn't bump the streak");
  assert.equal(stats.longestStreakDays, 1);
  assert.equal(stats.xpTotal, 6, "3 saves × 2 XP = 6");
});

dbSuite("Backdating last_activity_date then POSTing bumps to a longer streak", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  // Seed a row with a 3-day streak ending yesterday.
  const userId = (await prisma.user.findFirst({ where: { email: "demo@animbook.com" } }))?.id;
  const lex = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  const line = await prisma.line.findFirst({ where: { scene: { story: { isPublished: true } } } });
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  yesterday.setUTCHours(0, 0, 0, 0);
  await prisma.learnerStats.create({
    data: {
      userId,
      currentStreakDays: 3,
      longestStreakDays: 3,
      lastActivityDate: yesterday,
      timezone: "UTC"
    }
  });

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  // POST a vocab save (activity today) — streak should extend to 4.
  const res = await fetch(`${baseUrl}/api/lang/vocab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lexeme_id: lex.id, source_line_id: line.id })
  });
  assert.equal(res.status, 201);

  const stats = await prisma.learnerStats.findUnique({ where: { userId } });
  assert.equal(stats.currentStreakDays, 4, "yesterday + today = 4 days");
  assert.equal(stats.longestStreakDays, 4);
  assert.equal(stats.xpTotal, 2);
});

dbSuite("A 2-day gap resets the streak to 1", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const userId = (await prisma.user.findFirst({ where: { email: "demo@animbook.com" } }))?.id;
  const lex = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  const line = await prisma.line.findFirst({ where: { scene: { story: { isPublished: true } } } });
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  threeDaysAgo.setUTCHours(0, 0, 0, 0);
  await prisma.learnerStats.create({
    data: {
      userId,
      currentStreakDays: 5,
      longestStreakDays: 7,
      lastActivityDate: threeDaysAgo,
      timezone: "UTC"
    }
  });

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  await fetch(`${baseUrl}/api/lang/vocab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lexeme_id: lex.id, source_line_id: line.id })
  });

  const stats = await prisma.learnerStats.findUnique({ where: { userId } });
  assert.equal(stats.currentStreakDays, 1, "long gap resets the streak");
  assert.equal(stats.longestStreakDays, 7, "longest is preserved across resets");
});

dbSuite("GET /stats reflects the streak after backdating", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const userId = (await prisma.user.findFirst({ where: { email: "demo@animbook.com" } }))?.id;
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  threeDaysAgo.setUTCHours(0, 0, 0, 0);
  await prisma.learnerStats.create({
    data: {
      userId,
      currentStreakDays: 5,
      longestStreakDays: 7,
      lastActivityDate: threeDaysAgo,
      timezone: "UTC"
    }
  });

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  // GET /stats re-derives the streak against "now" — a 3-day gap
  // means current_streak should be 0 in the response, even though
  // the stored value is still 5.
  const res = await fetch(`${baseUrl}/api/lang/stats`);
  const body = await res.json();
  assert.equal(body.currentStreakDays, 0);
  assert.equal(body.longestStreakDays, 7);
});
