/**
 * Tests for AnimBook Languages Patch 07 — exercise attempts.
 *
 * Three parts:
 *   1. Pure-logic unit tests for `scoreAttempt()` — covers every
 *      exercise type's correct/wrong path without booting Express.
 *      This file imports the compiled module from dist so the test
 *      exercises the exact function the route calls.
 *   2. DB-backed HTTP round-trip — POST /api/lang/exercises/:id/attempts
 *      against the Spanish fixture (comprehension_mc + word_meaning_mc
 *      + listen_select).
 *   3. Pure-logic scoring edge cases (out-of-range scores, unknown
 *      types, etc.) — same scoreAttempt() function.
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
  await prisma.exerciseAttempt.deleteMany({});
  await prisma.learnerStats.deleteMany({});
  const result = await importLesson(prisma, raw);
  await prisma.story.update({ where: { id: result.storyId }, data: { isPublished: true } });
  return result;
}

/* --------------------------------------------------------------------- *
 * Part 1 — scoreAttempt() pure-logic unit tests
 * --------------------------------------------------------------------- */

async function loadScoreAttempt() {
  const mod = await import(pathToFileURL(routerPath).href);
  return mod.scoreAttempt;
}

test("scoreAttempt: comprehension_mc correct → 10 XP", async () => {
  const score = await loadScoreAttempt();
  const result = score(
    "comprehension_mc",
    { question: { en: "Q?", fr: "Q?" }, options: ["a", "b", "c"] },
    { index: 1 },
    { index: 1 }
  );
  assert.equal(result.isCorrect, true);
  assert.equal(result.xpAwarded, 10);
  assert.equal(result.score, null);
  assert.equal(result.correctIndex, 1);
});

test("scoreAttempt: comprehension_mc wrong → 0 XP", async () => {
  const score = await loadScoreAttempt();
  const result = score(
    "comprehension_mc",
    { options: ["a", "b", "c"] },
    { index: 1 },
    { index: 0 }
  );
  assert.equal(result.isCorrect, false);
  assert.equal(result.xpAwarded, 0);
  assert.equal(result.correctIndex, 1);
});

test("scoreAttempt: word_meaning_mc uses the same index comparison", async () => {
  const score = await loadScoreAttempt();
  const correct = score(
    "word_meaning_mc",
    { lexeme_id: "l1", options: { en: ["x", "y"], fr: ["x", "y"] } },
    { index: 0 },
    { index: 0 }
  );
  assert.equal(correct.isCorrect, true);
  assert.equal(correct.xpAwarded, 10);
});

test("scoreAttempt: listen_select correct → 10 XP", async () => {
  const score = await loadScoreAttempt();
  const result = score(
    "listen_select",
    { audio_url: "x", options: ["p", "q", "r"] },
    { index: 2 },
    { index: 2 }
  );
  assert.equal(result.isCorrect, true);
  assert.equal(result.xpAwarded, 10);
});

test("scoreAttempt: sentence_builder correct order → 10 XP", async () => {
  const score = await loadScoreAttempt();
  const result = score(
    "sentence_builder",
    { line_id: "L1", tokens: ["a", "b", "c", "d"] },
    { order: [2, 0, 3, 1] },
    { order: [2, 0, 3, 1] }
  );
  assert.equal(result.isCorrect, true);
  assert.equal(result.xpAwarded, 10);
});

test("scoreAttempt: sentence_builder wrong order → 0 XP", async () => {
  const score = await loadScoreAttempt();
  const result = score(
    "sentence_builder",
    { tokens: ["a", "b", "c", "d"] },
    { order: [2, 0, 3, 1] },
    { order: [0, 2, 3, 1] }
  );
  assert.equal(result.isCorrect, false);
  assert.equal(result.xpAwarded, 0);
});

test("scoreAttempt: sentence_builder requires exact length match", async () => {
  const score = await loadScoreAttempt();
  const result = score(
    "sentence_builder",
    { tokens: ["a", "b", "c"] },
    { order: [0, 1, 2] },
    { order: [0, 1] } // short
  );
  assert.equal(result.isCorrect, false);
});

