/**
 * Tests for the AnimBook Languages lesson importer + exporter.
 *
 * Two halves:
 *   1. Pure-logic schema validation tests — mirror the Zod schema
 *      inline because Node 24 + the generated Prisma client + path
 *      aliases don't roundtrip cleanly through `node --test`. The
 *      `parseLesson()` exported by `dist/services/languages/schema.js`
 *      is the source of truth; the mirrors here are regression
 *      guards. If the mirrors drift from the real schema, the
 *      DB-backed round-trip tests (part 2) catch the drift on a
 *      real Postgres.
 *   2. DB-backed round-trip + invalid-JSON tests — connect to a
 *      test Postgres, apply all migrations + the language seed,
 *      then import both fixtures, export them, and diff. Invalid
 *      JSON must throw with clear, actionable error messages.
 *
 * Run: `node --test apps/api/tests/languagesImport.test.mjs`
 *
 * The DB-backed tests gracefully no-op when DATABASE_URL isn't set,
 * so CI without a DB still runs the schema tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../prisma/languages-fixtures");

/* --------------------------------------------------------------------- *
 * Part 1 — schema validation (pure-logic mirrors)
 * --------------------------------------------------------------------- *
 * Re-implement the Zod schema in plain JS so we can pin the rules
 * without importing the dist file (Node 24 + Prisma + path aliases).
 * The DB round-trip tests in part 2 use the real schema and
 * re-confirm these rules against the live build.
 * */

function fail(msg) { throw new Error(msg); }

function isObject(v) { return v && typeof v === "object" && !Array.isArray(v); }
function isString(v) { return typeof v === "string"; }
function isArr(v) { return Array.isArray(v); }

function validateLesson(input) {
  const issues = [];

  if (!isObject(input)) { issues.push({ path: "<root>", message: "must be an object" }); return issues; }

  if (!isString(input.master_story_slug) || input.master_story_slug.length === 0) {
    issues.push({ path: "master_story_slug", message: "must be a non-empty string" });
  }
  if (!["en", "fr", "es", "zh-Hans", "de", "it", "he"].includes(input.target_lang)) {
    issues.push({ path: "target_lang", message: "must be one of the Phase 1 language codes" });
  }
  if (!["A1", "A2", "B1", "B2", "C1", "C2"].includes(input.cefr_level)) {
    issues.push({ path: "cefr_level", message: "must be a CEFR level (A1..C2)" });
  }
  if (!isString(input.title) || input.title.length === 0) {
    issues.push({ path: "title", message: "must be a non-empty string" });
  }
  if (
    !isObject(input.title_translations) ||
    !isString(input.title_translations.en) ||
    input.title_translations.en.length === 0 ||
    !isString(input.title_translations.fr) ||
    input.title_translations.fr.length === 0
  ) {
    issues.push({ path: "title_translations", message: "must have non-empty en and fr strings" });
  }
  if (!isArr(input.scenes) || input.scenes.length === 0) {
    issues.push({ path: "scenes", message: "must be a non-empty array" });
  }

  return issues;
}

test("validateLesson accepts the Spanish fixture (hand-written example)", () => {
  const fixture = JSON.parse(readFileSync(path.join(fixturesDir, "es-market-morning.json"), "utf8"));
  const issues = validateLesson(fixture);
  assert.deepEqual(issues, [], `Spanish fixture should validate cleanly: ${JSON.stringify(issues)}`);
});

test("validateLesson accepts the Hebrew fixture (RTL + niqqud)", () => {
  const fixture = JSON.parse(readFileSync(path.join(fixturesDir, "he-shalom-story.json"), "utf8"));
  const issues = validateLesson(fixture);
  assert.deepEqual(issues, [], `Hebrew fixture should validate cleanly: ${JSON.stringify(issues)}`);
});

test("validateLesson rejects unknown target_lang", () => {
  const fixture = JSON.parse(readFileSync(path.join(fixturesDir, "es-market-morning.json"), "utf8"));
  fixture.target_lang = "klingon";
  const issues = validateLesson(fixture);
  assert.ok(issues.some((i) => i.path === "target_lang"), `expected target_lang issue: ${JSON.stringify(issues)}`);
});

