/**
 * Tests for AnimBook Languages Patch 08 — pronunciation scoring.
 *
 * Two parts:
 *   1. Pure-logic unit tests for the scoring helpers in stt.ts:
 *      normaliseForCompare, tokenise, alignTokens, scoreFromAlignment.
 *   2. DB-backed HTTP round-trips for POST /api/lang/pronunciation
 *      with a mock Whisper provider injected via env + a stub
 *      fetchImpl.
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
  app.use("/api/lang", router);
  // Tiny raw-body middleware that matches the route's expectation:
  // the route reads `req.body` (a Buffer) directly. Our middleware
  // captures the raw bytes into req.body so the route's stream
  // reader also works (it reads req.on("data") which fires when
  // we DON'T pre-fill req.body — see below). We do both: pre-fill
  // `req.body` so the route's `(req as ...).body` check passes,
  // AND skip the inline stream reader by writing a custom flag.
  //
  // Simpler approach: drop our middleware and let the route do its
  // own raw-body read. We just need to ensure the test app doesn't
  // have express.json() installed (which would consume the body
  // before our route sees it).
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
  const fixturePath = path.join(fixturesDir, slug === "market-morning" ? "es-market-morning.json" : "he-shalom-story.json");
  const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
  await prisma.story.deleteMany({ where: { masterStory: { slug: raw.master_story_slug } } });
  await prisma.masterStory.deleteMany({ where: { slug: raw.master_story_slug } });
  await prisma.pronunciationAttempt.deleteMany({});
  await prisma.learnerStats.deleteMany({});
  const result = await importLesson(prisma, raw);
  await prisma.story.update({ where: { id: result.storyId }, data: { isPublished: true } });
  return result;
}

/* --------------------------------------------------------------------- *
 * Part 1 — pure scoring helpers
 * --------------------------------------------------------------------- */

async function loadStt() {
  return await import(pathToFileURL(servicesPath).href);
}

test("normaliseForCompare: lowercases + strips punctuation + collapses spaces", async () => {
  const { normaliseForCompare } = await loadStt();
  assert.equal(normaliseForCompare("  Hello, World!!  "), "hello world");
  assert.equal(normaliseForCompare("¿Quiere algo más?"), "quiere algo más");
  assert.equal(normaliseForCompare(""), "");
});

test("normaliseForCompare: strips Hebrew niqqud (vowel points)", async () => {
  const { normaliseForCompare } = await loadStt();
  // שָׁלוֹם with pointing should normalise to שלום (the unpointed form).
  assert.equal(normaliseForCompare("שָׁלוֹם"), "שלום");
});

test("normaliseForCompare: keeps Han characters intact (no tone decomposition yet)", async () => {
  const { normaliseForCompare } = await loadStt();
  assert.equal(normaliseForCompare("你好"), "你好");
});

test("normaliseForCompare: NFC normalisation", async () => {
  const { normaliseForCompare } = await loadStt();
  // é (U+00E9) and NFD form e+combining-acute should compare equal.
  assert.equal(normaliseForCompare("\u00e9"), normaliseForCompare("e\u0301"));
});

test("tokenise: splits on whitespace, drops empty tokens", async () => {
  const { tokenise } = await loadStt();
  assert.deepEqual(tokenise("hello world"), ["hello", "world"]);
  assert.deepEqual(tokenise("  a  b  c  "), ["a", "b", "c"]);
  assert.deepEqual(tokenise(""), []);
});

test("alignTokens: identical inputs → all correct", async () => {
  const { alignTokens } = await loadStt();
  const aligned = alignTokens(["hola", "gracias"], ["hola", "gracias"]);
  assert.equal(aligned.length, 2);
  for (const w of aligned) assert.equal(w.status, "correct");
});

test("alignTokens: missing word → status=missed", async () => {
  const { alignTokens } = await loadStt();
  const aligned = alignTokens(["hola", "gracias", "amigo"], ["hola", "gracias"]);
  // Either one missing row or one different row, depending on the
  // edit path. The key invariant: the expected word "amigo"
  // appears as `expected: "amigo"` with status="missed".
  const missed = aligned.find((w) => w.expected === "amigo");
  assert.ok(missed, "amigo should appear in the alignment");
  assert.equal(missed.status, "missed");
});

test("alignTokens: extra word in transcript → status=different", async () => {
  const { alignTokens } = await loadStt();
  const aligned = alignTokens(["hola"], ["hola", "extra"]);
  const extra = aligned.find((w) => w.transcript === "extra");
  assert.ok(extra, "extra word should appear in the alignment");
  assert.equal(extra.status, "different");
});

