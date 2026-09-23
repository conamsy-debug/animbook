/**
 * Tests for AnimBook Languages Patch 05 — onboarding, enrollments,
 * course home, story progress save. Skipped when DATABASE_URL is unset
 * (CI without a DB).
 *
 * The test spins up Express with the compiled languages router on an
 * ephemeral port and hits it via global fetch — same pattern as the
 * Patch 04 player test. ALLOW_DEMO_AUTH is set via apps/api/.env so
 * the demo user is resolved without a Clerk session.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// From `apps/api/tests/<file>.mjs`, the fixtures live one level up at
// `<api-root>/prisma/languages-fixtures`.
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
  const raw = JSON.parse((await import("node:fs")).readFileSync(fixturePath, "utf8"));
  await prisma.story.deleteMany({ where: { masterStory: { slug: raw.master_story_slug } } });
  await prisma.masterStory.deleteMany({ where: { slug: raw.master_story_slug } });
  const result = await importLesson(prisma, raw);
  // The importer defaults Story.isPublished to false (admin review
  // gate). Tests need the story visible to /courses/:id and the
  // player payload, so we flip the flag after import.
  await prisma.story.update({ where: { id: result.storyId }, data: { isPublished: true } });
  return result;
}

dbSuite("GET /api/lang/languages returns the 7-language catalog with font + direction", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/languages`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.languages), "response should have a languages array");
  const codes = body.languages.map((l) => l.code);
  for (const required of ["en", "fr", "es", "zh-Hans", "de", "it", "he"]) {
    assert.ok(codes.includes(required), `catalog missing ${required}, got ${codes.join(", ")}`);
  }
  const he = body.languages.find((l) => l.code === "he");
  assert.equal(he.direction, "rtl", "Hebrew must be RTL");
  assert.match(he.fontFamily, /Noto Sans Hebrew/, "Hebrew fontFamily must include Noto Sans Hebrew");
  const zh = body.languages.find((l) => l.code === "zh-Hans");
  assert.equal(zh.direction, "ltr", "Chinese must be LTR");
  assert.match(zh.fontFamily, /Noto Sans SC/, "Chinese fontFamily must include Noto Sans SC");
});

dbSuite("GET /api/lang/courses?base=en returns the 5 published courses for English-base learners", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/courses?base=en`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.base, "en");
  assert.ok(body.courses.length >= 5, `expected at least 5 courses for base=en, got ${body.courses.length}`);
  const targets = body.courses.map((c) => c.targetLang).sort();
  for (const expected of ["es", "zh-Hans", "de", "it", "he"]) {
    assert.ok(targets.includes(expected), `base=en should include ${expected}`);
  }
});

dbSuite("GET /api/lang/courses?base=fr returns courses for French-base learners", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/courses?base=fr`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.base, "fr");
  assert.ok(body.courses.length >= 5);
  const targets = body.courses.map((c) => c.targetLang);
  // The seed only excludes target === base, so base=fr should NOT have fr-as-target
  assert.ok(!targets.includes("fr"), "base=fr should NOT include fr-as-target");
});

dbSuite("GET /api/lang/courses returns 400 for an invalid base", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/courses?base=xx`);
  assert.equal(res.status, 400);
});

dbSuite("POST /api/lang/enrollments creates an enrollment and POST /enrollments/me lists it", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const createRes = await fetch(`${baseUrl}/api/lang/enrollments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_lang: "es", base_lang: "en" })
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.equal(created.targetLang, "es");
  assert.equal(created.baseLang, "en");
  assert.ok(created.enrollmentId);

  const listRes = await fetch(`${baseUrl}/api/lang/enrollments/me`);
  assert.equal(listRes.status, 200);
  const listed = await listRes.json();
  const found = listed.enrollments.find((e) => e.enrollmentId === created.enrollmentId);
  assert.ok(found, "newly created enrollment should appear in /enrollments/me");
  assert.equal(found.targetLang, "es");
});

dbSuite("POST /api/lang/enrollments is idempotent on (user, course)", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const body = JSON.stringify({ target_lang: "it", base_lang: "en" });
  const first = await fetch(`${baseUrl}/api/lang/enrollments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
  assert.equal(first.status, 201);
  const firstData = await first.json();
  const second = await fetch(`${baseUrl}/api/lang/enrollments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
  assert.equal(second.status, 201);
  const secondData = await second.json();
  assert.equal(secondData.enrollmentId, firstData.enrollmentId, "idempotent re-enroll should reuse the same enrollment");
});

dbSuite("POST /api/lang/enrollments rejects target === base", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/enrollments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_lang: "en", base_lang: "en" })
  });
  assert.equal(res.status, 400);
});

dbSuite("GET /api/lang/courses/:courseId returns course metadata + stories + stats", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });

  // Make sure the Spanish story exists by re-importing the fixture.
  await loadFixture(prisma, "market-morning");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  // Find the en→es course id from the seed.
  const course = await prisma.course.findUnique({
    where: { targetLang_baseLang: { targetLang: "es", baseLang: "en" } }
  });
  assert.ok(course, "en→es course should exist after seed");

  const res = await fetch(`${baseUrl}/api/lang/courses/${encodeURIComponent(course.id)}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.course.targetLang, "es");
  assert.equal(body.course.baseLang, "en");
  assert.ok(body.stories.length >= 1, "course should have at least one story");
  const story = body.stories[0];
  assert.match(story.storyId, /^story:market-morning:es$/);
  assert.equal(story.cefrLevel, "A1");
  // Without an enrollment, progress is null
  assert.equal(story.progress, null);
});

dbSuite("POST /api/lang/stories/:storyId/progress upserts a StoryProgress + touches LearnerStats", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });

  await loadFixture(prisma, "market-morning");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  // First save
  const res1 = await fetch(`${baseUrl}/api/lang/stories/${encodeURIComponent("story:market-morning:es")}/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ last_scene_order: 1, score_pct: 0 })
  });
  assert.equal(res1.status, 200);
  const first = await res1.json();
  assert.equal(first.status, "in_progress");
  assert.equal(first.lastSceneOrder, 1);

  // Mark complete
  const res2 = await fetch(`${baseUrl}/api/lang/stories/${encodeURIComponent("story:market-morning:es")}/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ last_scene_order: 2, score_pct: 100, completed: true })
  });
  assert.equal(res2.status, 200);
  const second = await res2.json();
  assert.equal(second.status, "completed");
  assert.ok(second.completedAt, "completedAt must be set when completed=true");
});

dbSuite("POST /api/lang/stories/:storyId/progress returns 404 for an unknown story id", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/stories/${encodeURIComponent("story:nope:es")}/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ last_scene_order: 1 })
  });
  assert.equal(res.status, 404);
});