/**
 * Tests for AnimBook Languages Patch 11 — content pipeline.
 *
 * Two parts:
 *   1. Pure-logic unit tests for the LLM adapter: prompt
 *      composition, JSON fence stripping, the retry loop on parse
 *      failure, and the `LessonAdaptationError` shape. These run
 *      against a stubbed `LlmProvider` so no real API calls leak.
 *   2. DB-backed HTTP round-trips for the admin endpoints
 *      (`POST /admin/master-stories`,
 *       `POST /admin/master-stories/:id/adapt`,
 *       `GET /admin/jobs/:jobId`) and the orchestrator's
 *      `runAdaptationJob()` flow with a stubbed LLM.
 *
 * Skipped when DATABASE_URL is unset.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Wrapper for `readFileSync` inside test bodies so we don't have to
 *  shadow the import above (the old name readFileSyncSync was a
 *  copy-paste mistake). */
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

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
  // Patch 11: adaptation jobs can outlive their master story so we
  // don't CASCADE them — wipe explicitly between runs.
  await prisma.languagesAdaptationJob.deleteMany({});
  // Promote the demo user to platform admin so the admin routes'
  // `requireAdmin()` check passes (CLERK=OFF, ALLOW_DEMO_AUTH=true
  // → authMiddleware falls through to `resolveDemoUserId()` →
  // sets req.userId to demo@animbook.com). Read existing roles
  // first so we don't wipe anything else the demo user carries.
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
    data: { isPublished: true }
  });
  return result;
}

/* --------------------------------------------------------------------- *
 * Part 1 — pure helpers
 * --------------------------------------------------------------------- */

async function loadLlm() {
  return await import(pathToFileURL(servicesPath).href);
}

test("promptFor: includes target_lang + style guide + master script", async () => {
  const { promptFor } = await loadLlm();
  const masterScript = {
    scenes: [
      {
        order: 1,
        lines: [{ speaker: "ana", text: "Hello.", translation_en: "Hello.", image_prompt: "a market" }]
      }
    ]
  };
  const prompt = promptFor({ masterScript, targetLang: "es", baseLang: "en" });
  assert.ok(prompt.includes('"target_lang"'));
  assert.ok(prompt.includes("Castilian Spanish"));
  assert.ok(prompt.includes('"Hello."'));
  assert.ok(prompt.includes("translations"));
});

test("promptFor: target-specific style guide for he + zh + fr", async () => {
  const { promptFor } = await loadLlm();
  const masterScript = { scenes: [] };
  const en = promptFor({ masterScript, targetLang: "en", baseLang: "en" });
  const fr = promptFor({ masterScript, targetLang: "fr", baseLang: "en" });
  const he = promptFor({ masterScript, targetLang: "he", baseLang: "en" });
  // EN isn't in the guide → falls back to "CEFR A1 en." generic.
  assert.ok(en.includes("CEFR A1 en"));
  assert.ok(fr.includes("European French"));
  assert.ok(he.includes("niqqud"));
});

test("adaptWithRetry: returns the validated lesson on first attempt", async () => {
  const { adaptWithRetry, AnthropicLlmProvider } = await loadLlm();
  // Build a tiny but valid lesson — uses the same importLesson fixture
  // shape so parseLesson accepts it.
  const validLesson = readJson(path.join(fixturesDir, "es-market-morning.json"));
  const fakeAdapter = {
    name: "stub",
    isConfigured: () => true,
    adaptMasterStory: async () => JSON.stringify(validLesson)
  };
  const out = await adaptWithRetry(fakeAdapter, {
    masterScript: { scenes: [] },
    targetLang: "es",
    baseLang: "en"
  }, { maxAttempts: 3 });
  assert.equal(out.attempts, 1);
  assert.equal(out.lesson.target_lang, "es");
  void AnthropicLlmProvider; // unused but referenced for tree-shaking
});

