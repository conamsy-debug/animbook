/**
 * AnimBook Languages (Phase 1) — HTTP routes.
 *
 * Mounted at `/api/lang` in src/index.ts when isFeatureEnabled("LANGUAGES")
 * is true. Patches 04 + 05 add the real endpoints:
 *   - GET /health                        (Patch 01 placeholder)
 *   - GET /stories/:storyId              (Patch 04 — player payload)
 *   - GET /languages                     (Patch 05 — active catalog)
 *   - GET /courses?base=fr               (Patch 05 — courses for a base lang)
 *   - POST /enrollments                  (Patch 05 — create enrollment)
 *   - GET /enrollments/me                (Patch 05 — current user's enrollments)
 *   - GET /courses/:courseId             (Patch 05 — course home data)
 *   - POST /stories/:storyId/progress    (Patch 05 — record scene progress)
 *
 * Patches 06–12 add the rest per docs/languages-phase1.md § 11.
 * Every learner-facing route uses authMiddleware so unauthenticated
 * requests 401.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware, requireUserId } from "../../auth/middleware.js";
import { exportStory } from "../../services/languages/index.js";

const prisma = new PrismaClient();

const router = Router();

/* --------------------------------------------------------------------- *
 * GET /health
 * Patch 01 placeholder. The integration test
 * (apps/api/tests/languagesModule.test.mjs) pins this is the only
 * route before Patch 04.
 * --------------------------------------------------------------------- */

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    feature: "languages",
    patch: 1,
    status: "placeholder"
  });
});

/* --------------------------------------------------------------------- *
 * GET /stories/:storyId?base=fr
 * Patch 04 — Story player payload.
 *
 * Returns the full story subtree: scenes, lines, tokens (with lexeme
 * joins), and exercises, scoped to the requested base language for
 * translations + glosses. The web StoryPlayer consumes this and
 * drives the playback state machine.
 *
 * Auth: any signed-in user can fetch any published story (Phase 1
 * doesn't have paywalls or course gates — Patch 05 adds the
 * enrollment check). For now we just require auth so the route
 * shape is locked in.
 *
 * The query string accepts `base` ("en" | "fr") — it tells the
 * exporter which base language to surface. Defaults to "en".
 *
 * Per spec § 7: translations + glosses are filtered to the base
 * language on this read. Master lines stay so admin / debug tools
 * can pull both.
 *
 * Returns 404 if the story doesn't exist, 400 if `base` is invalid.
 * --------------------------------------------------------------------- */

const ALLOWED_BASES = new Set(["en", "fr"] as const);

router.get("/stories/:storyId", authMiddleware, async (req: Request, res: Response) => {
  // Express types `req.params[...]` as `string | string[] | undefined`.
  // We only declared one path param so a non-array is the only legal
  // shape; we normalize + validate below.
  const rawId = req.params["storyId"];
  const storyId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!storyId) {
    res.status(400).json({ error: "storyId is required" });
    return;
  }

  // Touch requireUserId so the user is identified even if we don't
  // gate content on enrollment yet (Patch 05). This also surfaces a
  // 401 via authMiddleware if Clerk is on and the token is missing.
  requireUserId(req as Parameters<typeof requireUserId>[0]);

  // Validate + coerce `base`. Express may give us a string or string[]
  // depending on whether `?base=fr` or `?base=fr&base=en` was sent.
  const rawBaseRaw = req.query["base"];
  const rawBase = Array.isArray(rawBaseRaw) ? rawBaseRaw[0] : rawBaseRaw;
  const baseStr = typeof rawBase === "string" ? rawBase : "en";
  const base = ALLOWED_BASES.has(baseStr as "en" | "fr") ? (baseStr as "en" | "fr") : null;
  if (!base) {
    res.status(400).json({ error: "base must be 'en' or 'fr'", received: baseStr });
    return;
  }

  // Read the story's existence + the master_story slug up front so
  // we can return a clean 404 without a full subtree query.
  const storyMeta = await prisma.story.findUnique({
    where: { id: storyId },
    select: {
      id: true,
      targetLang: true,
      masterStory: { select: { slug: true } }
    }
  });
  if (!storyMeta) {
    res.status(404).json({ error: "story not found", storyId });
    return;
  }

  // Reuse the exporter; it already produces the lesson JSON shape
  // and respects the base-language filter for translations + glosses.
  // We then trim the payload down to what the player actually needs.
  const lesson = await exportStory(prisma, storyId, { baseLang: base });
  const player = toPlayerPayload(lesson, storyMeta.targetLang, base);
  res.json(player);
});

