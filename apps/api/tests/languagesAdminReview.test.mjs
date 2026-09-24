/**
 * Tests for AnimBook Languages Patch 12 — admin review screen.
 *
 * Two parts:
 *   1. Pure-helper tests for the TTS adapter (`resolveTtsProvider`,
 *      `pickVoiceForSpeaker`).
 *   2. DB-backed HTTP round-trips for the admin review endpoints
 *      (`GET /admin/stories`, `GET /admin/stories/:id`,
 *       `PUT /admin/stories/:id`, `POST /admin/lines/:id/regenerate-audio`,
 *       `POST /admin/stories/:id/approve`,
 *       `POST /admin/stories/:id/reject`) plus the
 *      "only approved stories appear to learners" filter on
 *      `GET /stories/:storyId`.
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
  await prisma.languagesAdaptationJob.deleteMany({});
  const demoUser = await prisma.user.findUnique({ where: { email: "demo@animbook.com" } });
  if (demoUser && !demoUser.roles.includes("platform_admin")) {
    await prisma.user.update({
      where: { id: demoUser.id },
      data: { roles: [...demoUser.roles, "platform_admin"] }
    });
  }
  const result = await importLesson(prisma, raw);
  await prisma.story.update({
    where: { id: result.storyId },
    data: { isPublished: true, reviewStatus: "in_review" }
  });
  return result;
}

/* --------------------------------------------------------------------- *
 * Part 1 — pure helpers
 * --------------------------------------------------------------------- */

test("resolveTtsProvider: returns noop when no API key is configured", async () => {
  const { resolveTtsProvider } = await import(pathToFileURL(servicesPath).href);
  // Save + restore the env so the test is deterministic.
  const prev = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    const p = resolveTtsProvider();
    assert.equal(p.isConfigured(), false);
    assert.equal(p.name, "noop");
    const out = await p.synthesize({
      text: "hola",
      storageKey: "test.mp3",
      strict: false
    });
    assert.equal(out.audioUrl, null);
    assert.equal(out.source, "stub");
  } finally {
    if (prev !== undefined) process.env.ELEVENLABS_API_KEY = prev;
  }
});

test("resolveTtsProvider: returns ElevenLabsTtsProvider when key is set", async () => {
  const { resolveTtsProvider } = await import(pathToFileURL(servicesPath).href);
  const prev = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "sk-test-fake";
  try {
    const p = resolveTtsProvider();
    assert.equal(p.name, "elevenlabs");
    assert.equal(p.isConfigured(), true);
  } finally {
    if (prev !== undefined) process.env.ELEVENLABS_API_KEY = prev;
    else delete process.env.ELEVENLABS_API_KEY;
  }
});

test("pickVoiceForSpeaker: narrator → voices.narrator", async () => {
  const { pickVoiceForSpeaker } = await import(pathToFileURL(servicesPath).href);
  // No language row → returns null (dev path).
  const v = await pickVoiceForSpeaker("zz-no-such-lang", "narrator");
  assert.equal(v, null);
});

/* --------------------------------------------------------------------- *
 * Part 2 — DB-backed HTTP round-trips
 * --------------------------------------------------------------------- */

dbSuite("GET /admin/stories returns the in_review queue", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/admin/stories?status=in_review`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.stories));
  assert.ok(body.stories.length >= 1);
  const ids = body.stories.map((s) => s.id);
  assert.ok(ids.includes((await loadFixture.toString(), body.stories[0].id)));
  assert.equal(body.stories[0].targetLang, "es");
  assert.equal(body.stories[0].reviewStatus, "in_review");
});

dbSuite("GET /admin/stories returns 400 for an invalid status filter", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/admin/stories?status=garbage`);
  assert.equal(res.status, 400);
});

dbSuite("GET /admin/stories/:id returns the full scene/line/exercise tree", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  const loaded = await loadFixture(prisma, "market-morning");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(
    `${baseUrl}/api/lang/admin/stories/${encodeURIComponent(loaded.storyId)}`
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.id, loaded.storyId);
  assert.equal(body.targetLang, "es");
  assert.ok(Array.isArray(body.scenes));
  assert.ok(body.scenes.length >= 1);
  assert.ok(Array.isArray(body.scenes[0].lines));
  assert.ok(body.scenes[0].lines.length >= 1);
  assert.ok(Array.isArray(body.scenes[0].exercises));
  assert.equal(typeof body.scenes[0].lines[0].text, "string");
});

dbSuite("GET /admin/stories/:id returns 404 for an unknown id", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/admin/stories/no-such-story`);
  assert.equal(res.status, 404);
});

dbSuite("PUT /admin/stories/:id edits a line's text + reviewer notes", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  const loaded = await loadFixture(prisma, "market-morning");

  const line = await prisma.line.findFirst({
    where: { scene: { storyId: loaded.storyId } },
    orderBy: { order: "asc" }
  });
  assert.ok(line);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const newText = `PATCHED-${Date.now()}`;
  const res = await fetch(
    `${baseUrl}/api/lang/admin/stories/${encodeURIComponent(loaded.storyId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewerNotes: "Updated via Patch 12 PUT test.",
        lines: [{ id: line.id, text: newText }]
      })
    }
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  const updated = body.scenes.flatMap((s) => s.lines).find((l) => l.id === line.id);
  assert.equal(updated.text, newText);

  // Persisted?
  const after = await prisma.line.findUnique({ where: { id: line.id } });
  assert.equal(after.text, newText);

  const story = await prisma.story.findUnique({ where: { id: loaded.storyId } });
  assert.equal(story.reviewerNotes, "Updated via Patch 12 PUT test.");
});