test("scoreAttempt: speak_line score ≥ 60 → isCorrect + 5 XP", async () => {
  const score = await loadScoreAttempt();
  const result = score("speak_line", { line_id: "L1" }, {}, { score: 72, transcript: "hola" });
  assert.equal(result.isCorrect, true);
  assert.equal(result.score, 72);
  assert.equal(result.xpAwarded, 5);
});

test("scoreAttempt: speak_line score < 60 → not correct + 0 XP (still records)", async () => {
  const score = await loadScoreAttempt();
  const result = score("speak_line", { line_id: "L1" }, {}, { score: 40 });
  assert.equal(result.isCorrect, false);
  assert.equal(result.score, 40);
  assert.equal(result.xpAwarded, 0);
});

test("scoreAttempt: speak_line score clamps to 0..100", async () => {
  const score = await loadScoreAttempt();
  const high = score("speak_line", { line_id: "L1" }, {}, { score: 250 });
  assert.equal(high.score, 100, "score > 100 should clamp to 100");
  assert.equal(high.isCorrect, true);
  const low = score("speak_line", { line_id: "L1" }, {}, { score: -50 });
  assert.equal(low.score, 0, "score < 0 should clamp to 0");
  assert.equal(low.isCorrect, false);
});

test("scoreAttempt: speak_line threshold is exactly 60", async () => {
  const score = await loadScoreAttempt();
  const at = score("speak_line", {}, {}, { score: 60 });
  assert.equal(at.isCorrect, true, "score === 60 should pass");
  assert.equal(at.xpAwarded, 5);
  const justBelow = score("speak_line", {}, {}, { score: 59 });
  assert.equal(justBelow.isCorrect, false, "score === 59 should fail");
  assert.equal(justBelow.xpAwarded, 0);
});

test("scoreAttempt: unknown type returns no-op result (no crash)", async () => {
  const score = await loadScoreAttempt();
  const result = score("mystery_type", {}, {}, { index: 0 });
  assert.equal(result.isCorrect, false);
  assert.equal(result.xpAwarded, 0);
  assert.equal(result.score, null);
});

/* --------------------------------------------------------------------- *
 * Part 2 — DB-backed HTTP round-trips
 * --------------------------------------------------------------------- */

dbSuite("POST /exercises/:id/attempts scores a correct comprehension_mc + awards 10 XP", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const exercise = await prisma.exercise.findFirst({
    where: { type: "comprehension_mc" },
    include: { scene: { include: { story: true } } }
  });
  assert.ok(exercise, "fixture should have a comprehension_mc exercise");
  const answer = /** @type {{ index: number }} */ (exercise.answer);
  assert.equal(typeof answer.index, "number");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(
    `${baseUrl}/api/lang/exercises/${encodeURIComponent(exercise.id)}/attempts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index: answer.index })
    }
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.isCorrect, true);
  assert.equal(body.xpAwarded, 10);
  assert.equal(body.correctIndex, answer.index);

  // Confirm XP persisted on LearnerStats.
  const stats = await prisma.learnerStats.findFirst();
  assert.ok(stats);
  assert.ok(stats.xpTotal >= 10, `xpTotal should be >= 10, got ${stats.xpTotal}`);
});

dbSuite("POST /exercises/:id/attempts on a wrong MC records attempt but awards 0 XP", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const exercise = await prisma.exercise.findFirst({ where: { type: "comprehension_mc" } });
  assert.ok(exercise);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(
    `${baseUrl}/api/lang/exercises/${encodeURIComponent(exercise.id)}/attempts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index: 99 }) // intentionally wrong
    }
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.isCorrect, false);
  assert.equal(body.xpAwarded, 0);
  assert.equal(body.correctIndex, 1, "server should still surface the right index on a wrong attempt");

  const attempt = await prisma.exerciseAttempt.findFirst({ where: { exerciseId: exercise.id } });
  assert.ok(attempt, "wrong attempts still write a row");
  assert.equal(attempt.isCorrect, false);
});

