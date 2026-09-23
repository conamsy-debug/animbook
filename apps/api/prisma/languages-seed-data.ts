/**
 * Pure data for the AnimBook Languages (Phase 1) seed.
 *
 * Lives in its own file so the runnable seed (`languages-seed.ts`) can
 * import it AND so the test (`languagesSeed.test.mjs`) can mirror the
 * exact shape via Node's test runner — Node 24 can't resolve Prisma
 * client + path aliases reliably, so the test re-creates these tables
 * inline. Any drift here is a real bug, not a test artefact.
 *
 * Source of truth: docs/languages-phase1.md § 3 (language config) +
 * § 4 (data model). Patch 02 ships the catalog only; course content
 * (stories, scenes, lines, exercises) lands in Patch 03 onward.
 *
 * Course count: 7 targets × 2 bases − (en,en) − (fr,fr) = 12. The
 * pinned `COURSE_COUNT` export guards against a future drift when the
 * language catalog grows.
 */

export const LANG_CODE_EN = "en";
export const LANG_CODE_FR = "fr";
export const LANG_CODE_ES = "es";
export const LANG_CODE_ZH_HANS = "zh-Hans";
export const LANG_CODE_DE = "de";
export const LANG_CODE_IT = "it";
export const LANG_CODE_HE = "he";

/**
 * Every Phase 1 language row. Mirrors spec § 3 (language configuration).
 *
 * `fontFamily` is the web font CSS family the player + word popup
 * must use for the language's native text (spec § 7). Noto Sans SC
 * is mandated for zh-Hans; Noto Sans Hebrew for he; the rest fall
 * back to the AnimBook shell's default Inter.
 *
 * `ttsVoiceIds` is empty for Phase 1. Patch 11's content pipeline
 * writes the real ElevenLabs narrator + character voice IDs once a
 * language's first story is processed.
 *
 * `isActive` defaults to true; an operator can flip it false from
 * the admin screen (Patch 12) to retire a language without losing
 * its seeded data.
 */
export const LANGUAGE_SEED = [
  {
    code: LANG_CODE_EN,
    nameEn: "English",
    nameFr: "Anglais",
    nameNative: "English",
    direction: "ltr",
    script: "Latin",
    readingAid: "none",
    sttCode: "en",
    ttsVoiceIds: {} as Record<string, never>,
    fontFamily: null,
    isTarget: true,
    isBase: true,
    isActive: true
  },
  {
    code: LANG_CODE_FR,
    nameEn: "French",
    nameFr: "Français",
    nameNative: "Français",
    direction: "ltr",
    script: "Latin",
    readingAid: "none",
    sttCode: "fr",
    ttsVoiceIds: {} as Record<string, never>,
    fontFamily: null,
    isTarget: true,
    isBase: true,
    isActive: true
  },
  {
    code: LANG_CODE_ES,
    nameEn: "Spanish",
    nameFr: "Espagnol",
    nameNative: "Español",
    direction: "ltr",
    script: "Latin",
    readingAid: "none",
    sttCode: "es",
    ttsVoiceIds: {} as Record<string, never>,
    fontFamily: null,
    isTarget: true,
    isBase: false,
    isActive: true
  },
  {
    code: LANG_CODE_ZH_HANS,
    nameEn: "Chinese (Mandarin)",
    nameFr: "Chinois (mandarin)",
    nameNative: "中文",
    direction: "ltr",
    script: "Han (Simplified)",
    readingAid: "pinyin",
    sttCode: "zh",
    ttsVoiceIds: {} as Record<string, never>,
    // Spec § 7 — Noto Sans SC for Chinese.
    fontFamily: "Noto Sans SC, system-ui, sans-serif",
    isTarget: true,
    isBase: false,
    isActive: true
  },
  {
    code: LANG_CODE_DE,
    nameEn: "German",
    nameFr: "Allemand",
    nameNative: "Deutsch",
    direction: "ltr",
    script: "Latin",
    readingAid: "none",
    sttCode: "de",
    ttsVoiceIds: {} as Record<string, never>,
    fontFamily: null,
    isTarget: true,
    isBase: false,
    isActive: true
  },
  {
    code: LANG_CODE_IT,
    nameEn: "Italian",
    nameFr: "Italien",
    nameNative: "Italiano",
    direction: "ltr",
    script: "Latin",
    readingAid: "none",
    sttCode: "it",
    ttsVoiceIds: {} as Record<string, never>,
    fontFamily: null,
    isTarget: true,
    isBase: false,
    isActive: true
  },
  {
    code: LANG_CODE_HE,
    nameEn: "Hebrew",
    nameFr: "Hébreu",
    nameNative: "עברית",
    direction: "rtl",
    script: "Hebrew",
    readingAid: "niqqud",
    sttCode: "he",
    ttsVoiceIds: {} as Record<string, never>,
    // Spec § 7 — Noto Sans Hebrew for Hebrew.
    fontFamily: "Noto Sans Hebrew, system-ui, sans-serif",
    isTarget: true,
    isBase: false,
    isActive: true
  }
] as const;

