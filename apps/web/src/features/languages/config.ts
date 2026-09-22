/**
 * AnimBook Languages (web) — module-level config + feature flag.
 *
 * Reads NEXT_PUBLIC_LANGUAGES_ENABLED at build time. Next.js inlines
 * `process.env.NEXT_PUBLIC_*` into the client bundle, so this is also
 * available at runtime without an extra round-trip. We DEFAULTS to
 * false when the env var is missing — the feature is invisible until
 * the operator turns it on.
 *
 * This file also mirrors the Phase 1 language configuration from
 * docs/languages-phase1.md § 3. The backend owns the seeded
 * `languages` table; this typed mirror is used by the landing page,
 * the i18n fallback, and (later) the language picker. Patch 02 will
 * keep these in sync via a startup ping + a future replacement by a
 * live API fetch.
 */

export type LangCode =
  | "en"
  | "fr"
  | "es"
  | "zh-Hans"
  | "de"
  | "it"
  | "he";

export interface LanguageConfig {
  code: LangCode;
  nameEn: string;
  nameFr: string;
  nameNative: string;
  direction: "ltr" | "rtl";
  script: "Latin" | "Han (Simplified)" | "Hebrew";
  readingAid: "none" | "pinyin" | "niqqud";
  sttCode: string;
  /** Whether learners can pick this as a target language. */
  isTarget: boolean;
  /** Whether learners can pick this as their base/instruction language. */
  isBase: boolean;
}

export const LANGUAGES: LanguageConfig[] = [
  {
    code: "en",
    nameEn: "English",
    nameFr: "Anglais",
    nameNative: "English",
    direction: "ltr",
    script: "Latin",
    readingAid: "none",
    sttCode: "en",
    isTarget: true,
    isBase: true
  },
  {
    code: "fr",
    nameEn: "French",
    nameFr: "Français",
    nameNative: "Français",
    direction: "ltr",
    script: "Latin",
    readingAid: "none",
    sttCode: "fr",
    isTarget: true,
    isBase: true
  },
  {
    code: "es",
    nameEn: "Spanish",
    nameFr: "Espagnol",
    nameNative: "Español",
    direction: "ltr",
    script: "Latin",
    readingAid: "none",
    sttCode: "es",
    isTarget: true,
    isBase: false
  },
  {
    code: "zh-Hans",
    nameEn: "Chinese (Mandarin)",
    nameFr: "Chinois (mandarin)",
    nameNative: "中文",
    direction: "ltr",
    script: "Han (Simplified)",
    readingAid: "pinyin",
    sttCode: "zh",
    isTarget: true,
    isBase: false
  },
  {
    code: "de",
    nameEn: "German",
    nameFr: "Allemand",
    nameNative: "Deutsch",
    direction: "ltr",
    script: "Latin",
    readingAid: "none",
    sttCode: "de",
    isTarget: true,
    isBase: false
  },
  {
    code: "it",
    nameEn: "Italian",
    nameFr: "Italien",
    nameNative: "Italiano",
    direction: "ltr",
    script: "Latin",
    readingAid: "none",
    sttCode: "it",
    isTarget: true,
    isBase: false
  },
  {
    code: "he",
    nameEn: "Hebrew",
    nameFr: "Hébreu",
    nameNative: "עברית",
    direction: "rtl",
    script: "Hebrew",
    readingAid: "niqqud",
    sttCode: "he",
    isTarget: true,
    isBase: false
  }
];

/**
 * Build-time feature flag. Set NEXT_PUBLIC_LANGUAGES_ENABLED=true in
 * apps/web/.env.local (or production env) to enable the feature; the
 * landing page mounts, the Topbar link appears, and the API mounts
 * its /api/lang/* routes. When false, the /languages route renders
 * the <NotAvailable /> screen and the Topbar link is omitted.
 */
export const LANGUAGES_ENABLED = process.env.NEXT_PUBLIC_LANGUAGES_ENABLED === "true";

/** Lookup helpers used by the player, picker and admin UI. */
export function getLanguage(code: LangCode): LanguageConfig | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export function getBaseLanguages(): LanguageConfig[] {
  return LANGUAGES.filter((l) => l.isBase);
}

export function getTargetLanguages(): LanguageConfig[] {
  return LANGUAGES.filter((l) => l.isTarget);
}
