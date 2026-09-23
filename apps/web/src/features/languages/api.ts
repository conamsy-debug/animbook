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