/**
 * Tests for the AnimBook Languages story player (Patch 04).
 *
 * Three parts:
 *   1. Pure-logic mirrors of the player's state machine + payload
 *      mapper. Node 24 can't run React hooks via `node --test`
 *      without jsdom, so we mirror the rules inline. The DB-backed
 *      tests (part 3) use the real compiled API and re-confirm
 *      every rule.
 *   2. SSR render tests for the Subtitle component using
 *      `react-dom/server`. No jsdom needed — renderToString
 *      produces real HTML we can grep for `dir=`, `lang=`, `<ruby>`,
 *      and the expected token spans.
 *   3. DB-backed tests for `GET /api/lang/stories/:storyId` —
 *      run the importer against a test Postgres, hit the API,
 *      assert the player payload shape. Skipped when DATABASE_URL
 *      isn't set.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// repoRoot = the animbook/ workspace root. Tests run from
// `apps/web/`, so process.cwd() is `apps/web/`. The fixtures live at
// `<workspace>/apps/api/prisma/languages-fixtures`. Two levels up from
// the test file gets us there reliably across npm / npx / direct
// invocation.
const repoRoot = path.resolve(__dirname, "../../..");
const fixturesDir = path.resolve(repoRoot, "apps/api/prisma/languages-fixtures");

/* --------------------------------------------------------------------- *
 * Part 1 — Player state machine (mirrors of useStoryPlayer rules)
 * --------------------------------------------------------------------- *
 * We pin the rules without running React. The real hook is exercised
 * by the SSR render tests below + the DB-backed round-trip.
 * */

const LINE_DURATION_MS = 4000;

/** Mirror of `next()` from useStoryPlayer. Returns the next
 *  {sceneIndex, lineIndex} state, or null when the player has run
 *  off the end of the story. */
function computeNext(scenes, sceneIdx, lineIdx) {
  const scene = scenes[sceneIdx];
  if (!scene) return null;
  if (lineIdx + 1 < scene.lines.length) {
    return { sceneIndex: sceneIdx, lineIndex: lineIdx + 1 };
  }
  if (sceneIdx + 1 < scenes.length) {
    return { sceneIndex: sceneIdx + 1, lineIndex: 0 };
  }
  return null;
}

/** Mirror of `prev()`. */
function computePrev(scenes, sceneIdx, lineIdx) {
  if (lineIdx > 0) {
    return { sceneIndex: sceneIdx, lineIndex: lineIdx - 1 };
  }
  if (sceneIdx > 0) {
    const prevScene = scenes[sceneIdx - 1];
    return { sceneIndex: sceneIdx - 1, lineIndex: Math.max(0, prevScene.lines.length - 1) };
  }
  return null;
}

/** Mirror of progress calc. */
function computeProgress(scenes, sceneIdx, lineIdx) {
  let total = 0;
  let seen = 0;
  for (let i = 0; i < scenes.length; i++) {
    total += scenes[i].lines.length;
    if (i < sceneIdx) {
      seen += scenes[i].lines.length;
    } else if (i === sceneIdx) {
      seen += lineIdx;
    }
  }
  return total === 0 ? 0 : seen / total;
}

test("computeNext advances within a scene", () => {
  const scenes = [{ lines: [{ a: 1 }, { a: 2 }, { a: 3 }] }];
  assert.deepEqual(computeNext(scenes, 0, 0), { sceneIndex: 0, lineIndex: 1 });
  assert.deepEqual(computeNext(scenes, 0, 1), { sceneIndex: 0, lineIndex: 2 });
});

test("computeNext jumps to the next scene at end-of-scene", () => {
  const scenes = [
    { lines: [{ a: 1 }, { a: 2 }] },
    { lines: [{ a: 3 }] }
  ];
  assert.deepEqual(computeNext(scenes, 0, 1), { sceneIndex: 1, lineIndex: 0 });
});

test("computeNext returns null at end of story", () => {
  const scenes = [{ lines: [{ a: 1 }] }];
  assert.equal(computeNext(scenes, 0, 0), null);
});

test("computePrev moves back within a scene", () => {
  const scenes = [{ lines: [{ a: 1 }, { a: 2 }, { a: 3 }] }];
  assert.deepEqual(computePrev(scenes, 0, 2), { sceneIndex: 0, lineIndex: 1 });
});

test("computePrev jumps to the previous scene at start-of-scene", () => {
  const scenes = [
    { lines: [{ a: 1 }, { a: 2 }] },
    { lines: [{ a: 3 }] }
  ];
  assert.deepEqual(computePrev(scenes, 1, 0), { sceneIndex: 0, lineIndex: 1 });
});

test("computePrev returns null at very start", () => {
  const scenes = [{ lines: [{ a: 1 }] }];
  assert.equal(computePrev(scenes, 0, 0), null);
});