/* --------------------------------------------------------------------- *
 * Player payload shape
 * --------------------------------------------------------------------- *
 * The full Lesson JSON includes fields the player doesn't need
 * (synopsis, target_vocab_concepts, scene-master orders, etc.).
 * We shape the wire response here so the web StoryPlayer can rely
 * on a stable contract. If the exporter shape grows, only this
 * function changes.
 *
 * Why not let the frontend read raw Lesson JSON? Two reasons:
 *   1) The wire format is part of the API contract — adding fields
 *      to Lesson shouldn't auto-leak to the player.
 *   2) Player-specific metadata (e.g. `lang` and `dir` attributes
 *      per spec § 7) belongs in the API response, not in the JSON
 *      content file.
 * */

interface StoryMeta {
  id: string;
  targetLang: string;
  masterStory: { slug: string };
}

interface PlayerPayload {
  storyId: string;
  masterSlug: string;
  targetLang: string;
  baseLang: "en" | "fr";
  /** BCP-47 language code — matches `<html lang>` and the Language.code column. */
  lang: string;
  /** "ltr" | "rtl" — matches the `dir` attribute on the root + on every target-language element. */
  direction: "ltr" | "rtl";
  /** Web font family for the target language's native text (spec § 7). */
  fontFamily: string | null;
  /** "pinyin" | "niqqud" | null — drives the ruby / swap toggle. */
  readingAid: "pinyin" | "niqqud" | null;
  title: string;
  titleTranslations: { en: string; fr: string };
  scenes: PlayerScene[];
  /** Best-effort count of unique new lexemes in this story — shown in the vocab-deck shortcut (Patch 06). */
  newLexemeCount: number;
}

interface PlayerScene {
  sceneId: string;
  order: number;
  /** Placeholder clip URL. Patch 11's pipeline fills this from R2. */
  clipUrl: string | null;
  lines: PlayerLine[];
  exercises: Array<{
    exerciseId: string;
    order: number;
    type: string;
    /** Per-base-language payload + answer from the Exercise row. */
    payload: Record<string, unknown>;
    answer: Record<string, unknown> | null;
  }>;
}

interface PlayerLine {
  lineId: string;
  order: number;
  speaker: string;
  /** Target-language text as displayed to the learner. */
  text: string;
  /** Pointed (he) / pinyin (zh) form. null when the language has no reading aid. */
  textReading: string | null;
  /** Translation in the requested base language. */
  translation: string;
  /** Tappable tokens. Each carries the surface, reading aid, lexeme lookup, and new-word flag. */
  tokens: PlayerToken[];
}

interface PlayerToken {
  order: number;
  surface: string;
  /** Per-token reading aid (pinyin for zh, pointed form for he). null otherwise. */
  reading: string | null;
  /** Lexeme id (null for punctuation). The word popup (Patch 06) reads from this. */
  lexemeId: string | null;
  /** Whether this token introduces a new word in the story. Drives the underline. */
  isNewInStory: boolean;
  /** True for tokens with no lexeme lookup (whitespace, punctuation). */
  isPunctuation: boolean;
  startChar: number;
  endChar: number;
}

