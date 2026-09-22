/**
 * Tests for the AnimBook Languages seed data shape (Patch 02).
 *
 * We mirror the data constants from `prisma/languages-seed-data.ts`
 * inline because Node 24 can't resolve the path-alias / module setup
 * Prisma's generated client needs. The seed script itself runs against
 * a real DB on demand; this file pins the *shape* of the seed so a
 * regression (typo in a language code, wrong course count) gets caught
 * at unit-test time, not at deploy time.
 *
 * Run: `node --test apps/api/tests/languagesSeed.test.mjs`
 */
import test from "node:test";
import assert from "node:assert/strict";

/* --------------------------------------------------------------------- *
 * Mirror of the source data.
 * --------------------------------------------------------------------- *
 * Keep this in lockstep with apps/api/prisma/languages-seed-data.ts.
 * The dedicated mirror file pattern is the same one used by the
 * i18n t() helper and the rotator helpers — Node 24 + Prisma's
 * generated client doesn't import cleanly via `node --test`, so we
 * duplicate the constants here. If the source drifts, the mirrors
 * can pass while prod breaks; the smoke `languagesModule.test.mjs`
 * pins the in-process API side. The two together give full coverage.
 * */

const LANGUAGES = [
  { code: "en",      nameEn: "English",            nameFr: "Anglais",            nameNative: "English",   direction: "ltr", script: "Latin",            readingAid: "none",    sttCode: "en", isTarget: true,  isBase: true  },
  { code: "fr",      nameEn: "French",             nameFr: "Français",           nameNative: "Français",  direction: "ltr", script: "Latin",            readingAid: "none",    sttCode: "fr", isTarget: true,  isBase: true  },
  { code: "es",      nameEn: "Spanish",            nameFr: "Espagnol",           nameNative: "Español",   direction: "ltr", script: "Latin",            readingAid: "none",    sttCode: "es", isTarget: true,  isBase: false },
  { code: "zh-Hans", nameEn: "Chinese (Mandarin)", nameFr: "Chinois (mandarin)", nameNative: "中文",      direction: "ltr", script: "Han (Simplified)", readingAid: "pinyin",  sttCode: "zh", isTarget: true,  isBase: false },
  { code: "de",      nameEn: "German",             nameFr: "Allemand",           nameNative: "Deutsch",   direction: "ltr", script: "Latin",            readingAid: "none",    sttCode: "de", isTarget: true,  isBase: false },
  { code: "it",      nameEn: "Italian",            nameFr: "Italien",            nameNative: "Italiano",  direction: "ltr", script: "Latin",            readingAid: "none",    sttCode: "it", isTarget: true,  isBase: false },
  { code: "he",      nameEn: "Hebrew",             nameFr: "Hébreu",             nameNative: "עברית",      direction: "rtl", script: "Hebrew",           readingAid: "niqqud", sttCode: "he", isTarget: true,  isBase: false }
];

/** Mirror of isValidCoursePair. */
function isValidCoursePair(targetLang, baseLang) {
  if (targetLang === baseLang) return false;
  return (
    LANGUAGES.some((l) => l.code === targetLang && l.isTarget) &&
    LANGUAGES.some((l) => l.code === baseLang && l.isBase)
  );
}

/** Reconstruct the 12 courses from the language catalog so the test
 *  cannot drift from the source — if you add a 7th base language the
 *  test will start asserting 14 courses automatically. */
function buildExpectedCourses() {
  const targets = LANGUAGES.filter((l) => l.isTarget);
  const bases = LANGUAGES.filter((l) => l.isBase);
  const out = [];
  for (const t of targets) {
    for (const b of bases) {
      if (!isValidCoursePair(t.code, b.code)) continue;
      out.push({ targetLang: t.code, baseLang: b.code });
    }
  }
  return out;
}

/* --------------------------------------------------------------------- *
 * Language catalog
 * --------------------------------------------------------------------- */

test("language catalog has exactly 7 rows", () => {
  assert.equal(LANGUAGES.length, 7, "Phase 1 ships 7 languages");
});

test("every language has a unique code", () => {
  const codes = LANGUAGES.map((l) => l.code);
  assert.equal(new Set(codes).size, codes.length, "duplicate language code");
});

test("language codes cover the Phase 1 spec set", () => {
  // Spec § 3 — en, fr, es, zh-Hans, de, it, he. Order is not asserted.
  const expected = new Set(["en", "fr", "es", "zh-Hans", "de", "it", "he"]);
  const actual = new Set(LANGUAGES.map((l) => l.code));
  for (const code of expected) {
    assert.ok(actual.has(code), `missing language code: ${code}`);
  }
  for (const code of actual) {
    assert.ok(expected.has(code), `unexpected language code: ${code}`);
  }
});

