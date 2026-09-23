/**
 * AnimBook Languages (Phase 1) — API client.
 *
 * Thin wrapper around fetch() that talks to `/api/lang/*`. The
 * server returns 404 when the Languages feature flag is off, so
 * a missing route = feature disabled, which the caller can branch
 * on without an extra health check.
 *
 * Patch 04 added fetchStoryPlayer; Patch 05 adds the catalog,
 * courses, enrollments, course home, and story progress endpoints.
 */
import type { PlayerPayload } from "./types";

/** Phase 1 base languages the player supports. Spec § 3. */
export type BaseLang = "en" | "fr";

/** All Phase 1 language codes — base or target. */
export type LangCode = "en" | "fr" | "es" | "zh-Hans" | "de" | "it" | "he";

/** Shape of one row returned by GET /api/lang/languages. */
export interface LanguageRow {
  code: LangCode;
  nameEn: string;
  nameFr: string;
  nameNative: string;
  direction: "ltr" | "rtl";
  script: string;
  readingAid: "none" | "pinyin" | "niqqud";
  sttCode: string;
  fontFamily: string | null;
  isTarget: boolean;
  isBase: boolean;
  isActive: boolean;
}

/** Shape of one row returned by GET /api/lang/courses. */
export interface CourseRow {
  courseId: string;
  targetLang: LangCode;
  baseLang: BaseLang;
  title: string;
  description: string | null;
}

/** Shape of one row returned by GET /api/lang/enrollments/me. */
export interface EnrollmentRow {
  enrollmentId: string;
  courseId: string;
  targetLang: LangCode;
  baseLang: BaseLang;
  title: string;
  description: string | null;
  startedAt: string;
  lastActiveAt: string;
  currentStoryId: string | null;
}

/** Story progress row embedded in /courses/:courseId. */
export interface StoryProgressLite {
  status: string;
  lastSceneOrder: number;
  scorePct: number;
  completedAt: string | null;
}

/** Story row in the course home payload. */
export interface CourseStoryRow {
  storyId: string;
  masterSlug: string;
  title: string;
  cefrLevel: string;
  progress: StoryProgressLite | null;
}

/** Stats rollup returned by /courses/:courseId. */
export interface LearnerStatsLite {
  xpTotal: number;
  currentStreakDays: number;
  longestStreakDays: number;
  lastActivityDate: string | null;
}

/** Full course home payload. */
export interface CourseHomePayload {
  course: {
    courseId: string;
    targetLang: LangCode;
    baseLang: BaseLang;
    title: string;
    description: string | null;
  };
  enrollment: {
    enrollmentId: string;
    startedAt: string;
    lastActiveAt: string;
    currentStoryId: string | null;
  } | null;
  stats: LearnerStatsLite | null;
  stories: CourseStoryRow[];
}

/** Result of POST /api/lang/enrollments. */
export interface EnrollmentCreateResult {
  enrollmentId: string;
  courseId: string;
  targetLang: LangCode;
  baseLang: BaseLang;
  startedAt: string;
  lastActiveAt: string;
  currentStoryId: string | null;
}

/** Result of POST /api/lang/stories/:storyId/progress. */
export interface StoryProgressWriteResult {
  storyProgressId: string;
  storyId: string;
  status: string;
  lastSceneOrder: number;
  scorePct: number;
  completedAt: string | null;
}

/* --------------------------------------------------------------------- *
 * Fetch helpers
 * --------------------------------------------------------------------- */

async function jsonFetch<T>(
  path: string,
  init: RequestInit & { signal?: AbortSignal } = {}
): Promise<T | null> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
    ...init
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      `${init.method ?? "GET"} ${path}: ${res.status} ${res.statusText}${body?.error ? ` — ${body.error}` : ""}`
    );
  }
  return (await res.json()) as T;
}

/**
 * Fetch the player payload for a story. `base` selects which
 * translation language to surface (defaults to en). On a 404 the
 * function returns `null` — the page treats that as "feature off
 * or story not published" and shows a friendly fallback.
 */
export async function fetchStoryPlayer(
  storyId: string,
  base: BaseLang = "en",
  signal?: AbortSignal
): Promise<PlayerPayload | null> {
  return jsonFetch<PlayerPayload>(
    `/api/lang/stories/${encodeURIComponent(storyId)}?base=${base}`,
    { method: "GET", signal }
  );
}

/**
 * Build the synthetic storyId the server expects from a masterSlug
 * + targetLang pair. Kept here so the page route doesn't need to
 * know the wire format.
 */
export function storyIdFromParts(masterSlug: string, targetLang: string): string {
  return `story:${masterSlug}:${targetLang}`;
}

/**
 * GET /api/lang/languages — the active languages catalog.
 * Spec § 11. Returns `null` when the feature flag is off (404).
 */
export async function fetchLanguages(signal?: AbortSignal): Promise<LanguageRow[] | null> {
  const data = await jsonFetch<{ languages: LanguageRow[] }>("/api/lang/languages", {
    method: "GET",
    signal
  });
  return data ? data.languages : null;
}