test("adaptWithRetry: retries on parse failure + succeeds on attempt 2", async () => {
  const { adaptWithRetry } = await loadLlm();
  const validLesson = readJson(path.join(fixturesDir, "es-market-morning.json"));
  let calls = 0;
  const stub = {
    name: "flaky",
    isConfigured: () => true,
    adaptMasterStory: async () => {
      calls++;
      if (calls === 1) return "{ not json";
      return JSON.stringify(validLesson);
    }
  };
  const out = await adaptWithRetry(stub, {
    masterScript: { scenes: [] },
    targetLang: "es",
    baseLang: "en"
  }, { maxAttempts: 3 });
  assert.equal(out.attempts, 2);
  assert.equal(calls, 2);
});

test("adaptWithRetry: throws LessonAdaptationError after maxAttempts", async () => {
  const { adaptWithRetry, LessonAdaptationError } = await loadLlm();
  const stub = {
    name: "broken",
    isConfigured: () => true,
    adaptMasterStory: async () => "{ still not json"
  };
  await assert.rejects(
    adaptWithRetry(stub, {
      masterScript: { scenes: [] },
      targetLang: "es",
      baseLang: "en"
    }, { maxAttempts: 2 }),
    (err) => err instanceof LessonAdaptationError && err.rawText === "{ still not json"
  );
});

test("resolveLlmProvider: returns the noop provider when no API key", async () => {
  const { resolveLlmProvider } = await loadLlm();
  const p = resolveLlmProvider({});
  assert.equal(p.isConfigured(), false);
  assert.equal(p.name, "noop");
  await assert.rejects(
    p.adaptMasterStory({ masterScript: { scenes: [] }, targetLang: "es", baseLang: "en" }),
    /No LlmProvider/
  );
});

test("resolveLlmProvider: returns AnthropicLlmProvider when key is set", async () => {
  const { resolveLlmProvider } = await loadLlm();
  const p = resolveLlmProvider({ anthropicApiKey: "sk-test-fake" });
  assert.equal(p.name, "anthropic_claude");
  assert.equal(p.isConfigured(), true);
});

/* --------------------------------------------------------------------- *
 * Part 2 — DB-backed HTTP round-trips
 * --------------------------------------------------------------------- */

dbSuite("POST /admin/master-stories creates a draft master story", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const body = {
    slug: "the-lion-and-the-mouse",
    titleEn: "The Lion and the Mouse",
    synopsis: "A small mouse repays a great lion.",
    targetLang: "en",
    masterScript: {
      scenes: [
        {
          order: 1,
          lines: [
            {
              speaker: "lion",
              text: "I will eat you!",
              translation_en: "I will eat you!",
              image_prompt: "a lion roaring"
            }
          ]
        }
      ]
    },
    targetVocabConcepts: ["animals", "kindness", "gratitude"],
    cefrLevel: "A1"
  };

  const res = await fetch(`${baseUrl}/api/lang/admin/master-stories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.ok(out.masterStoryId);
  assert.equal(out.slug, "the-lion-and-the-mouse");
  assert.equal(out.animationStatus, "pending");

  // Confirm the row landed.
  const row = await prisma.masterStory.findUnique({ where: { id: out.masterStoryId } });
  assert.ok(row);
});

dbSuite("POST /admin/master-stories returns 409 on duplicate slug", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const body = {
    slug: "dup-test",
    titleEn: "Dup",
    synopsis: "x",
    targetLang: "en",
    masterScript: { scenes: [] },
    targetVocabConcepts: []
  };

  const r1 = await fetch(`${baseUrl}/api/lang/admin/master-stories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  assert.equal(r1.status, 201);

  const r2 = await fetch(`${baseUrl}/api/lang/admin/master-stories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  assert.equal(r2.status, 409);
});

dbSuite("POST /admin/master-stories/:id/adapt enqueues one job per target lang", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  // Create a master story first.
  const created = await fetch(`${baseUrl}/api/lang/admin/master-stories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug: "lion-mouse",
      titleEn: "Lion",
      synopsis: "x",
      targetLang: "en",
      masterScript: { scenes: [] },
      targetVocabConcepts: []
    })
  });
  const { masterStoryId } = await created.json();

  const res = await fetch(`${baseUrl}/api/lang/admin/master-stories/${masterStoryId}/adapt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_langs: ["es", "fr"] })
  });
  assert.equal(res.status, 202);
  const out = await res.json();
  assert.equal(out.jobs.length, 2);
  assert.deepEqual(out.jobs.map((j) => j.targetLang).sort(), ["es", "fr"]);

  // Confirm DB rows landed with status=queued.
  const rows = await prisma.languagesAdaptationJob.findMany({
    where: { masterStoryId }
  });
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(r.status, "queued");
});

dbSuite("GET /admin/jobs/:jobId returns the queued job's status", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const created = await fetch(`${baseUrl}/api/lang/admin/master-stories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug: "job-status",
      titleEn: "x",
      synopsis: "x",
      targetLang: "en",
      masterScript: { scenes: [] },
      targetVocabConcepts: []
    })
  });
  const { masterStoryId } = await created.json();
  await fetch(`${baseUrl}/api/lang/admin/master-stories/${masterStoryId}/adapt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_langs: ["es"] })
  });

  const row = await prisma.languagesAdaptationJob.findFirst({
    where: { masterStoryId, targetLang: "es" }
  });
  assert.ok(row);

  const res = await fetch(`${baseUrl}/api/lang/admin/jobs/${row.id}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.jobId, row.id);
  assert.equal(body.status, "queued");
  assert.equal(body.targetLang, "es");
  assert.equal(body.masterStoryId, masterStoryId);
  assert.equal(body.resultStoryId, null);
});

