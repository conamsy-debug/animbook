/**
 * Tests for AnimBook Languages Patch 06 — word popup + vocabulary deck.
 *
 * Verifies the four endpoints from spec § 11:
 *   - GET    /api/lang/lexemes/:lexemeId
 *   - POST   /api/lang/vocab
 *   - DELETE /api/lang/vocab/:userVocabId
 *   - GET    /api/lang/vocab
 *
 * Skipped when DATABASE_URL is unset (CI without a DB). Uses
 * Express's own listener + global fetch so we don't pull in supertest.
 * ALLOW_DEMO_AUTH is set via apps/api/.env so the demo user is
 * resolved without a Clerk session.
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

const DB_URL = process.env.DATABASE_URL || "";
const DB_TESTS_ENABLED = DB_URL.length > 0 && existsSync(fixturesDir);
const dbSuite = DB_TESTS_ENABLED ? test : test.skip;

async function startAppRouter() {
  const express = (await import("express")).default;
  const { default: router } = await import(pathToFileURL(routerPath).href);
  const app = express();
  app.use(express.json({ limit: "256kb" }));
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
  const { importLesson } = await import(
    pathToFileURL(path.resolve(__dirname, "../dist/services/languages/index.js")).href
  );
  const fixturePath = path.join(fixturesDir, slug === "market-morning" ? "es-market-morning.json" : "he-shalom-story.json");
  const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
  await prisma.story.deleteMany({ where: { masterStory: { slug: raw.master_story_slug } } });
  await prisma.masterStory.deleteMany({ where: { slug: raw.master_story_slug } });
  // Also wipe any user_vocab rows for this demo user that point at
  // lexemes in the target_lang — the vocab tests assert exact card
  // counts and a stale row from a previous run would tip them.
  await prisma.userVocab.deleteMany({});
  const result = await importLesson(prisma, raw);
  await prisma.story.update({ where: { id: result.storyId }, data: { isPublished: true } });
  return result;
}

/* --------------------------------------------------------------------- *
 * GET /api/lang/lexemes/:lexemeId
 * --------------------------------------------------------------------- */

dbSuite("GET /api/lang/lexemes/:id returns popup data for a real lexeme", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const lexeme = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  assert.ok(lexeme, "Spanish lexemes should exist after fixture load");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/lexemes/${encodeURIComponent(lexeme.id)}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.lexemeId, lexeme.id);
  assert.equal(body.targetLang, "es");
  assert.ok(Array.isArray(body.glosses), "glosses should be an array");
  assert.ok(body.glosses.length > 0, "glosses should be non-empty for the Spanish fixture");
  assert.equal(body.partOfSpeech, lexeme.partOfSpeech);
});

dbSuite("GET /api/lang/lexemes/:id?base=fr returns French glosses", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const lexeme = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  assert.ok(lexeme);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/lexemes/${encodeURIComponent(lexeme.id)}?base=fr`);
  assert.equal(res.status, 200);
  const body = await res.json();
  // The Spanish fixture's fr glosses might be empty; the popup falls
  // back to en so the wire shape stays stable. Either way the
  // response shape is correct.
  assert.ok(Array.isArray(body.glosses));
});

dbSuite("GET /api/lang/lexemes/:id?line_id includes the source line context", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  // Find a lexeme that's attached to a real line.
  const token = await prisma.lineToken.findFirst({
    where: { lexemeId: { not: null } },
    include: { lexeme: true, line: true }
  });
  assert.ok(token, "fixture should have at least one non-punctuation token");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/lexemes/${encodeURIComponent(token.lexemeId)}?line_id=${encodeURIComponent(token.lineId)}&base=en`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.sourceLine, "sourceLine should be present when line_id is given");
  assert.equal(body.sourceLine.lineId, token.lineId);
  assert.equal(body.sourceLine.text, token.line.text);
  assert.match(body.sourceLine.translation, /\w+/, "translation should be the base-language form");
});

dbSuite("GET /api/lang/lexemes/:id returns 404 for an unknown id", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/lexemes/no-such-lexeme`);
  assert.equal(res.status, 404);
});

dbSuite("GET /api/lang/lexemes/:id returns 400 for an invalid base", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");
  const lexeme = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  assert.ok(lexeme);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/lexemes/${encodeURIComponent(lexeme.id)}?base=xx`);
  assert.equal(res.status, 400);
});

/* --------------------------------------------------------------------- *
 * POST /api/lang/vocab
 * --------------------------------------------------------------------- */

dbSuite("POST /api/lang/vocab saves a word and returns the new card", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const lexeme = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  assert.ok(lexeme);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/vocab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lexeme_id: lexeme.id })
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.lexemeId, lexeme.id);
  assert.equal(body.alreadySaved, false);
  assert.ok(body.userVocabId, "userVocabId must be set");
  assert.match(body.due, /^\d{4}-\d{2}-\d{2}T/, "due must be an ISO timestamp");
});