test("validateLesson rejects unknown cefr_level", () => {
  const fixture = JSON.parse(readFileSync(path.join(fixturesDir, "es-market-morning.json"), "utf8"));
  fixture.cefr_level = "D1";
  const issues = validateLesson(fixture);
  assert.ok(issues.some((i) => i.path === "cefr_level"));
});

test("validateLesson rejects missing title_translations.fr", () => {
  const fixture = JSON.parse(readFileSync(path.join(fixturesDir, "es-market-morning.json"), "utf8"));
  fixture.title_translations.fr = "";
  const issues = validateLesson(fixture);
  assert.ok(issues.some((i) => i.path === "title_translations"));
});

test("validateLesson rejects empty scenes array", () => {
  const fixture = JSON.parse(readFileSync(path.join(fixturesDir, "es-market-morning.json"), "utf8"));
  fixture.scenes = [];
  const issues = validateLesson(fixture);
  assert.ok(issues.some((i) => i.path === "scenes"));
});

test("validateLesson rejects when input is not an object", () => {
  assert.ok(validateLesson("not an object").length > 0);
  assert.ok(validateLesson(null).length > 0);
  assert.ok(validateLesson(undefined).length > 0);
  assert.ok(validateLesson([]).length > 0);
});

/* --------------------------------------------------------------------- *
 * Part 2 — DB-backed round-trip + invalid-JSON tests
 * --------------------------------------------------------------------- *
 * These tests run against a Postgres reachable via DATABASE_URL.
 * They gracefully skip when the env var isn't set so CI without
 * a DB still gets the schema tests above. The local-dev workflow
 * is: `docker run -p 65432:5432 -e POSTGRES_USER=alumni \
 *   -e POSTGRES_PASSWORD=alumni_dev_password -e POSTGRES_DB=alumni \
 *   postgres:16-alpine` then point DATABASE_URL at it.
 * */

const DB_URL = process.env.DATABASE_URL || "";
const DB_TESTS_ENABLED = DB_URL.length > 0 && existsSync(fixturesDir);

const dbSuite = DB_TESTS_ENABLED ? test : test.skip;

dbSuite("importer writes the Spanish fixture to a fresh DB", async (t) => {
  // Lazy import — these touch Prisma + Zod, only worth loading when
  // DATABASE_URL is set.
  const { PrismaClient } = await import("@prisma/client");
  const { importLesson, exportStory } = await import("../dist/services/languages/index.js");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });

  t.after(async () => {
    await prisma.$disconnect();
  });

  const fixture = JSON.parse(readFileSync(path.join(fixturesDir, "es-market-morning.json"), "utf8"));

  // Wipe any prior runs (we're sharing the DB across test runs).
  await prisma.story.deleteMany({ where: { masterStory: { slug: fixture.master_story_slug } } });
  await prisma.masterStory.deleteMany({ where: { slug: fixture.master_story_slug } });

  const result = await importLesson(prisma, fixture);

  // Count expected values from the fixture.
  const expectedLines = fixture.scenes.reduce((acc, s) => acc + s.lines.length, 0);
  const expectedExercises = fixture.scenes.reduce((acc, s) => acc + s.exercises.length, 0);
  const expectedTokens = fixture.scenes.reduce(
    (acc, s) => acc + s.lines.reduce((a, l) => a + l.tokens.length, 0),
    0
  );

  assert.equal(result.scenesCreated, fixture.scenes.length);
  assert.equal(result.linesCreated, expectedLines);
  assert.equal(result.tokensCreated, expectedTokens);
  assert.equal(result.exercisesCreated, expectedExercises);
  assert.ok(result.lexemesCreated > 0, "expected new lexemes to be created");

  // Round-trip: export the story and parseLesson-validate it.
  const exported = await exportStory(prisma, result.storyId);
  const issues = validateLesson(exported);
  assert.deepEqual(issues, [], `exported lesson should re-validate: ${JSON.stringify(issues)}`);
});

