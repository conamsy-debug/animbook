/**
 * AnimBook Languages (Phase 1) — Lesson content types.
 *
 * Mirrors docs/languages-phase1.md § 5. The Zod schema in
 * `schema.ts` is the source of truth for validation; these types
 * are the inferred shape for downstream code.
 *
 * Pure types — no runtime cost. Importing this file must not pull in
 * the importer or the Prisma client.
 */

/** A BCP-47 language code Phase 1 supports. Mirrors the seeded `Language.code`. */
export type Phase1LangCode = "en" | "fr" | "es" | "zh-Hans" | "de" | "it" | "he";

/** CEFR level a story is authored at. Schema supports A1..C2; Phase 1 only ships A1. */
export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/** The five Phase 1 exercise types — see docs § 8 for payload/answer shapes. */
export type ExerciseType =
  | "comprehension_mc"
  | "word_meaning_mc"
  | "sentence_builder"
  | "listen_select"
  | "speak_line";

/** A tappable token. Punctuation tokens have lemma=null (spec § 4). */
export interface LessonToken {
  /** The text as it appears in the line, including any punctuation. */
  surface: string;
  /** Dictionary form, or null for punctuation tokens. */
  lemma: string | null;
  /** Part of speech; required when lemma is set. */
  pos?: string;
  /** Grammatical gender (de/fr/es/it/he); null otherwise. */
  gender?: "m" | "f" | "n" | null;
  /** Per-base-language glosses. Required when lemma is set. */
  glosses?: { en?: string[]; fr?: string[] };
  /** Per-token reading aid — tone-marked pinyin (zh) or pointed form (he). */
  reading?: string | null;
  /** True if this token introduces a new word for the story's vocab deck. */
  is_new?: boolean;
}

/** One spoken subtitle line. */
export interface LessonLine {
  /** Character key from the master story, or "narrator". */
  speaker: string;
  /** Target-language text as displayed to the learner. */
  text: string;
  /** Reading aid layered above `text` (pinyin for zh, pointed for he). */
  text_reading?: string | null;
  /** Per-base-language translations. */
  translations: { en: string; fr: string };
  /** Ordered tappable tokens. */
  tokens: LessonToken[];
}

/** A discriminated payload for each of the five exercise types. */
export type LessonExercisePayload =
  | {
      type: "comprehension_mc";
      payload: { question: { en: string; fr: string }; options: string[] };
      answer: { index: number };
    }
  | {
      type: "word_meaning_mc";
      payload: { lexeme_id: string; options: { en: string[]; fr: string[] } };
      answer: { index: number };
    }
  | {
      type: "sentence_builder";
      payload: { line_id: string; tokens: string[] };
      answer: { order: number[] };
    }
  | {
      type: "listen_select";
      payload: { audio_url: string; options: string[] };
      answer: { index: number };
    }
  | {
      type: "speak_line";
      payload: { line_id: string };
      answer: null;
    };

/** Flattened shape for the validator — see `schema.ts` for the actual Zod types. */
export type LessonExercise = LessonExercisePayload & { type: ExerciseType };

/** One scene as it appears in the lesson JSON. */
export interface LessonScene {
  /** 1-indexed position within the master story. */
  master_scene_order: number;
  lines: LessonLine[];
  exercises: LessonExercise[];
}

/** Top-level lesson JSON shape — one per-language version of a master story. */
export interface Lesson {
  master_story_slug: string;
  target_lang: Phase1LangCode;
  cefr_level: CefrLevel;
  /** Localised title in the target language. */
  title: string;
  /** Title in the base languages. */
  title_translations: { en: string; fr: string };
  /** Optional free-text synopsis; falls back to title_en when missing. */
  synopsis?: string;
  /** Optional ordered list of concept tags the story teaches. */
  target_vocab_concepts?: string[];
  scenes: LessonScene[];
}

/**
 * Result of an import. Counts let callers log "imported 2 scenes,
 * 18 lines, 47 tokens, 9 new lexemes" without re-querying.
 */
export interface ImportResult {
  masterStoryId: string;
  storyId: string;
  scenesCreated: number;
  linesCreated: number;
  tokensCreated: number;
  lexemesCreated: number;
  lexemesReused: number;
  exercisesCreated: number;
}