export type LanguageSeedRow = (typeof LANGUAGE_SEED)[number];

/**
 * Every Phase 1 course row. 7 targets × 2 bases − 2 self-pairs = 12.
 * `title` and `description` are written in the BASE language, since
 * the course shell renders in the learner's UI language. Patch 05
 * reads `base_lang` to pick which row to show for a given enrollment.
 *
 * Description lines are intentionally short — the longer marketing
 * copy arrives with Patch 04 (story player) when we know the actual
 * first story each course will ship with.
 */
export const COURSE_SEED = [
  // base = en (5)
  {
    targetLang: LANG_CODE_FR,
    baseLang: LANG_CODE_EN,
    title: "French for English speakers",
    description:
      "Learn French through animated stories. Begin with A1 greetings, numbers and everyday scenes; climb to A2 by the end of the first course pack."
  },
  {
    targetLang: LANG_CODE_ES,
    baseLang: LANG_CODE_EN,
    title: "Spanish for English speakers",
    description:
      "Learn Spanish through animated stories. Begin with A1 greetings, numbers and everyday scenes; climb to A2 by the end of the first course pack."
  },
  {
    targetLang: LANG_CODE_ZH_HANS,
    baseLang: LANG_CODE_EN,
    title: "Chinese (Mandarin) for English speakers",
    description:
      "Learn Mandarin through animated stories with pinyin reading aids layered above every line. Begin with A1 tones, greetings and numbers."
  },
  {
    targetLang: LANG_CODE_DE,
    baseLang: LANG_CODE_EN,
    title: "German for English speakers",
    description:
      "Learn German through animated stories. Begin with A1 greetings, numbers and everyday scenes; learn gendered nouns in context."
  },
  {
    targetLang: LANG_CODE_IT,
    baseLang: LANG_CODE_EN,
    title: "Italian for English speakers",
    description:
      "Learn Italian through animated stories. Begin with A1 greetings, numbers and everyday scenes; pick up musical phrasing naturally."
  },
  {
    targetLang: LANG_CODE_HE,
    baseLang: LANG_CODE_EN,
    title: "Hebrew for English speakers",
    description:
      "Learn Hebrew through animated stories read right-to-left with niqqud vowel marks. Begin with A1 greetings, the aleph-bet and everyday scenes."
  },

  // base = fr (5)
  {
    targetLang: LANG_CODE_EN,
    baseLang: LANG_CODE_FR,
    title: "L'anglais pour francophones",
    description:
      "Apprends l'anglais à travers des histoires animées. Commence par les salutations, les chiffres et les scènes du quotidien au niveau A1."
  },
  {
    targetLang: LANG_CODE_ES,
    baseLang: LANG_CODE_FR,
    title: "L'espagnol pour francophones",
    description:
      "Apprends l'espagnol à travers des histoires animées. Commence par les salutations, les chiffres et les scènes du quotidien au niveau A1."
  },
  {
    targetLang: LANG_CODE_ZH_HANS,
    baseLang: LANG_CODE_FR,
    title: "Le chinois (mandarin) pour francophones",
    description:
      "Apprends le mandarin à travers des histoires animées avec le pinyin superposé à chaque ligne. Commence par les tons, les salutations et les chiffres."
  },
  {
    targetLang: LANG_CODE_DE,
    baseLang: LANG_CODE_FR,
    title: "L'allemand pour francophones",
    description:
      "Apprends l'allemand à travers des histoires animées. Commence par les salutations, les chiffres et les scènes du quotidien ; découvre les genres en contexte."
  },
  {
    targetLang: LANG_CODE_IT,
    baseLang: LANG_CODE_FR,
    title: "L'italien pour francophones",
    description:
      "Apprends l'italien à travers des histoires animées. Commence par les salutations, les chiffres et les scènes du quotidien."
  },
  {
    targetLang: LANG_CODE_HE,
    baseLang: LANG_CODE_FR,
    title: "L'hébreu pour francophones",
    description:
      "Apprends l'hébreu à travers des histoires animées lues de droite à gauche avec les voyelles niqqud. Commence par l'aleph-bet et les salutations au niveau A1."
  }
] as const;

export type CourseSeedRow = (typeof COURSE_SEED)[number];

/** Pinned totals — tests assert these. */
export const LANGUAGE_COUNT = LANGUAGE_SEED.length;
export const COURSE_COUNT = COURSE_SEED.length;

/**
 * Pure helper: returns true iff `(targetLang, baseLang)` is a valid
 * Phase 1 course pair. Excludes the two self-pairs (en-en, fr-fr).
 * Used by the seed (to filter before upsert) and by the test (to
 * pin the math).
 */
export function isValidCoursePair(targetLang: string, baseLang: string): boolean {
  if (targetLang === baseLang) return false;
  return (
    LANGUAGE_SEED.some((l) => l.code === targetLang && l.isTarget) &&
    LANGUAGE_SEED.some((l) => l.code === baseLang && l.isBase)
  );
}