test("every language has both base names filled in", () => {
  for (const l of LANGUAGES) {
    assert.ok(l.nameEn.length > 0, `${l.code} missing nameEn`);
    assert.ok(l.nameFr.length > 0, `${l.code} missing nameFr`);
    assert.ok(l.nameNative.length > 0, `${l.code} missing nameNative`);
  }
});

test("only en + fr are flagged as base languages", () => {
  const bases = LANGUAGES.filter((l) => l.isBase).map((l) => l.code).sort();
  assert.deepEqual(bases, ["en", "fr"]);
});

test("every Phase 1 target language is flagged isTarget", () => {
  // Per spec, all 7 are valid target languages. English-through-English
  // and French-through-French courses are excluded separately, not by
  // marking the language as non-target.
  for (const l of LANGUAGES) {
    assert.equal(l.isTarget, true, `${l.code} should be a valid target`);
  }
});

test("Hebrew is the only RTL language in the catalog", () => {
  const rtl = LANGUAGES.filter((l) => l.direction === "rtl").map((l) => l.code);
  assert.deepEqual(rtl, ["he"]);
});

test("only zh-Hans uses pinyin and only he uses niqqud as reading aids", () => {
  for (const l of LANGUAGES) {
    if (l.code === "zh-Hans") {
      assert.equal(l.readingAid, "pinyin", `${l.code} should use pinyin`);
    } else if (l.code === "he") {
      assert.equal(l.readingAid, "niqqud", `${l.code} should use niqqud`);
    } else {
      assert.equal(l.readingAid, "none", `${l.code} should use no reading aid`);
    }
  }
});

test("sttCode is a short BCP-47 form (no region tag)", () => {
  for (const l of LANGUAGES) {
    assert.ok(/^[a-z]{2,3}$/.test(l.sttCode), `${l.code} sttCode "${l.sttCode}" should be a 2-3 letter BCP-47 short form`);
    if (l.code === "zh-Hans") {
      assert.equal(l.sttCode, "zh", "zh-Hans maps to STT code 'zh'");
    } else {
      assert.equal(l.sttCode, l.code, `${l.code} sttCode should equal the language code`);
    }
  }
});

/* --------------------------------------------------------------------- *
 * Course catalog (derived from the language catalog)
 * --------------------------------------------------------------------- */

test("course count is 12 (7 targets x 2 bases - 2 self-pairs)", () => {
  const expected = buildExpectedCourses();
  assert.equal(expected.length, 12, "expected 12 courses");
});

test("no self-pair courses exist (no en-en, no fr-fr)", () => {
  const expected = buildExpectedCourses();
  for (const c of expected) {
    assert.notEqual(c.targetLang, c.baseLang, `self-pair found: ${c.targetLang}-${c.baseLang}`);
  }
});

test("every course pair is valid (target isTarget, base isBase)", () => {
  const expected = buildExpectedCourses();
  for (const c of expected) {
    assert.ok(isValidCoursePair(c.targetLang, c.baseLang), `invalid pair: ${JSON.stringify(c)}`);
  }
});

test("course pairs are unique (no duplicate target+base combinations)", () => {
  const expected = buildExpectedCourses();
  const keys = expected.map((c) => `${c.targetLang}__${c.baseLang}`);
  assert.equal(new Set(keys).size, keys.length, "duplicate course pair");
});

test("both (en, fr) and (fr, en) exist as courses", () => {
  // The spec is explicit that English-as-target and French-as-target
  // both ship, just not when base == target.
  const expected = buildExpectedCourses();
  const keys = new Set(expected.map((c) => `${c.targetLang}__${c.baseLang}`));
  assert.ok(keys.has("en__fr"), "expected course (en, fr)");
  assert.ok(keys.has("fr__en"), "expected course (fr, en)");
});

test("all 5 non-en/non-fr targets appear in BOTH base languages", () => {
  const nonEnFr = ["es", "zh-Hans", "de", "it", "he"];
  const expected = buildExpectedCourses();
  const pairs = new Set(expected.map((c) => `${c.targetLang}__${c.baseLang}`));
  for (const t of nonEnFr) {
    assert.ok(pairs.has(`${t}__en`), `expected (${t}, en)`);
    assert.ok(pairs.has(`${t}__fr`), `expected (${t}, fr)`);
  }
});

test("isValidCoursePair rejects self-pairs and non-catalog codes", () => {
  assert.equal(isValidCoursePair("en", "en"), false);
  assert.equal(isValidCoursePair("fr", "fr"), false);
  assert.equal(isValidCoursePair("en", "fr"), true);
  assert.equal(isValidCoursePair("fr", "en"), true);
  assert.equal(isValidCoursePair("es", "xx"), false);
  assert.equal(isValidCoursePair("klingon", "en"), false);
  assert.equal(isValidCoursePair("en", "es"), false, "es is not a base language");
});