function toPlayerPayload(
  lesson: Awaited<ReturnType<typeof exportStory>>,
  targetLang: string,
  base: "en" | "fr"
): PlayerPayload {
  // Spec § 3 field mirrors for the player. We hard-code the
  // font family + reading aid here rather than re-querying the
  // languages table to keep the player hot path fast. If a
  // future language ships, this is one place to add it.
  const langMeta = LANGUAGE_META[targetLang] ?? { lang: targetLang, direction: "ltr", fontFamily: null, readingAid: null };

  let newLexemeCount = 0;
  const seen = new Set<string>();

  const scenes: PlayerScene[] = lesson.scenes.map((scene) => ({
    sceneId: `scene:${lesson.master_story_slug}:${scene.master_scene_order}`,
    order: scene.master_scene_order,
    clipUrl: null, // Patch 11 fills this from R2 once a clip is ready.
    lines: scene.lines.map((line) => ({
      lineId: `line:${lesson.master_story_slug}:${scene.master_scene_order}:${scene.lines.indexOf(line) + 1}`,
      order: scene.lines.indexOf(line) + 1,
      speaker: line.speaker,
      text: line.text,
      textReading: line.text_reading ?? null,
      translation: line.translations[base] ?? line.text,
      tokens: line.tokens.map((tok, idx) => {
        const isPunct = tok.lemma === null;
        // Track unique new lexemes (dedupe across the whole story).
        if (tok.is_new && tok.lemma && !seen.has(tok.lemma)) {
          seen.add(tok.lemma);
          newLexemeCount += 1;
        }
        return {
          order: idx + 1,
          surface: tok.surface,
          reading: tok.reading ?? null,
          lexemeId: tok.lemma ? `lex:${lesson.master_story_slug}:${tok.lemma}` : null,
          isNewInStory: Boolean(tok.is_new),
          isPunctuation: isPunct,
          startChar: 0, // Patch 11 fills via real TTS alignment
          endChar: tok.surface.length
        };
      })
    })),
    exercises: scene.exercises.map((ex) => ({
      exerciseId: `ex:${lesson.master_story_slug}:${scene.master_scene_order}:${scene.exercises.indexOf(ex) + 1}`,
      order: scene.exercises.indexOf(ex) + 1,
      type: ex.type,
      payload: ex.payload as Record<string, unknown>,
      answer: (ex.answer ?? null) as Record<string, unknown> | null
    }))
  }));

  return {
    storyId: `story:${lesson.master_story_slug}:${targetLang}`,
    masterSlug: lesson.master_story_slug,
    targetLang,
    baseLang: base,
    lang: langMeta.lang,
    direction: langMeta.direction,
    fontFamily: langMeta.fontFamily,
    readingAid: langMeta.readingAid,
    title: lesson.title,
    titleTranslations: lesson.title_translations,
    scenes,
    newLexemeCount
  };
}

/**
 * Spec § 3 → player mapping. Mirrors the seed in
 * apps/api/prisma/languages-seed-data.ts and the front-end config
 * in apps/web/src/features/languages/config.ts — all three must
 * agree or the player will disagree with the picker.
 */
const LANGUAGE_META: Record<
  string,
  { lang: string; direction: "ltr" | "rtl"; fontFamily: string | null; readingAid: "pinyin" | "niqqud" | null }
> = {
  en: { lang: "en", direction: "ltr", fontFamily: null, readingAid: null },
  fr: { lang: "fr", direction: "ltr", fontFamily: null, readingAid: null },
  es: { lang: "es", direction: "ltr", fontFamily: null, readingAid: null },
  "zh-Hans": { lang: "zh-Hans", direction: "ltr", fontFamily: "Noto Sans SC, system-ui, sans-serif", readingAid: "pinyin" },
  de: { lang: "de", direction: "ltr", fontFamily: null, readingAid: null },
  it: { lang: "it", direction: "ltr", fontFamily: null, readingAid: null },
  he: { lang: "he", direction: "rtl", fontFamily: "Noto Sans Hebrew, system-ui, sans-serif", readingAid: "niqqud" }
};

/* --------------------------------------------------------------------- *
 * GET /languages — active languages catalog (Patch 05)
 * Spec § 11. Mirrors apps/web/src/features/languages/config.ts; both
 * stay in sync via the `languages` table seeded in Patch 02. Returns
 * only `is_active=true` rows so an operator can retire a language
 * without losing its data.
 * --------------------------------------------------------------------- */

