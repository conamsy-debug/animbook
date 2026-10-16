/**
 * AnimBook Languages (Phase 1) — Lesson JSON schema.
 *
 * Wraps Zod to validate the lesson content format from spec § 5.
 * The pure-function `parseLesson(input)` returns a typed object or
 * a `LessonValidationError` with a flat, human-readable list of
 * problem paths so the importer (and Patch 11's content pipeline
 * retry loop) can surface failures without blowing up on a stack
 * trace.
 *
 * The Zod instance used here is the v3 namespace — AnimBook's
 * dependency tree ships `zod@^3.24.2` from the root, so we keep
 * the same import path the rest of the codebase uses.
 */
import { z } from "zod";

/* --------------------------------------------------------------------- *
 * Enums (kept in lockstep with apps/api/src/services/languages/types.ts).
 * --------------------------------------------------------------------- */

const PHASE_1_LANG_CODES = ["en", "fr", "es", "zh-Hans", "de", "it", "he"] as const;
const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const EXERCISE_TYPES = [
  "comprehension_mc",
  "word_meaning_mc",
  "sentence_builder",
  "listen_select",
  "speak_line"
] as const;
const GENDERS = ["m", "f", "n", null] as const;

/* --------------------------------------------------------------------- *
 * Reusable building blocks
 * --------------------------------------------------------------------- */

const langCode = z.enum(PHASE_1_LANG_CODES);
const cefrLevel = z.enum(CEFR_LEVELS);
const exerciseType = z.enum(EXERCISE_TYPES);
const gender = z.enum(["m", "f", "n"]).nullable().optional();

/**
 * Per-base-language object used by translations + glosses.
 *
 * Note: we don't bake the "at least one of {en, fr}" refine here —
 * the parent (lessonTokenSchema) needs to accept empty arrays on
 * punctuation tokens (lemma=null). Word-token gloss validation lives
 * on the token schema, which knows whether the lemma is set.
 */
const bilingualStringArray = z.object({
  en: z.array(z.string()).optional(),
  fr: z.array(z.string()).optional()
});

const bilingualString = z.object({
  en: z.string().min(1),
  fr: z.string().min(1)
});

/* --------------------------------------------------------------------- *
 * Token
 * --------------------------------------------------------------------- */

const lessonTokenSchema = z
  .object({
    surface: z.string().min(1, "token surface must be a non-empty string"),
    lemma: z.string().nullable(),
    // `pos` must accept `null` so Claude's punctuation tokens
    // (".", "!", "?", "," etc.) — which carry `lemma: null` — still
    // validate when the model emits `pos: null` instead of omitting
    // the key.
    pos: z.string().nullable().optional(),
    gender,
    glosses: bilingualStringArray.optional(),
    reading: z.string().nullable().optional(),
    is_new: z.boolean().optional()
  })
  .refine(
    (t) => {
      // Punctuation tokens have lemma=null and need no pos/glosses.
      if (t.lemma === null) return true;
      // Word tokens must have pos + at least one gloss.
      return Boolean(t.pos);
    },
    { message: "tokens with a lemma must include `pos`", path: ["pos"] }
  )
  .refine(
    (t) => {
      // Punctuation tokens (lemma=null) are allowed to carry empty
      // gloss arrays. Claude emits `{"en": [], "fr": []}` for "." so
      // the bilingual refine fails otherwise. The pre-conditions on
      // word tokens (at least one gloss populated) are still enforced
      // because `lemma !== null` here.
      if (t.lemma === null) return true;
      const g = t.glosses as { en?: string[]; fr?: string[] } | undefined;
      return Boolean(g?.en?.length) || Boolean(g?.fr?.length);
    },
    { message: "tokens with a lemma must include non-empty glosses.en or glosses.fr", path: ["glosses"] }
  )
  .refine(
    (t) => {
      if (t.lemma === null) return true;
      // Spec § 5 — Chinese tokens must carry a reading.
      return true; // reading is optional in the schema, but per-language
                   // validation (Patch 04) enforces zh requires it.
    }
  );

/* --------------------------------------------------------------------- *
 * Line
 * --------------------------------------------------------------------- */

const lessonLineSchema = z.object({
  speaker: z.string().min(1),
  text: z.string().min(1, "line text must be non-empty"),
  text_reading: z.string().nullable().optional(),
  translations: bilingualString,
  tokens: z.array(lessonTokenSchema).min(1, "each line needs at least one token")
});

/* --------------------------------------------------------------------- *
 * Exercise (discriminated union on `type`)
 * --------------------------------------------------------------------- */