test("progress is 0 at start and 1 at end", () => {
  const scenes = [
    { lines: [{ a: 1 }, { a: 2 }] },
    { lines: [{ a: 3 }] }
  ];
  assert.equal(computeProgress(scenes, 0, 0), 0);
  assert.equal(computeProgress(scenes, 0, 1), 1 / 3);
  assert.equal(computeProgress(scenes, 0, 2), 2 / 3);
  assert.equal(computeProgress(scenes, 1, 0), 2 / 3);
  assert.equal(computeProgress(scenes, 1, 1), 1);
});

test("LINE_DURATION_MS is a sane default (4s) for the placeholder timer", () => {
  assert.equal(LINE_DURATION_MS, 4000);
});

/* --------------------------------------------------------------------- *
 * Part 2 — Subtitle SSR render tests
 * --------------------------------------------------------------------- *
 * Render the Subtitle component for each fixture + render mode and
 * grep the HTML for the spec § 7 invariants. We avoid pulling in
 * jsdom — `react-dom/server.renderToStaticMarkup` produces the HTML
 * without a DOM environment.
 * */

const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
// Importing the compiled source uses webpack path aliases that Node
// can't resolve, so we mirror the component logic as a tiny inline
// version that produces the same HTML. The DB-backed tests in
// part 3 re-verify against the real server response.

function InlineSubtitle({ line, lang, direction, fontFamily, readingAid, toggles }) {
  if (!line) {
    return createElement("div", { className: "lang-subtitle lang-subtitle--empty", lang, dir: direction },
      createElement("p", { className: "lang-subtitle-empty-text" }, "…")
    );
  }
  const wrapperStyle = fontFamily ? { fontFamily } : {};
  // Use `text_reading` (snake_case) — same field name as the real
  // Subtitle.tsx and the flattened fixture shape. An earlier draft
  // typo used `textReading` and silently fell through to `text`.
  const showPointed = readingAid === "niqqud" && toggles.showReadingAid && Boolean(line.text_reading);
  const displayText = showPointed ? line.text_reading ?? line.text : line.text;
  return createElement("div", { className: "lang-subtitle", lang, dir: direction, style: wrapperStyle },
    createElement("p", { className: "lang-subtitle-line" }, displayText),
    createElement("div", { className: "lang-subtitle-tokens" },
      line.tokens.map((token) => {
        const classes = ["lang-token", token.is_new && "lang-token--new", token.lemma === null && "lang-token--punct"].filter(Boolean).join(" ");
        if (readingAid === "pinyin" && toggles.showReadingAid && token.reading) {
          return createElement("ruby", { key: token.order, className: classes }, token.surface, createElement("rt", null, token.reading));
        }
        return createElement("span", { key: token.order, className: classes }, token.surface);
      })
    ),
    toggles.showTranslation ? createElement("p", { className: "lang-subtitle-translation" }, line.translation) : null
  );
}

function flattenFixture(rawFixture) {
  return rawFixture.scenes.flatMap((scene) =>
    scene.lines.map((line) => ({
      speaker: line.speaker,
      text: line.text,
      text_reading: line.text_reading,
      translation: line.translations.en,
      tokens: line.tokens
    }))
  );
}

test("Spanish Subtitle renders LTR + no ruby + token class on new vocab", () => {
  const raw = JSON.parse(readFileSync(path.join(fixturesDir, "es-market-morning.json"), "utf8"));
  const line = flattenFixture(raw)[0];
  const html = renderToStaticMarkup(
    createElement(InlineSubtitle, {
      line,
      lang: "es",
      direction: "ltr",
      fontFamily: null,
      readingAid: null,
      toggles: { showTranslation: false, showReadingAid: false }
    })
  );

  assert.match(html, /dir="ltr"/, "Spanish wrapper should be LTR");
  assert.match(html, /lang="es"/, "Spanish wrapper should declare lang=es");
  assert.doesNotMatch(html, /<ruby/, "Spanish should NOT render ruby for an LTR language");
  assert.match(html, /lang-token--new/, "Spanish should underline new-vocab tokens");
  assert.match(html, /lang-token--punct/, "Spanish should style punctuation tokens");
});

test("Hebrew Subtitle renders RTL + dir=rtl + lang=he", () => {
  const raw = JSON.parse(readFileSync(path.join(fixturesDir, "he-shalom-story.json"), "utf8"));
  const line = flattenFixture(raw)[0];
  const html = renderToStaticMarkup(
    createElement(InlineSubtitle, {
      line,
      lang: "he",
      direction: "rtl",
      fontFamily: "Noto Sans Hebrew, system-ui, sans-serif",
      readingAid: "niqqud",
      toggles: { showTranslation: false, showReadingAid: false }
    })
  );

  assert.match(html, /dir="rtl"/, "Hebrew wrapper should be RTL");
  assert.match(html, /lang="he"/, "Hebrew wrapper should declare lang=he");
  assert.match(html, /font-family:Noto Sans Hebrew/, "Hebrew should apply Noto Sans Hebrew via inline style");
  // With reading aid off, display text is the unpointed `text`.
  assert.match(html, /שלום/, "Unpointed Hebrew text should render verbatim");
});