dbSuite("GET /admin/jobs/:jobId returns 404 for unknown id", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/admin/jobs/no-such-job`);
  assert.equal(res.status, 404);
});

dbSuite("runAdaptationJob: stubbed LLM writes a Story + flips the job to completed", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const { runAdaptationJob } = await import(pathToFileURL(servicesPath).href);

  // Wipe any master stories from earlier runs of this test so the
  // unique-slug constraint doesn't trip on a half-run retry.
  await prisma.story.deleteMany({ where: { masterStory: { slug: "adapt-stub" } } });
  await prisma.masterStory.deleteMany({ where: { slug: "adapt-stub" } });

  // Create a master story.
  const master = await prisma.masterStory.create({
    data: {
      slug: "adapt-stub",
      titleEn: "Adapt",
      cefrLevel: "A1",
      synopsis: "Test",
      targetLang: "en",
      masterScript: {
        scenes: [
          {
            order: 1,
            lines: [
              {
                speaker: "ana",
                text: "Hola",
                translation_en: "Hello",
                image_prompt: "..."
              }
            ]
          }
        ]
      },
      targetVocabConcepts: ["greetings"],
      animationStatus: "pending"
    }
  });

  // Write a queued job.
  const job = await prisma.languagesAdaptationJob.create({
    data: { masterStoryId: master.id, targetLang: "es", status: "queued" }
  });

  // Build a stub provider that echoes the Spanish fixture (with the
  // master slug patched to match the new master story).
  const spanishFixture = readJson(path.join(fixturesDir, "es-market-morning.json"));
  spanishFixture.master_story_slug = master.slug;
  const stubProvider = {
    name: "stub",
    isConfigured: () => true,
    adaptMasterStory: async () => JSON.stringify(spanishFixture)
  };

  await runAdaptationJob(job.id, { provider: stubProvider });

  // Confirm the job moved through the lifecycle and produced a
  // Story row.
  const after = await prisma.languagesAdaptationJob.findUnique({ where: { id: job.id } });
  assert.equal(after.status, "completed", `expected completed, got ${after.status}; error=${after.errorMessage}`);
  assert.ok(after.resultStoryId, "result_story_id should be set on success");
  assert.ok(after.completedAt, "completed_at should be set on success");
  assert.equal(after.attempts, 1);

  const newStory = await prisma.story.findUnique({ where: { id: after.resultStoryId } });
  assert.ok(newStory);
  assert.equal(newStory.targetLang, "es");
});