const comprehensionMc = z.object({
  type: z.literal("comprehension_mc"),
  payload: z.object({
    question: bilingualString,
    options: z.array(z.string()).min(2, "need at least 2 options").max(6)
  }),
  answer: z.object({ index: z.number().int().nonnegative() })
});

const wordMeaningMc = z.object({
  type: z.literal("word_meaning_mc"),
  payload: z.object({
    lexeme_id: z.string().min(1),
    options: z.object({
      en: z.array(z.string()).min(2),
      fr: z.array(z.string()).min(2)
    })
  }),
  answer: z.object({ index: z.number().int().nonnegative() })
});

const sentenceBuilder = z.object({
  type: z.literal("sentence_builder"),
  payload: z.object({
    line_id: z.string().min(1),
    tokens: z.array(z.string()).min(1)
  }),
  answer: z.object({ order: z.array(z.number().int().nonnegative()).min(1) })
});

const listenSelect = z.object({
  type: z.literal("listen_select"),
  payload: z.object({
    audio_url: z.string().url().or(z.literal("")).or(z.string().startsWith("placeholder://")),
    options: z.array(z.string()).min(2).max(6)
  }),
  answer: z.object({ index: z.number().int().nonnegative() })
});

const speakLine = z.object({
  type: z.literal("speak_line"),
  payload: z.object({ line_id: z.string().min(1) }),
  answer: z.null()
});

const lessonExerciseSchema = z.discriminatedUnion("type", [
  comprehensionMc,
  wordMeaningMc,
  sentenceBuilder,
  listenSelect,
  speakLine
]);

/* --------------------------------------------------------------------- *
 * Scene
 * --------------------------------------------------------------------- */

const lessonSceneSchema = z.object({
  master_scene_order: z.number().int().positive("scene order must be >= 1"),
  lines: z.array(lessonLineSchema).min(1, "each scene needs at least one line"),
  exercises: z.array(lessonExerciseSchema).default([])
});

/* --------------------------------------------------------------------- *
 * Top-level lesson
 * --------------------------------------------------------------------- */

const lessonSchema = z.object({
  master_story_slug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9-]+$/, "master_story_slug must be kebab-case (a-z, 0-9, -)"),
  target_lang: langCode,
  cefr_level: cefrLevel,
  title: z.string().min(1).max(500),
  title_translations: bilingualString,
  synopsis: z.string().max(2000).optional(),
  target_vocab_concepts: z.array(z.string()).optional(),
  scenes: z.array(lessonSceneSchema).min(1, "a lesson needs at least one scene").max(20)
});

/** TypeScript-inferred types from the schema — the runtime validator
 *  is the source of truth, the types below are convenience aliases. */
export type ParsedLesson = z.infer<typeof lessonSchema>;

/* --------------------------------------------------------------------- *
 * Public surface
 * --------------------------------------------------------------------- */

export class LessonValidationError extends Error {
  readonly issues: Array<{ path: string; message: string }>;

  constructor(issues: Array<{ path: string; message: string }>) {
    const formatted = issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
    super(`Lesson validation failed:\n${formatted}`);
    this.name = "LessonValidationError";
    this.issues = issues;
  }
}