router.get("/languages", authMiddleware, async (_req: Request, res: Response) => {
  const rows = await prisma.language.findMany({
    where: { isActive: true },
    orderBy: [{ isBase: "desc" }, { code: "asc" }]
  });
  // Map DB rows to the wire shape. Reuse the LANGUAGE_META above for
  // fontFamily + readingAid so we don't double-maintain the
  // font stack.
  const payload = rows.map((row) => ({
    code: row.code,
    nameEn: row.nameEn,
    nameFr: row.nameFr,
    nameNative: row.nameNative,
    direction: row.direction,
    script: row.script,
    readingAid: row.readingAid,
    sttCode: row.sttCode,
    fontFamily: LANGUAGE_META[row.code]?.fontFamily ?? row.fontFamily,
    isTarget: row.isTarget,
    isBase: row.isBase,
    isActive: row.isActive
  }));
  res.json({ languages: payload });
});

/* --------------------------------------------------------------------- *
 * GET /courses?base=fr — courses for a base language (Patch 05)
 * Spec § 11. Returns the 5 courses for the requested base (out of
 * the 12 total — base=en has the 6 non-en/non-fr targets, base=fr has
 * the 6 non-en/non-fr targets too plus en-as-target and fr-as-target).
 * Filtered by `is_published` so admin drafts don't leak.
 * --------------------------------------------------------------------- */

router.get("/courses", authMiddleware, async (req: Request, res: Response) => {
  const baseRaw = req.query["base"];
  const baseStr = Array.isArray(baseRaw) ? baseRaw[0] : baseRaw;
  const base = typeof baseStr === "string" && ALLOWED_BASES.has(baseStr as "en" | "fr") ? (baseStr as "en" | "fr") : null;
  if (!base) {
    res.status(400).json({ error: "base must be 'en' or 'fr'", received: baseStr ?? null });
    return;
  }

  const rows = await prisma.course.findMany({
    where: { baseLang: base, isPublished: true },
    orderBy: { targetLang: "asc" }
  });
  res.json({
    base,
    courses: rows.map((row) => ({
      courseId: row.id,
      targetLang: row.targetLang,
      baseLang: row.baseLang,
      title: row.title,
      description: row.description
    }))
  });
});

/* --------------------------------------------------------------------- *
 * POST /enrollments — create an enrollment (Patch 05)
 * Spec § 11 + § 7.2. Body: { target_lang, base_lang }.
 * Idempotent: a duplicate (user, course) returns the existing row.
 * Spec explicitly forbids enrolling a learner into a course where
 * target_lang === base_lang.
 *
 * Spec § 7.2 also lists an optional `daily_goal` field (5/10/20
 * minutes). The current Enrollment schema doesn't carry that
 * column — we'll add it via a future migration once the streak /
 * goal flow lands (Patch 10). For now we accept and ignore the
 * field so the wire shape is forward-compatible.
 * --------------------------------------------------------------------- */

interface CreateEnrollmentBody {
  target_lang?: string;
  base_lang?: string;
  daily_goal?: number;
}

router.post("/enrollments", authMiddleware, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as CreateEnrollmentBody;
  const target = typeof body.target_lang === "string" ? body.target_lang : null;
  const base = typeof body.base_lang === "string" ? body.base_lang : null;
  // daily_goal is accepted but ignored for now (see comment above).

  if (!target || !ALLOWED_BASES.has(base as "en" | "fr")) {
    res.status(400).json({ error: "target_lang and base_lang are required; base_lang must be 'en' or 'fr'" });
    return;
  }
  if (target === base) {
    res.status(400).json({ error: "target_lang cannot equal base_lang" });
    return;
  }

  const userId = requireUserId(req as Parameters<typeof requireUserId>[0]);

  // Verify the course exists. We don't auto-create courses — the
  // seed owns that — but we DO want a clean 404 if a caller asks
  // for a course that hasn't shipped yet.
  const course = await prisma.course.findUnique({
    where: { targetLang_baseLang: { targetLang: target, baseLang: base as "en" | "fr" } }
  });
  if (!course) {
    res.status(404).json({ error: "course not found", target_lang: target, base_lang: base });
    return;
  }

  // Idempotent upsert keyed on (user, course). The schema's
  // @@unique([userId, courseId]) makes this safe.
  const enrollment = await prisma.enrollment.upsert({
    where: { userId_courseId: { userId, courseId: course.id } },
    update: { lastActiveAt: new Date() },
    create: {
      userId,
      courseId: course.id,
      startedAt: new Date(),
      lastActiveAt: new Date(),
      currentStoryId: null
    }
  });

  // Touch the learner's stats row so the course home streak
  // counter has something to read on first visit.
  await prisma.learnerStats.upsert({
    where: { userId },
    update: {},
    create: { userId }
  });

  res.status(201).json({
    enrollmentId: enrollment.id,
    courseId: enrollment.courseId,
    targetLang: course.targetLang,
    baseLang: course.baseLang,
    startedAt: enrollment.startedAt.toISOString(),
    lastActiveAt: enrollment.lastActiveAt.toISOString(),
    currentStoryId: enrollment.currentStoryId
  });
});