dbSuite("PUT /admin/stories/:id rejects malformed body with 400", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  const loaded = await loadFixture(prisma, "market-morning");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(
    `${baseUrl}/api/lang/admin/stories/${encodeURIComponent(loaded.storyId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: 42 })
    }
  );
  assert.equal(res.status, 400);
});

dbSuite("POST /admin/lines/:id/regenerate-audio returns a stub when no TTS key", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  const loaded = await loadFixture(prisma, "market-morning");

  const line = await prisma.line.findFirst({
    where: { scene: { storyId: loaded.storyId } }
  });
  assert.ok(line);

  // Strip ELEVENLABS so the stub path runs.
  const prev = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => {
    if (prev !== undefined) process.env.ELEVENLABS_API_KEY = prev;
    server.close(() => r());
  }));

  const res = await fetch(
    `${baseUrl}/api/lang/admin/lines/${encodeURIComponent(line.id)}/regenerate-audio`,
    { method: "POST" }
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.lineId, line.id);
  assert.equal(body.source, "stub");
  assert.equal(body.audioUrl, null);
});

dbSuite("POST /admin/lines/:id/regenerate-audio returns 404 for unknown id", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(
    `${baseUrl}/api/lang/admin/lines/no-such-line/regenerate-audio`,
    { method: "POST" }
  );
  assert.equal(res.status, 404);
});

dbSuite("POST /admin/stories/:id/approve flips reviewStatus + isPublished", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  const loaded = await loadFixture(prisma, "market-morning");

  // Start from in_review, not yet approved.
  await prisma.story.update({
    where: { id: loaded.storyId },
    data: { reviewStatus: "in_review", isPublished: false }
  });

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(
    `${baseUrl}/api/lang/admin/stories/${encodeURIComponent(loaded.storyId)}/approve`,
    { method: "POST" }
  );
  assert.equal(res.status, 200);
  const after = await prisma.story.findUnique({ where: { id: loaded.storyId } });
  assert.equal(after.reviewStatus, "approved");
  assert.equal(after.isPublished, true);
  assert.ok(after.reviewerId, "reviewer_id should be set");
});

dbSuite("POST /admin/stories/:id/reject requires non-empty notes", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  const loaded = await loadFixture(prisma, "market-morning");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  // Empty string
  const r1 = await fetch(
    `${baseUrl}/api/lang/admin/stories/${encodeURIComponent(loaded.storyId)}/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "" })
    }
  );
  assert.equal(r1.status, 400);

  // Missing field
  const r2 = await fetch(
    `${baseUrl}/api/lang/admin/stories/${encodeURIComponent(loaded.storyId)}/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }
  );
  assert.equal(r2.status, 400);
});

dbSuite("POST /admin/stories/:id/reject flips reviewStatus + persists notes", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  const loaded = await loadFixture(prisma, "market-morning");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(
    `${baseUrl}/api/lang/admin/stories/${encodeURIComponent(loaded.storyId)}/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "Translation awkward in line 3." })
    }
  );
  assert.equal(res.status, 200);
  const after = await prisma.story.findUnique({ where: { id: loaded.storyId } });
  assert.equal(after.reviewStatus, "rejected");
  assert.equal(after.isPublished, false);
  assert.equal(after.reviewerNotes, "Translation awkward in line 3.");
  assert.ok(after.reviewerId);
});

dbSuite("GET /stories/:storyId returns 404 when story is not approved (learner gate)", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  const loaded = await loadFixture(prisma, "market-morning");

  // Force in_review (not approved) — the fixture sets isPublished=true; flip it.
  await prisma.story.update({
    where: { id: loaded.storyId },
    data: { isPublished: false, reviewStatus: "in_review" }
  });

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(
    `${baseUrl}/api/lang/stories/${encodeURIComponent(loaded.storyId)}?base=en`
  );
  assert.equal(res.status, 404);
});

dbSuite("GET /stories/:storyId returns the player payload when approved", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  const loaded = await loadFixture(prisma, "market-morning");

  // Ensure approved + published.
  await prisma.story.update({
    where: { id: loaded.storyId },
    data: { isPublished: true, reviewStatus: "approved" }
  });

  // The player payload uses the synthetic `story:<master_slug>:<targetLang>`
  // id (Patch 04 contract). The DB stores the slug, not the cuid, on
  // MasterStory.slug, so look it up to compare.
  const masterStory = await prisma.masterStory.findUnique({
    where: { id: loaded.masterStoryId },
    select: { slug: true }
  });
  assert.ok(masterStory);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(
    `${baseUrl}/api/lang/stories/${encodeURIComponent(loaded.storyId)}?base=en`
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.storyId, `story:${masterStory.slug}:es`);
  assert.equal(body.targetLang, "es");
  assert.ok(Array.isArray(body.scenes));
  assert.ok(body.scenes.length >= 1);
});

dbSuite("Admin endpoints reject non-admin callers with 403", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  // Strip the platform_admin role so the gate fires.
  const demo = await prisma.user.findUnique({ where: { email: "demo@animbook.com" } });
  const prevRoles = demo.roles;
  await prisma.user.update({
    where: { id: demo.id },
    data: { roles: [] }
  });

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise(async (r) => {
    await prisma.user.update({
      where: { id: demo.id },
      data: { roles: prevRoles }
    });
    server.close(() => r());
  }));

  const res = await fetch(`${baseUrl}/api/lang/admin/stories`);
  assert.equal(res.status, 403);
});