/* --------------------------------------------------------------------- *
 * Normaliser — flatten-shape fallback
 * --------------------------------------------------------------------- *
 * Claude (and every other LLM we will swap in) sometimes emits the
 * exercise fields at the TOP level of each exercise instead of
 * nested under `payload`. We've also seen `choices` where the schema
 * wants `options`, and `expected_text` / `text` where `speak_line`
 * expects just `payload: { line_id }`. The schema stays strict so
 * the importer sees the canonical shape, but `parseLesson` (and the
 * orchestrator's retry loop) accept the common drift shapes by
 * lifting flat fields into `payload` BEFORE the Zod check runs.
 *
 * Returns the (possibly modified) input — never throws on
 * normalisation. Validation errors still come from Zod.
 *
 * Normalisations:
 *   comprehension_mc / word_meaning_mc / listen_select:
 *     top-level `question`  → payload.question
 *     top-level `options` or `choices` → payload.options
 *   word_meaning_mc:
 *     top-level `lexeme_id` → payload.lexeme_id
 *   sentence_builder:
 *     top-level `tokens`    → payload.tokens
 *     top-level `line_id`   → payload.line_id
 *   listen_select:
 *     top-level `audio_url` → payload.audio_url
 *   speak_line:
 *     top-level `line_id` or `expected_text` or `text` → payload.line_id
 *
 * Anything already nested is left alone. Unknown keys are kept (Zod
 * will strip them via `.strip()` semantics, but we don't need to
 * touch them here).
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function normaliseExerciseShape(ex: unknown): unknown {
  if (!isRecord(ex)) return ex;
  const type = ex["type"];
  if (typeof type !== "string") return ex;
  // Already has a populated payload — assume canonical, don't touch.
  const existingPayload = ex["payload"];
  const hasPayload = isRecord(existingPayload);
  const out: Record<string, unknown> = { ...ex };

  switch (type) {
    case "comprehension_mc": {
      const payload: Record<string, unknown> = hasPayload ? { ...existingPayload } : {};
      if (!("question" in payload) && "question" in ex) payload["question"] = ex["question"];
      if (!("options" in payload)) {
        if ("options" in ex) payload["options"] = ex["options"];
        else if ("choices" in ex) payload["options"] = ex["choices"];
      }
      out["payload"] = payload;
      break;
    }
    case "word_meaning_mc": {
      const payload: Record<string, unknown> = hasPayload ? { ...existingPayload } : {};
      if (!("lexeme_id" in payload) && "lexeme_id" in ex)
        payload["lexeme_id"] = ex["lexeme_id"];
      if (!("options" in payload)) {
        if ("options" in ex) payload["options"] = ex["options"];
        else if ("choices" in ex) payload["options"] = ex["choices"];
      }
      out["payload"] = payload;
      break;
    }
    case "sentence_builder": {
      const payload: Record<string, unknown> = hasPayload ? { ...existingPayload } : {};
      if (!("line_id" in payload) && "line_id" in ex)
        payload["line_id"] = ex["line_id"];
      if (!("tokens" in payload) && "tokens" in ex)
        payload["tokens"] = ex["tokens"];
      out["payload"] = payload;
      break;
    }
    case "listen_select": {
      const payload: Record<string, unknown> = hasPayload ? { ...existingPayload } : {};
      if (!("audio_url" in payload) && "audio_url" in ex)
        payload["audio_url"] = ex["audio_url"];
      if (!("options" in payload)) {
        if ("options" in ex) payload["options"] = ex["options"];
        else if ("choices" in ex) payload["options"] = ex["choices"];
      }
      out["payload"] = payload;
      break;
    }
    case "speak_line": {
      const payload: Record<string, unknown> = hasPayload ? { ...existingPayload } : {};
      if (!("line_id" in payload)) {
        if ("line_id" in ex) payload["line_id"] = ex["line_id"];
        else if ("expected_text" in ex) payload["line_id"] = ex["expected_text"];
        else if ("text" in ex) payload["line_id"] = ex["text"];
      }
      out["payload"] = payload;
      break;
    }
    default:
      return ex;
  }
  return out;
}

/**
 * Walk every scene's `exercises[]` and lift flat exercise fields into
 * `payload` before Zod parses the lesson. Returns a (possibly
 * modified) copy of the lesson — never mutates the input.
 */
export function normaliseLessonShape(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const scenes = input["scenes"];
  if (!Array.isArray(scenes)) return input;
  let touched = false;
  const newScenes = scenes.map((scene) => {
    if (!isRecord(scene)) return scene;
    const exercises = scene["exercises"];
    if (!Array.isArray(exercises)) return scene;
    let sceneTouched = false;
    const newExercises = exercises.map((ex) => {
      const normalised = normaliseExerciseShape(ex);
      if (normalised !== ex) sceneTouched = true;
      return normalised;
    });
    if (!sceneTouched) return scene;
    touched = true;
    return { ...scene, exercises: newExercises };
  });
  if (!touched) return input;
  return { ...input, scenes: newScenes };
}

/**
 * Validate + coerce a lesson. Returns the parsed object on success
 * or throws `LessonValidationError` with a flat, sorted list of
 * issues on failure. The importer + the Patch 11 content pipeline
 * both rely on this throwing on invalid input.
 */
export function parseLesson(input: unknown): ParsedLesson {
  const normalised = normaliseLessonShape(input);
  const result = lessonSchema.safeParse(normalised);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => ({
      path: i.path.length === 0 ? "<root>" : i.path.join("."),
      message: i.message
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  throw new LessonValidationError(issues);
}

/** Soft variant — returns `{ ok, data?, issues? }` for callers that
 *  prefer not to throw (e.g. the admin preview endpoint). */
export function tryParseLesson(
  input: unknown
):
  | { ok: true; data: ParsedLesson }
  | { ok: false; issues: Array<{ path: string; message: string }> } {
  const normalised = normaliseLessonShape(input);
  const result = lessonSchema.safeParse(normalised);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues
    .map((i) => ({
      path: i.path.length === 0 ? "<root>" : i.path.join("."),
      message: i.message
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { ok: false, issues };
}