/**
 * GET /api/lang/courses?base=… — courses for a base language.
 * Spec § 11. Returns `null` when the feature flag is off (404) or
 * the query is malformed.
 */
export async function fetchCourses(
  base: BaseLang,
  signal?: AbortSignal
): Promise<CourseRow[] | null> {
  const data = await jsonFetch<{ base: BaseLang; courses: CourseRow[] }>(
    `/api/lang/courses?base=${base}`,
    { method: "GET", signal }
  );
  return data ? data.courses : null;
}

/**
 * POST /api/lang/enrollments — create / upsert an enrollment.
 * Idempotent on (user, course). Spec § 11.
 */
export async function enrollInCourse(input: {
  targetLang: LangCode;
  baseLang: BaseLang;
  /** Accepted but not yet persisted (lands with Patch 10 stats). */
  dailyGoal?: number;
}): Promise<EnrollmentCreateResult> {
  const res = await fetch("/api/lang/enrollments", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      target_lang: input.targetLang,
      base_lang: input.baseLang,
      daily_goal: input.dailyGoal
    })
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      `POST /api/lang/enrollments: ${res.status} ${res.statusText}${body?.error ? ` — ${body.error}` : ""}`
    );
  }
  return (await res.json()) as EnrollmentCreateResult;
}

/**
 * GET /api/lang/enrollments/me — current user's enrollments.
 * Returns `[]` when the feature flag is off (404 → empty list).
 */
export async function fetchMyEnrollments(signal?: AbortSignal): Promise<EnrollmentRow[]> {
  const data = await jsonFetch<{ enrollments: EnrollmentRow[] }>("/api/lang/enrollments/me", {
    method: "GET",
    signal
  });
  return data ? data.enrollments : [];
}

/**
 * GET /api/lang/courses/:courseId — the course home payload.
 * Returns `null` when the feature flag is off or the course id is
 * unknown.
 */
export async function fetchCourseHome(
  courseId: string,
  signal?: AbortSignal
): Promise<CourseHomePayload | null> {
  return jsonFetch<CourseHomePayload>(
    `/api/lang/courses/${encodeURIComponent(courseId)}`,
    { method: "GET", signal }
  );
}

/**
 * POST /api/lang/stories/:storyId/progress — record scene progress.
 * Spec § 11 — the player fires this on every scene advance (the
 * StoryPlayer wrapper throttles to once per scene).
 */
export async function saveStoryProgress(input: {
  storyId: string;
  lastSceneOrder: number;
  scorePct?: number;
  completed?: boolean;
}): Promise<StoryProgressWriteResult> {
  const res = await fetch(
    `/api/lang/stories/${encodeURIComponent(input.storyId)}/progress`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        last_scene_order: input.lastSceneOrder,
        score_pct: input.scorePct ?? 0,
        completed: input.completed ?? false
      })
    }
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      `POST /api/lang/stories/.../progress: ${res.status} ${res.statusText}${body?.error ? ` — ${body.error}` : ""}`
    );
  }
  return (await res.json()) as StoryProgressWriteResult;
}

/* --------------------------------------------------------------------- *
 * Patch 06 — word popup + vocabulary deck
 * --------------------------------------------------------------------- *
 * Spec § 7.5 + § 7.9 + § 11.
 *
 * The popup opens when the StoryPlayer dispatches an `onTokenTap`
 * event for a non-punctuation token. We fetch the lexeme by its DB
 * cuid (the player emits this directly via PlayerToken.lexemeId,
 * patched in Patch 06 — Patch 04's `lex:<slug>:<lemma>` synthetic
 * id collided for homonyms and is gone). The popup is responsible
 * for the "Save to my words" button, which calls `saveVocab`.
 *
 * `fetchMyWords` powers the "My words" page. We hydrate source-line
 * context on the server (one extra query) so the page renders
 * without an N+1 round-trip per card.
 * */

/** Per-source-line context attached to a vocab row. */
export interface VocabSourceLine {
  lineId: string;
  text: string;
  textReading: string | null;
  translation: string;
}

/** One row in the learner's deck. */
export interface VocabRow {
  userVocabId: string;
  lexemeId: string;
  lemma: string;
  reading: string | null;
  partOfSpeech: string;
  /** "m" | "f" | "n" | null — null for languages without grammatical gender. */
  gender: string | null;
  glosses: string[];
  audioUrl: string | null;
  targetLang: string;
  due: string;
  savedAt: string;
  reps: number;
  lapses: number;
  sourceLine: VocabSourceLine | null;
}

/** Word-popup payload. */
export interface LexemePopup {
  lexemeId: string;
  targetLang: string;
  /** The lexeme's dictionary form (also used as the surface when the
   *  token's surface was a conjugated/inflected variant — Patch 06
   *  always surfaces the lemma in the popup). */
  surface: string;
  lemma: string;
  reading: string | null;
  partOfSpeech: string;
  gender: string | null;
  glosses: string[];
  audioUrl: string | null;
  frequencyRank: number | null;
  sourceLine: VocabSourceLine | null;
}