dbSuite("POST /exercises/:id/attempts handles word_meaning_mc with substituted lexeme_id", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const exercise = await prisma.exercise.findFirst({
    where: { type: "word_meaning_mc" }
  });
  assert.ok(exercise, "fixture should have a word_meaning_mc exercise");
  // The Patch 07 importer substitution means the DB payload now
  // carries a real lexeme cuid, not the placeholder.
  const payload = /** @type {{ lexeme_id: string; options: { en: string[]; fr: string[] } }} */ (exercise.payload);
  assert.ok(payload.lexeme_id && !payload.lexeme_id.startsWith("<placeholder"), `lexeme_id should be substituted, got: ${payload.lexeme_id}`);

  const answer = /** @type {{ index: number }} */ (exercise.answer);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(
    `${baseUrl}/api/lang/exercises/${encodeURIComponent(exercise.id)}/attempts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index: answer.index })
    }
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.isCorrect, true);
  assert.equal(body.xpAwarded, 10);
});

dbSuite("POST /exercises/:id/attempts handles listen_select", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const exercise = await prisma.exercise.findFirst({ where: { type: "listen_select" } });
  assert.ok(exercise);
  const answer = /** @type {{ index: number }} */ (exercise.answer);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(
    `${baseUrl}/api/lang/exercises/${encodeURIComponent(exercise.id)}/attempts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index: answer.index })
    }
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.isCorrect, true);
  assert.equal(body.xpAwarded, 10);
});

dbSuite("POST /exercises/:id/attempts awards 5 XP for speak_line score ≥ 60", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });

  // speak_line isn't in the Spanish fixture (only en→es exercises are
  // comprehension_mc / word_meaning_mc / listen_select). Create one
  // ad-hoc so we can exercise the scoring path.
  const scene = await prisma.scene.findFirst();
  assert.ok(scene, "fixture should have at least one scene");
  const ex = await prisma.exercise.create({
    data: {
      sceneId: scene.id,
      order: 99,
      type: "speak_line",
      payload: { line_id: "L1" },
      answer: {}
    }
  });

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(
    `${baseUrl}/api/lang/exercises/${encodeURIComponent(ex.id)}/attempts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score: 85, transcript: "hola" })
    }
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.isCorrect, true);
  assert.equal(body.score, 85);
  assert.equal(body.xpAwarded, 5);
});

dbSuite("POST /exercises/:id/attempts awards 0 XP for speak_line score < 60", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });

  const scene2 = await prisma.scene.findFirst();
  assert.ok(scene2, "fixture should have at least one scene");
  // Use a fresh scene so we don't clash with the score ≥ 60 test's
  // (scene_id, order) unique constraint.
  const ex = await prisma.exercise.create({
    data: {
      sceneId: scene2.id,
      order: 98,
      type: "speak_line",
      payload: { line_id: "L2" },
      answer: {}
    }
  });

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(
    `${baseUrl}/api/lang/exercises/${encodeURIComponent(ex.id)}/attempts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score: 30 })
    }
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.isCorrect, false);
  assert.equal(body.xpAwarded, 0);
});

dbSuite("POST /exercises/:id/attempts returns 404 for an unknown exercise", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/exercises/no-such-ex/attempts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index: 0 })
  });
  assert.equal(res.status, 404);
});

dbSuite("POST /exercises/:id/attempts accumulates XP across multiple attempts", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const exercises = await prisma.exercise.findMany({
    where: { scene: { story: { masterStory: { slug: "market-morning" } } } }
  });
  assert.ok(exercises.length >= 3, `expected at least 3 exercises, got ${exercises.length}`);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  for (const ex of exercises) {
    const answer = /** @type {{ index: number }} */ (ex.answer);
    await fetch(
      `${baseUrl}/api/lang/exercises/${encodeURIComponent(ex.id)}/attempts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: answer.index })
      }
    );
  }

  // 3 correct MC attempts at 10 XP each = 30 XP.
  const stats = await prisma.learnerStats.findFirst();
  assert.ok(stats);
  assert.ok(stats.xpTotal >= 30, `xpTotal should be >= 30 after 3 correct MC attempts, got ${stats.xpTotal}`);
});