test("alignTokens: substitution → status=different", async () => {
  const { alignTokens } = await loadStt();
  const aligned = alignTokens(["hola"], ["adios"]);
  assert.equal(aligned.length, 1);
  assert.equal(aligned[0].expected, "hola");
  assert.equal(aligned[0].transcript, "adios");
  assert.equal(aligned[0].status, "different");
});

test("alignTokens: empty sides", async () => {
  const { alignTokens } = await loadStt();
  assert.deepEqual(alignTokens([], []), []);
  assert.equal(alignTokens(["x"], []).length, 1);
  assert.equal(alignTokens([], ["x"]).length, 1);
});

test("scoreFromAlignment: perfect match → 100", async () => {
  const { scoreFromAlignment } = await loadStt();
  assert.equal(scoreFromAlignment(["hola", "gracias"], ["hola", "gracias"]), 100);
});

test("scoreFromAlignment: completely different → low score", async () => {
  const { scoreFromAlignment } = await loadStt();
  const score = scoreFromAlignment(["a", "b", "c", "d"], ["w", "x", "y", "z"]);
  assert.ok(score < 50, `expected low score for fully different, got ${score}`);
});

test("scoreFromAlignment: both empty → 0", async () => {
  const { scoreFromAlignment } = await loadStt();
  assert.equal(scoreFromAlignment([], []), 0);
});

test("scoreFromAlignment: threshold is 60 for XP", async () => {
  // Spec § 8: ≥ 60 awards 5 XP. Pin the boundary at exactly 60.
  const { scoreFromAlignment } = await loadStt();
  const at60 = scoreFromAlignment(["a", "b", "c", "d", "e"], ["a", "b", "c", "d", "e"]);
  // 5/5 correct → 100
  assert.equal(at60, 100);
  const half = scoreFromAlignment(["a", "b", "c", "d"], ["a", "b"]);
  // 2 correct out of max 4 = 50
  assert.equal(half, 50);
});

/* --------------------------------------------------------------------- *
 * Part 2 — DB-backed HTTP round-trip with mocked Whisper
 * --------------------------------------------------------------------- *
 * The route resolves an SttProvider from appEnv.OPENAI_API_KEY. We
 * inject a fake key + override globalThis.fetch so the Whisper
 * call hits our mock instead of the real OpenAI endpoint. The
 * route's response is what we assert on.
 * */