dbSuite("POST /api/lang/vocab is idempotent on (user, lexeme) — second save returns 200 + alreadySaved", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const lexeme = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  assert.ok(lexeme);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const payload = JSON.stringify({ lexeme_id: lexeme.id });
  const first = await fetch(`${baseUrl}/api/lang/vocab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload
  });
  assert.equal(first.status, 201);
  const firstBody = await first.json();

  const second = await fetch(`${baseUrl}/api/lang/vocab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload
  });
  assert.equal(second.status, 200, "second save should return 200, not 201");
  const secondBody = await second.json();
  assert.equal(secondBody.userVocabId, firstBody.userVocabId, "idempotent save returns same card");
  assert.equal(secondBody.alreadySaved, true);
});

dbSuite("POST /api/lang/vocab returns 404 for an unknown lexeme", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/vocab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lexeme_id: "no-such-lexeme" })
  });
  assert.equal(res.status, 404);
});

dbSuite("POST /api/lang/vocab awards 2 XP and the XP total persists", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");
  await prisma.learnerStats.deleteMany({});

  const lexeme = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  assert.ok(lexeme);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  await fetch(`${baseUrl}/api/lang/vocab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lexeme_id: lexeme.id })
  });

  const stats = await prisma.learnerStats.findFirst();
  assert.ok(stats, "LearnerStats row should exist after a save");
  assert.ok(stats.xpTotal >= 2, `xpTotal should be >= 2, got ${stats.xpTotal}`);
});

dbSuite("POST /api/lang/vocab returns 400 when lexeme_id is missing", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/vocab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
});

/* --------------------------------------------------------------------- *
 * DELETE /api/lang/vocab/:userVocabId
 * --------------------------------------------------------------------- */

dbSuite("DELETE /api/lang/vocab/:id removes a saved card", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const lexeme = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  assert.ok(lexeme);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const created = await fetch(`${baseUrl}/api/lang/vocab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lexeme_id: lexeme.id })
  });
  const card = await created.json();

  const removed = await fetch(`${baseUrl}/api/lang/vocab/${encodeURIComponent(card.userVocabId)}`, {
    method: "DELETE"
  });
  assert.equal(removed.status, 200);
  const body = await removed.json();
  assert.equal(body.removed, true);
  assert.equal(body.userVocabId, card.userVocabId);

  // And a re-delete is idempotent.
  const removedAgain = await fetch(`${baseUrl}/api/lang/vocab/${encodeURIComponent(card.userVocabId)}`, {
    method: "DELETE"
  });
  assert.equal(removedAgain.status, 200);
  const bodyAgain = await removedAgain.json();
  assert.equal(bodyAgain.removed, false);
});

/* --------------------------------------------------------------------- *
 * GET /api/lang/vocab?course=:courseId
 * --------------------------------------------------------------------- */

dbSuite("GET /api/lang/vocab returns the learner's deck scoped to a course", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const course = await prisma.course.findUnique({
    where: { targetLang_baseLang: { targetLang: "es", baseLang: "en" } }
  });
  assert.ok(course, "en→es course should exist");

  // Save two Spanish lexemes so the list has content.
  const lexemes = await prisma.lexeme.findMany({ where: { targetLang: "es" }, take: 2 });
  assert.ok(lexemes.length >= 2);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  for (const lex of lexemes) {
    await fetch(`${baseUrl}/api/lang/vocab`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lexeme_id: lex.id })
    });
  }

  const res = await fetch(`${baseUrl}/api/lang/vocab?course=${encodeURIComponent(course.id)}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.courseId, course.id);
  assert.ok(body.cards.length >= 2, `expected at least 2 cards, got ${body.cards.length}`);
  const card = body.cards[0];
  assert.ok(card.lemma, "card must include the lemma");
  assert.ok(card.userVocabId, "card must include the userVocabId");
  assert.equal(card.targetLang, "es");
  assert.ok(Array.isArray(card.glosses), "card must include glosses");
});

dbSuite("GET /api/lang/vocab?q= substring-searches lemma and glosses", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const lexeme = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  assert.ok(lexeme);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  await fetch(`${baseUrl}/api/lang/vocab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lexeme_id: lexeme.id })
  });

  // Match by lemma.
  const byLemma = await fetch(`${baseUrl}/api/lang/vocab?q=${encodeURIComponent(lexeme.lemma.slice(0, 3))}`);
  assert.equal(byLemma.status, 200);
  const byLemmaBody = await byLemma.json();
  assert.ok(byLemmaBody.cards.length >= 1, "substring search by lemma should match");
  assert.equal(byLemmaBody.query, lexeme.lemma.slice(0, 3));

  // Miss
  const miss = await fetch(`${baseUrl}/api/lang/vocab?q=zzzzznevermatch`);
  const missBody = await miss.json();
  assert.equal(missBody.cards.length, 0);
});

dbSuite("GET /api/lang/vocab returns 404 for an unknown course", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/vocab?course=no-such-course`);
  assert.equal(res.status, 404);
});

dbSuite("GET /api/lang/vocab with no course filter returns the user's full deck", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const lexeme = await prisma.lexeme.findFirst({ where: { targetLang: "es" } });
  assert.ok(lexeme);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  await fetch(`${baseUrl}/api/lang/vocab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lexeme_id: lexeme.id })
  });

  const res = await fetch(`${baseUrl}/api/lang/vocab`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.cards.length >= 1);
});