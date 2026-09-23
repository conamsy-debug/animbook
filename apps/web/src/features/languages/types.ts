/**
 * AnimBook Languages (Phase 1) — player-side TS types.
 *
 * Mirrors the response shape of `GET /api/lang/stories/:storyId`
 * (apps/api/src/modules/languages/routes.ts). Lives in the web
 * module so the StoryPlayer + tests can import without reaching
 * across the API boundary.
 */

export type BaseLang = "en" | "fr";

export type ReadingAid = "pinyin" | "niqqud" | null;

export interface PlayerToken {
  order: number;
  surface: string;
  reading: string | null;
  /** Stable id for the lexeme lookup (server-side PK is opaque to
   *  the player; this string carries enough info for the word popup
   *  in Patch 06 to look up the right DB row). */
  lexemeId: string | null;
  isNewInStory: boolean;
  isPunctuation: boolean;
  startChar: number;
  endChar: number;
}

export interface PlayerLine {
  lineId: string;
  order: number;
  speaker: string;
  text: string;
  textReading: string | null;
  /** Translation in the requested base language. */
  translation: string;
  tokens: PlayerToken[];
}

export interface PlayerExercise {
  exerciseId: string;
  order: number;
  type: string;
  payload: Record<string, unknown>;
  answer: Record<string, unknown> | null;
}

export interface PlayerScene {
  sceneId: string;
  order: number;
  clipUrl: string | null;
  lines: PlayerLine[];
  exercises: PlayerExercise[];
}

export interface PlayerPayload {
  storyId: string;
  masterSlug: string;
  targetLang: string;
  baseLang: BaseLang;
  /** BCP-47 — `<html lang>` + the Language.code column. */
  lang: string;
  direction: "ltr" | "rtl";
  fontFamily: string | null;
  readingAid: ReadingAid;
  title: string;
  titleTranslations: { en: string; fr: string };
  scenes: PlayerScene[];
  newLexemeCount: number;
}

/** Playback speed selector — spec § 7. */
export type PlaybackSpeed = 0.75 | 1;

/** Player view state. */
export type PlayerPhase = "loading" | "ready" | "error";

export interface PlayerToggles {
  /** Show the translation underneath the target text. Default false
   *  so the learner reads the target first. */
  showTranslation: boolean;
  /** Show the reading aid (pinyin for zh, pointed for he). Default
   *  true for languages that have one. */
  showReadingAid: boolean;
}

/** Re-export BaseLang for convenience. */
export type { BaseLang as PlayerBaseLang };