/**
 * GET /api/lang/lexemes/:lexemeId — word popup data.
 * `base` selects the gloss language (defaults to "en"). `lineId`
 * optionally attaches the source line as the example sentence.
 */
export async function fetchLexeme(input: {
  lexemeId: string;
  base?: BaseLang;
  lineId?: string | null;
  signal?: AbortSignal;
}): Promise<LexemePopup | null> {
  const params = new URLSearchParams();
  params.set("base", input.base ?? "en");
  if (input.lineId) params.set("line_id", input.lineId);
  return jsonFetch<LexemePopup>(
    `/api/lang/lexemes/${encodeURIComponent(input.lexemeId)}?${params.toString()}`,
    { method: "GET", signal: input.signal }
  );
}

/** Result of POST /api/lang/vocab. */
export interface SaveVocabResult {
  userVocabId: string;
  lexemeId: string;
  due: string;
  /** True when the row already existed (idempotent re-save). */
  alreadySaved: boolean;
}

/**
 * POST /api/lang/vocab — save a word to the learner's deck.
 * Idempotent — a duplicate (user, lexeme) returns the existing card.
 */
export async function saveVocab(input: {
  lexemeId: string;
  sourceLineId?: string | null;
}): Promise<SaveVocabResult> {
  const res = await fetch("/api/lang/vocab", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      lexeme_id: input.lexemeId,
      source_line_id: input.sourceLineId ?? null
    })
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      `POST /api/lang/vocab: ${res.status} ${res.statusText}${body?.error ? ` — ${body.error}` : ""}`
    );
  }
  return (await res.json()) as SaveVocabResult;
}

/** DELETE /api/lang/vocab/:userVocabId — remove a word from the deck. */
export async function unsaveVocab(userVocabId: string): Promise<{ removed: boolean }> {
  const res = await fetch(`/api/lang/vocab/${encodeURIComponent(userVocabId)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { Accept: "application/json" }
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      `DELETE /api/lang/vocab/${userVocabId}: ${res.status} ${res.statusText}${body?.error ? ` — ${body.error}` : ""}`
    );
  }
  return (await res.json()) as { removed: boolean };
}

/** GET /api/lang/vocab — list the learner's saved words (optionally scoped to a course). */
export async function fetchMyWords(input: {
  courseId?: string | null;
  query?: string | null;
  base?: BaseLang;
  signal?: AbortSignal;
}): Promise<VocabRow[]> {
  const params = new URLSearchParams();
  if (input.courseId) params.set("course", input.courseId);
  if (input.query && input.query.trim().length > 0) params.set("q", input.query.trim());
  if (input.base) params.set("base", input.base);
  const qs = params.toString();
  const data = await jsonFetch<{ cards: VocabRow[] }>(
    `/api/lang/vocab${qs ? `?${qs}` : ""}`,
    { method: "GET", signal: input.signal }
  );
  return data ? data.cards : [];
}

/* --------------------------------------------------------------------- *
 * Patch 07 — exercise attempts
 * --------------------------------------------------------------------- *
 * Spec § 8 + § 11. The five exercise types share the same endpoint;
 * the body shape varies. The wrapper accepts a discriminated union so
 * the UI passes exactly the right body per type.
 * */

export type ExerciseAttemptBody =
  /** comprehension_mc / word_meaning_mc / listen_select */
  | { type: "comprehension_mc" | "word_meaning_mc" | "listen_select"; index: number }
  /** sentence_builder — taps shuffled tokens into the correct order */
  | { type: "sentence_builder"; order: number[] }
  /** speak_line — recording score (Patch 08 owns Whisper; Patch 07
   *  treats the score as already-known so the player UI can drive
   *  the flow without a real STT backend yet). */
  | { type: "speak_line"; score: number; transcript?: string };

/** Result of POST /api/lang/exercises/:id/attempts. */
export interface ExerciseAttemptResult {
  attemptId: string;
  exerciseId: string;
  isCorrect: boolean;
  /** 0-100 for speak_line, null otherwise. */
  score: number | null;
  /** XP delta for this attempt. */
  xpAwarded: number;
  /** The correct answer index for MC-style exercises — surfaced so
   *  the UI can highlight the right option on a wrong answer. Null
   *  for the other exercise types. */
  correctIndex: number | null;
}

/**
 * POST /api/lang/exercises/:exerciseId/attempts — record an attempt
 * + award XP. The body's `type` field carries the exercise type so
 * the API can shape the response (XP, score) without a separate GET
 * on the exercise row.
 */
export async function submitExerciseAttempt(input: {
  exerciseId: string;
  body: ExerciseAttemptBody;
}): Promise<ExerciseAttemptResult> {
  // Strip the `type` field before sending — the server reads it
  // from the Exercise row, not from the body.
  const { type, ...rest } = input.body;
  void type;
  const res = await fetch(
    `/api/lang/exercises/${encodeURIComponent(input.exerciseId)}/attempts`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(rest)
    }
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      `POST /api/lang/exercises/.../attempts: ${res.status} ${res.statusText}${body?.error ? ` — ${body.error}` : ""}`
    );
  }
  return (await res.json()) as ExerciseAttemptResult;
}