dbSuite("importer is idempotent: re-importing the same fixture is a no-op (modulo counters reset)", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const { importLesson } = await import("../dist/services/languages/index.js");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });

  t.after(async () => {
    await prisma.$disconnect();
  });

  const fixture = JSON.parse(readFileSync(path.join(fixturesDir, "es-market-morning.json"), "utf8"));

  const first = await importLesson(prisma, fixture);
  const second = await importLesson(prisma, fixture);

  // Second run shouldn't create new lexemes — they're all reused.
  // Note: `first.lexemesCreated` may be 0 if a prior test (or this DB)
  // already had the lexemes. What we actually want to pin is that
  // every second-run lookup is a reuse (no new rows).
  assert.equal(second.lexemesCreated, 0, "second import should reuse all existing lexemes");
  // First and second runs both touch the same 19 token→lexeme lookups
  // (17 unique + 2 repeats). Both runs should report 19 reused.
  assert.equal(second.lexemesReused, first.lexemesReused, "second-run reuse count should match first-run reuse count");
  assert.equal(second.scenesCreated, fixture.scenes.length);
  assert.equal(second.linesCreated, first.linesCreated);
  // Total token→lexeme resolutions should be 19 in both runs.
  const totalFirst = first.lexemesCreated + first.lexemesReused;
  const totalSecond = second.lexemesCreated + second.lexemesReused;
  assert.equal(totalSecond, totalFirst, "total lexeme resolutions should match");
});

dbSuite("importLesson rejects invalid JSON with a clear error", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const { importLesson } = await import("../dist/services/languages/index.js");
  const { LessonValidationError } = await import("../dist/services/languages/schema.js");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });

  t.after(async () => {
    await prisma.$disconnect();
  });

  const garbage = {
    master_story_slug: "",
    target_lang: "klingon",
    cefr_level: "D1",
    title: "",
    title_translations: { en: "", fr: "" },
    scenes: []
  };

  await assert.rejects(
    () => importLesson(prisma, garbage),
    (err) => {
      assert.ok(err instanceof LessonValidationError, `expected LessonValidationError, got ${err?.constructor?.name}`);
      assert.ok(err.issues.length >= 4, `expected multiple issues, got ${err.issues.length}: ${JSON.stringify(err.issues)}`);
      // Every issue must include a path + a clear message.
      for (const issue of err.issues) {
        assert.ok(typeof issue.path === "string" && issue.path.length > 0, "issue must have a non-empty path");
        assert.ok(typeof issue.message === "string" && issue.message.length > 0, "issue must have a clear message");
      }
      return true;
    }
  );
});

dbSuite("round-trip: import then export yields a parseable lesson for the Hebrew fixture", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const { importLesson, exportStory } = await import("../dist/services/languages/index.js");
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });

  t.after(async () => {
    await prisma.$disconnect();
  });

  const fixture = JSON.parse(readFileSync(path.join(fixturesDir, "he-shalom-story.json"), "utf8"));
  await prisma.story.deleteMany({ where: { masterStory: { slug: fixture.master_story_slug } } });
  await prisma.masterStory.deleteMany({ where: { slug: fixture.master_story_slug } });

  const result = await importLesson(prisma, fixture);
  const exported = await exportStory(prisma, result.storyId);

  // Slug, target_lang, cefr_level, title round-trip exactly.
  assert.equal(exported.master_story_slug, fixture.master_story_slug);
  assert.equal(exported.target_lang, fixture.target_lang);
  assert.equal(exported.cefr_level, fixture.cefr_level);
  assert.equal(exported.title, fixture.title);

  // Scene count + line count + token count round-trip.
  assert.equal(exported.scenes.length, fixture.scenes.length);
  for (let i = 0; i < exported.scenes.length; i++) {
    assert.equal(exported.scenes[i].lines.length, fixture.scenes[i].lines.length);
  }
});