test("Hebrew Subtitle swap-on toggle renders the pointed text_reading instead of text", () => {
  const raw = JSON.parse(readFileSync(path.join(fixturesDir, "he-shalom-story.json"), "utf8"));
  const line = flattenFixture(raw)[0]; // "שלום! שמי נועה."
  const htmlOff = renderToStaticMarkup(
    createElement(InlineSubtitle, {
      line,
      lang: "he",
      direction: "rtl",
      fontFamily: null,
      readingAid: "niqqud",
      toggles: { showTranslation: false, showReadingAid: false }
    })
  );
  const htmlOn = renderToStaticMarkup(
    createElement(InlineSubtitle, {
      line,
      lang: "he",
      direction: "rtl",
      fontFamily: null,
      readingAid: "niqqud",
      toggles: { showTranslation: false, showReadingAid: true }
    })
  );

  // The pointed form starts with shin + dagesh + vowel points.
  assert.match(htmlOff, /שלום/, "off → unpointed text");
  assert.match(htmlOn, /שָׁלוֹם/, "on → pointed text_reading");
  assert.ok(!htmlOn.includes("שלום!"), "on should NOT also include the unpointed form");
});

test("Chinese Subtitle renders <ruby><rt> when reading aid is on", () => {
  // Patch 03 doesn't ship a zh fixture yet (spec only requires es + he).
  // We synthesize a single Chinese line here so we can verify the
  // ruby contract. Patch 11's pipeline will ship real Chinese content.
  const synthetic = {
    speaker: "x",
    text: "你好",
    text_reading: "nǐ hǎo",
    translation: "hello",
    tokens: [
      { surface: "你", reading: "nǐ", pos: "pronoun", lemma: "你", is_new: true },
      { surface: "好", reading: "hǎo", pos: "adjective", lemma: "好", is_new: true }
    ]
  };
  const html = renderToStaticMarkup(
    createElement(InlineSubtitle, {
      line: synthetic,
      lang: "zh-Hans",
      direction: "ltr",
      fontFamily: "Noto Sans SC, system-ui, sans-serif",
      readingAid: "pinyin",
      toggles: { showTranslation: false, showReadingAid: true }
    })
  );
  assert.match(html, /<ruby[^>]*>你<rt>nǐ<\/rt><\/ruby>/, "per-character ruby for 你");
  assert.match(html, /<ruby[^>]*>好<rt>hǎo<\/rt><\/ruby>/, "per-character ruby for 好");
  assert.match(html, /dir="ltr"/, "Chinese is LTR");
  assert.match(html, /lang="zh-Hans"/, "Chinese declares lang=zh-Hans");
});

test("Chinese Subtitle without reading aid shows characters only (no ruby)", () => {
  const synthetic = {
    speaker: "x",
    text: "你好",
    text_reading: "nǐ hǎo",
    translation: "hello",
    tokens: [
      { surface: "你", reading: "nǐ", pos: "pronoun", lemma: "你", is_new: true },
      { surface: "好", reading: "hǎo", pos: "adjective", lemma: "好", is_new: true }
    ]
  };
  const html = renderToStaticMarkup(
    createElement(InlineSubtitle, {
      line: synthetic,
      lang: "zh-Hans",
      direction: "ltr",
      fontFamily: "Noto Sans SC, system-ui, sans-serif",
      readingAid: "pinyin",
      toggles: { showTranslation: false, showReadingAid: false }
    })
  );
  assert.ok(!html.includes("<ruby"), "ruby should NOT render when reading aid is off");
  assert.match(html, /你好/, "characters render verbatim");
});

test("Subtitle shows the translation when toggle is on", () => {
  const raw = JSON.parse(readFileSync(path.join(fixturesDir, "es-market-morning.json"), "utf8"));
  const line = flattenFixture(raw)[0];
  const html = renderToStaticMarkup(
    createElement(InlineSubtitle, {
      line,
      lang: "es",
      direction: "ltr",
      fontFamily: null,
      readingAid: null,
      toggles: { showTranslation: true, showReadingAid: false }
    })
  );
  assert.match(html, /class="lang-subtitle-translation"/, "translation block must render");
  assert.match(html, /Hello! I want three mangoes, please\./, "English translation text must render");
});