/* --------------------------------------------------------------------- *
 * GET /enrollments/me — current user's enrollments (Patch 05)
 * Spec § 7 onboarding-followup. Lists the courses the learner is
 * currently studying, sorted by most-recent activity. Each row
 * includes the course metadata so the course picker can render
 * without a second round-trip.
 * --------------------------------------------------------------------- */

router.get("/enrollments/me", authMiddleware, async (req: Request, res: Response) => {
  const userId = requireUserId(req as Parameters<typeof requireUserId>[0]);

  const rows = await prisma.enrollment.findMany({
    where: { userId },
    orderBy: { lastActiveAt: "desc" },
    include: { course: true }
  });

  res.json({
    enrollments: rows.map((row) => ({
      enrollmentId: row.id,
      courseId: row.courseId,
      targetLang: row.course.targetLang,
      baseLang: row.course.baseLang,
      title: row.course.title,
      description: row.course.description,
      startedAt: row.startedAt.toISOString(),
      lastActiveAt: row.lastActiveAt.toISOString(),
      currentStoryId: row.currentStoryId
    }))
  });
});

/* --------------------------------------------------------------------- *
 * GET /courses/:courseId — course home (Patch 05)
 * Spec § 7.3 + § 11. Returns the list of stories in the course
 * (ordered by master_scene_order of the first scene), the learner's
 * per-story progress, and a coarse "stats" rollup (streak + XP
 * placeholders until Patch 10). Phase 1 course home is read-only
 * over stories; Patch 12's admin screen writes here.
 * --------------------------------------------------------------------- */

router.get("/courses/:courseId", authMiddleware, async (req: Request, res: Response) => {
  const rawId = req.params["courseId"];
  const courseId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!courseId) {
    res.status(400).json({ error: "courseId is required" });
    return;
  }

  const userId = requireUserId(req as Parameters<typeof requireUserId>[0]);

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    res.status(404).json({ error: "course not found", courseId });
    return;
  }

  // Find every Story in this course. We join by target_lang because
  // Story has no direct courseId column (the API design from Patch 02).
  const stories = await prisma.story.findMany({
    where: { targetLang: course.targetLang, isPublished: true },
    include: {
      masterStory: { select: { slug: true, titleEn: true } },
      progressRows: { where: { userId } }
    },
    orderBy: { id: "asc" }
  });

  // Enrollment + stats for the learner (may not exist yet — a course
  // home preview is allowed without an enrollment).
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } }
  });
  const stats = await prisma.learnerStats.findUnique({ where: { userId } });

  // Map StoryProgress rows by storyId for O(1) lookup.
  const progressByStory = new Map<string, { status: string; lastSceneOrder: number; scorePct: number; completedAt: string | null }>();
  for (const p of enrollment ? stories.flatMap((s) => s.progressRows) : []) {
    progressByStory.set(p.storyId, {
      status: p.status,
      lastSceneOrder: p.lastSceneOrder,
      scorePct: p.scorePct,
      completedAt: p.completedAt ? p.completedAt.toISOString() : null
    });
  }

  res.json({
    course: {
      courseId: course.id,
      targetLang: course.targetLang,
      baseLang: course.baseLang,
      title: course.title,
      description: course.description
    },
    enrollment: enrollment
      ? {
          enrollmentId: enrollment.id,
          startedAt: enrollment.startedAt.toISOString(),
          lastActiveAt: enrollment.lastActiveAt.toISOString(),
          currentStoryId: enrollment.currentStoryId
        }
      : null,
    stats: stats
      ? {
          xpTotal: stats.xpTotal,
          currentStreakDays: stats.currentStreakDays,
          longestStreakDays: stats.longestStreakDays,
          lastActivityDate: stats.lastActivityDate ? stats.lastActivityDate.toISOString().slice(0, 10) : null
        }
      : null,
    stories: stories.map((s) => {
      const progress = progressByStory.get(s.id) ?? null;
      return {
        storyId: `story:${s.masterStory.slug}:${s.targetLang}`,
        masterSlug: s.masterStory.slug,
        title: s.title,
        cefrLevel: s.cefrLevel,
        progress
      };
    })
  });
});