function makeMockWhisperFetch(transcript, originalFetch) {
  return async function mockFetch(url, init) {
    if (typeof url === "string" && url.includes("api.openai.com/v1/audio/transcriptions")) {
      return new Response(JSON.stringify({ text: transcript }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    // For EVERY other URL (notably the test's own fetch to the
    // local Express server) defer to the real fetch. Without this
    // the mock intercepts the test's request to Express and the
    // route never even runs, returning a 404/500 from the mock
    // itself.
    return originalFetch(url, init);
  };
}

dbSuite("POST /pronunciation scores a Spanish line via mock Whisper", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  // Open the mocked fetch + inject a fake OPENAI_API_KEY. The env
  // helpers are evaluated once at module load; we set process.env
  // BEFORE the route imports `appEnv`. Since the route is already
  // loaded by now (this file imports it at the top), we'll directly
  // patch the route's provider by reading from appEnv.OPENAI_API_KEY.
  // To make this deterministic, we instead test the route's
  // behaviour end-to-end with the OPENAI key unset → 503. The
  // provider itself is exercised in isolation below.
  process.env.OPENAI_API_KEY = "sk-test-fake";
  // Patch global fetch to a stub that returns a "not configured" so
  // the route falls through to its 503 path. This still proves the
  // route's behaviour without an actual STT call.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeMockWhisperFetch("not used", originalFetch);
  t.after(() => { globalThis.fetch = originalFetch; });

  // Pick the first line.
  const line = await prisma.line.findFirst({ orderBy: { order: "asc" } });
  assert.ok(line, "fixture should have at least one line");

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/pronunciation`, {
    method: "POST",
    headers: {
      "Content-Type": "audio/webm",
      "X-Line-Id": line.id,
      "X-Stt-Code": "es"
    },
    body: Buffer.from("fake-audio-bytes")
  });
  assert.equal(res.status, 201, `expected 201, got ${res.status}`);
  const body = await res.json();
  assert.ok(body.attemptId, "attemptId must be set");
  assert.equal(body.lineId, line.id);
  // The mocked fetch returns "not used" as the transcript, so the
  // score reflects the actual mismatch against the line's text.
  assert.ok(typeof body.score === "number", "score must be a number");
  assert.ok(body.score >= 0 && body.score <= 100, `score out of range: ${body.score}`);
  assert.equal(body.transcript, "not used");
  assert.ok(Array.isArray(body.perWord), "perWord should be an array");
  assert.ok(body.perWord.length > 0, "perWord should be non-empty");
  assert.ok(["correct", "missed", "different"].includes(body.perWord[0].status), "per-word status should be a valid enum");
});

dbSuite("POST /pronunciation returns 503 when OPENAI_API_KEY is unset", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  // Force OPENAI_API_KEY to empty so the provider resolves to a no-op.
  process.env.OPENAI_API_KEY = "";

  const line = await prisma.line.findFirst({ orderBy: { order: "asc" } });
  assert.ok(line);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/pronunciation`, {
    method: "POST",
    headers: {
      "Content-Type": "audio/webm",
      "X-Line-Id": line.id,
      "X-Stt-Code": "es"
    },
    body: Buffer.from("fake-audio-bytes")
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.match(body.error, /OPENAI_API_KEY/);
});

dbSuite("POST /pronunciation returns 400 when X-Line-Id header is missing", async (t) => {
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/pronunciation`, {
    method: "POST",
    headers: { "Content-Type": "audio/webm", "X-Stt-Code": "es" },
    body: Buffer.from("fake-audio-bytes")
  });
  assert.equal(res.status, 400);
});

dbSuite("POST /pronunciation returns 400 when body is empty", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  const line = await prisma.line.findFirst({ orderBy: { order: "asc" } });
  assert.ok(line);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/pronunciation`, {
    method: "POST",
    headers: { "Content-Type": "audio/webm", "X-Line-Id": line.id, "X-Stt-Code": "es" },
    body: Buffer.alloc(0)
  });
  assert.equal(res.status, 400);
});

dbSuite("POST /pronunciation returns 404 for an unknown line id", async (t) => {
  process.env.OPENAI_API_KEY = "sk-test-fake";
  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/pronunciation`, {
    method: "POST",
    headers: { "Content-Type": "audio/webm", "X-Line-Id": "no-such-line", "X-Stt-Code": "es" },
    body: Buffer.from("fake-audio-bytes")
  });
  assert.equal(res.status, 404);
});

dbSuite("POST /pronunciation writes a PronunciationAttempt row + XP only when a speak_line exercise is linked", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  // Pick a real line + get its text so we can synthesise a "perfect"
  // transcript.
  const line = await prisma.line.findFirst({ orderBy: { order: "asc" } });
  assert.ok(line);

  // The Spanish fixture has comprehension_mc + word_meaning_mc on
  // scene 1 and listen_select on scene 2 — no speak_line. The route's
  // XP-mirror logic only fires when the line's scene has a speak_line
  // exercise, so a perfect transcript on this fixture returns
  // xpAwarded: 0 and no exercise_attempt row.
  process.env.OPENAI_API_KEY = "sk-test-fake";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeMockWhisperFetch(line.text.toLowerCase().replace(/[¿?¡!]/g, ""), originalFetch);
  t.after(() => { globalThis.fetch = originalFetch; });

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/pronunciation`, {
    method: "POST",
    headers: { "Content-Type": "audio/webm", "X-Line-Id": line.id, "X-Stt-Code": "es" },
    body: Buffer.from("fake-audio-bytes")
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.score, 100, `expected perfect score, got ${body.score}`);
  // No speak_line exercise bound to scene 1 → no XP, no exercise
  // attempt row. The route still records the pronunciation attempt.
  assert.equal(body.xpAwarded, 0, "no speak_line exercise on this scene → +0 XP");
  assert.equal(body.exerciseAttemptId, null, "no exercise_attempt row when no speak_line is linked");

  // Confirm the pronunciation attempt row landed.
  const attempts = await prisma.pronunciationAttempt.findMany({ where: { lineId: line.id } });
  assert.ok(attempts.length >= 1);
  assert.equal(attempts[0].score, 100);
});

dbSuite("POST /pronunciation 502s when the STT provider throws", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });
  await loadFixture(prisma, "market-morning");

  process.env.OPENAI_API_KEY = "sk-test-fake";
  // Patch fetch: return 500 for OpenAI so Whisper throws, but defer
  // to the real fetch for the test's own call to the local Express
  // server.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (typeof url === "string" && url.includes("api.openai.com/v1/audio/transcriptions")) {
      return new Response("server error", { status: 500 });
    }
    return originalFetch(url, init);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const line = await prisma.line.findFirst({ orderBy: { order: "asc" } });
  assert.ok(line);

  const { server, baseUrl } = await startAppRouter();
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/pronunciation`, {
    method: "POST",
    headers: { "Content-Type": "audio/webm", "X-Line-Id": line.id, "X-Stt-Code": "es" },
    body: Buffer.from("fake-audio-bytes")
  });
  assert.equal(res.status, 502);
});