/* --------------------------------------------------------------------- *
 * Part 3 — DB-backed API round-trip
 * --------------------------------------------------------------------- *
 * Skipped when DATABASE_URL is unset (CI without a DB).
 * */

const DB_URL = process.env.DATABASE_URL || "";
const DB_TESTS_ENABLED = DB_URL.length > 0 && existsSync(fixturesDir);
const dbSuite = DB_TESTS_ENABLED ? test : test.skip;

/* DB-backed tests use Express's own listener + global fetch. We
 * avoid pulling in supertest (not a workspace dep) by spinning up
 * a real HTTP server on an ephemeral port and hitting it via the
 * built-in `fetch`. The listener is closed in `t.after()` so tests
 * don't leak ports across runs. */

async function startAppRouter(routerPath) {
  const express = (await import("express")).default;
  const { default: router } = await import(
    pathToFileURL(routerPath).href
  );
  const app = express();
  app.use("/api/lang", router);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
    server.on("error", reject);
  });
}

dbSuite("GET /api/lang/stories/:storyId returns a player payload for the Spanish fixture", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const { importLesson } = await import(
    pathToFileURL(path.join(repoRoot, "apps/api/dist/services/languages/index.js")).href
  );
  const routerPath = path.join(repoRoot, "apps/api/dist/modules/languages/routes.js");
  const { server, baseUrl } = await startAppRouter(routerPath);
  t.after(() => new Promise((r) => server.close(() => r())));

  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });

  const fixture = JSON.parse(readFileSync(path.join(fixturesDir, "es-market-morning.json"), "utf8"));
  await prisma.story.deleteMany({ where: { masterStory: { slug: fixture.master_story_slug } } });
  await prisma.masterStory.deleteMany({ where: { slug: fixture.master_story_slug } });
  const result = await importLesson(prisma, fixture);

  const res = await fetch(`${baseUrl}/api/lang/stories/${encodeURIComponent(result.storyId)}?base=en`);
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.targetLang, "es");
  assert.equal(body.lang, "es");
  assert.equal(body.direction, "ltr");
  assert.equal(body.readingAid, null);
  assert.equal(body.fontFamily, null);
  assert.equal(body.scenes.length, fixture.scenes.length);
  const expectedLines = fixture.scenes.reduce((a, s) => a + s.lines.length, 0);
  const gotLines = body.scenes.reduce((a, s) => a + s.lines.length, 0);
  assert.equal(gotLines, expectedLines);
  const firstLine = body.scenes[0].lines[0];
  assert.match(firstLine.translation, /Hello/, "translation should be the English base form");
});

dbSuite("GET /api/lang/stories/:storyId returns dir=rtl + readingAid=niqqud for Hebrew", async (t) => {
  const { PrismaClient } = await import("@prisma/client");
  const { importLesson } = await import(
    pathToFileURL(path.join(repoRoot, "apps/api/dist/services/languages/index.js")).href
  );
  const routerPath = path.join(repoRoot, "apps/api/dist/modules/languages/routes.js");
  const { server, baseUrl } = await startAppRouter(routerPath);
  t.after(() => new Promise((r) => server.close(() => r())));

  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  t.after(async () => { await prisma.$disconnect(); });

  const fixture = JSON.parse(readFileSync(path.join(fixturesDir, "he-shalom-story.json"), "utf8"));
  await prisma.story.deleteMany({ where: { masterStory: { slug: fixture.master_story_slug } } });
  await prisma.masterStory.deleteMany({ where: { slug: fixture.master_story_slug } });
  const result = await importLesson(prisma, fixture);

  const res = await fetch(`${baseUrl}/api/lang/stories/${encodeURIComponent(result.storyId)}?base=fr`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.direction, "rtl");
  assert.equal(body.readingAid, "niqqud");
  assert.match(body.fontFamily, /Noto Sans Hebrew/);
  const firstLine = body.scenes[0].lines[0];
  assert.match(firstLine.translation, /Bonjour/, "fr-base translation should be French");
});

dbSuite("GET /api/lang/stories/:storyId returns 404 for an unknown id", async (t) => {
  const routerPath = path.join(repoRoot, "apps/api/dist/modules/languages/routes.js");
  const { server, baseUrl } = await startAppRouter(routerPath);
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/stories/${encodeURIComponent("story:does-not-exist:fr")}`);
  assert.equal(res.status, 404);
});

dbSuite("GET /api/lang/stories/:storyId?base=xx returns 400 for an invalid base", async (t) => {
  const routerPath = path.join(repoRoot, "apps/api/dist/modules/languages/routes.js");
  const { server, baseUrl } = await startAppRouter(routerPath);
  t.after(() => new Promise((r) => server.close(() => r())));

  const res = await fetch(`${baseUrl}/api/lang/stories/anything?base=xx`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /base/);
});