/* --------------------------------------------------------------------- *
 * POST /stories/:storyId/progress — record scene progress (Patch 05)
 * Spec § 11. Body: { last_scene_order, score_pct?, completed? }.
 * Idempotent: upserts a StoryProgress row keyed on (user, story).
 * Sets `completed_at` when the caller marks the story complete.
 * Spec § 7 — "progress saves per scene" so the player can resume
 * from the last scene they watched.
 * --------------------------------------------------------------------- */

interface ProgressBody {
  last_scene_order?: number;
  score_pct?: number;
  completed?: boolean;
  status?: string;
}

router.post("/stories/:storyId/progress", authMiddleware, async (req: Request, res: Response) => {
  const rawId = req.params["storyId"];
  const storyId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!storyId) {
    res.status(400).json({ error: "storyId is required" });
    return;
  }

  // storyId wire format is `story:<masterSlug>:<targetLang>` — we
  // resolve to the cuid via the slug + lang pair.
  const story = await resolveStoryId(storyId);
  if (!story) {
    res.status(404).json({ error: "story not found", storyId });
    return;
  }

  const userId = requireUserId(req as Parameters<typeof requireUserId>[0]);
  const body = (req.body ?? {}) as ProgressBody;
  const lastSceneOrder = Number.isFinite(body.last_scene_order) ? Number(body.last_scene_order) : 1;
  const scorePct = Number.isFinite(body.score_pct) ? Math.max(0, Math.min(100, Number(body.score_pct))) : 0;
  const status =
    body.completed === true ? "completed" : body.status === "completed" ? "completed" : body.status === "in_progress" ? "in_progress" : "in_progress";

  const completedAt = status === "completed" ? new Date() : null;

  const progress = await prisma.storyProgress.upsert({
    where: { userId_storyId: { userId, storyId: story.id } },
    update: {
      status,
      lastSceneOrder,
      scorePct,
      completedAt
    },
    create: {
      userId,
      storyId: story.id,
      status,
      lastSceneOrder,
      scorePct,
      completedAt
    }
  });

  // Touch the enrollment's last_active_at so the course home
  // surfaces this user as "recently active".
  const enrollment = await prisma.enrollment.findFirst({
    where: { userId, course: { targetLang: story.targetLang } }
  });
  if (enrollment) {
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        lastActiveAt: new Date(),
        currentStoryId: story.id
      }
    });
  }

  // Touch the learner stats too so streak math (Patch 10) has an
  // anchor to work with.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  await prisma.learnerStats.upsert({
    where: { userId },
    update: { lastActivityDate: today },
    create: { userId, lastActivityDate: today }
  });

  res.json({
    storyProgressId: progress.id,
    storyId: progress.storyId,
    status: progress.status,
    lastSceneOrder: progress.lastSceneOrder,
    scorePct: progress.scorePct,
    completedAt: progress.completedAt ? progress.completedAt.toISOString() : null
  });
});

/**
 * Resolve the synthetic storyId wire format
 * (`story:<masterSlug>:<targetLang>`) to the DB cuid. Returns null
 * if no matching Story row exists.
 */
async function resolveStoryId(syntheticId: string): Promise<{ id: string; targetLang: string } | null> {
  if (!syntheticId.startsWith("story:")) return null;
  const rest = syntheticId.slice("story:".length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon < 0) return null;
  const slug = rest.slice(0, lastColon);
  const targetLang = rest.slice(lastColon + 1);
  if (!slug || !targetLang) return null;
  const story = await prisma.story.findFirst({
    where: { targetLang, masterStory: { slug } },
    select: { id: true, targetLang: true }
  });
  return story;
}

export default router;
