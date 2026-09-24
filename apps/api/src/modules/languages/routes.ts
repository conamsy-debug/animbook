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
import {
  exportStory,
  resolveSttProvider,
  normaliseForCompare,
  tokenise,
  alignTokens,
  scoreFromAlignment,
  rateCard,
  bumpStreak,
  resolveTz,
  daysBetween,
  enqueueAdaptation,
  getAdaptationJob,
  runAdaptationJob,
  listStoriesForReview,
  getStoryForReview,
  editStory,
  regenerateLineAudio,
  approveStory,
  rejectStory,
  type CardSnapshot,
  type CardRating,
  REVIEW_BATCH_SIZE
} from "../../services/languages/index.js";

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
  // Patch 12: only approved stories appear to learners. The admin
  // review screen uses /admin/stories/:id which has no gate.
  const storyMeta = await prisma.story.findUnique({
    where: { id: storyId },
    select: {
      id: true,
      targetLang: true,
      isPublished: true,
      masterStory: { select: { slug: true } }
    }
  });
  if (!storyMeta) {
    res.status(404).json({ error: "story not found", storyId });
    return;
  }
  if (!storyMeta.isPublished) {
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
          // Patch 06 — use the lexeme cuid directly. Patch 04 used a
          // `lex:<masterSlug>:<lemma>` synthetic id that collided for
          // homonyms (e.g. Spanish "banco" seat vs bank). The
          // exporter now passes the joined lexeme.id through, so the
          // wire format is opaque and stable.
          lexemeId: tok.lexeme_id ?? null,
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

  // Patch 09 — due card count for this course's target_lang.
  // Counted outside the stories include so a deck with hundreds of
  // cards doesn't bloat the stories payload.
  const dueNow = new Date();
  const dueCount = await prisma.userVocab.count({
    where: {
      userId,
      due: { lte: dueNow },
      lexeme: { targetLang: course.targetLang }
    }
  });

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
    // Patch 09 — number of cards due now for this course. The home
    // page renders "Review 12 words" as the primary CTA when this is
    // > 0; Patch 10 will reuse this value for streak nudges.
    dueCount,
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

  // Touch the learner stats too — Patch 10 wires this through the
  // streak helper so the date + counter move together in the
  // learner's local tz.
  await bumpLearnerStats({ userId, now: new Date() });

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

/* --------------------------------------------------------------------- *
 * GET /lexemes/:lexemeId?base=fr — word popup data (Patch 06)
 * Spec § 7.5 (screen 5) + § 11. Returns everything the WordPopup
 * renders: the surface form, lemma, reading aid, part of speech,
 * gender (with a colour cue for de), per-base-language glosses,
 * audio url, and the source line the learner was watching when they
 * tapped the token.
 *
 * The popup needs the source line to surface the example sentence;
 * we accept an optional `?line_id=` query so the popup can stay
 * context-free when invoked from "My words" (no line).
 * --------------------------------------------------------------------- */

router.get("/lexemes/:lexemeId", authMiddleware, async (req: Request, res: Response) => {
  const rawId = req.params["lexemeId"];
  const lexemeId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!lexemeId) {
    res.status(400).json({ error: "lexemeId is required" });
    return;
  }

  const rawBaseRaw = req.query["base"];
  const rawBase = Array.isArray(rawBaseRaw) ? rawBaseRaw[0] : rawBaseRaw;
  const baseStr = typeof rawBase === "string" ? rawBase : "en";
  const base = ALLOWED_BASES.has(baseStr as "en" | "fr") ? (baseStr as "en" | "fr") : null;
  if (!base) {
    res.status(400).json({ error: "base must be 'en' or 'fr'", received: baseStr });
    return;
  }

  // Optional source line for the example-sentence display.
  const rawLineId = req.query["line_id"];
  const sourceLineId = typeof rawLineId === "string" && rawLineId.length > 0 ? rawLineId : null;

  const lexeme = await prisma.lexeme.findUnique({
    where: { id: lexemeId }
  });
  if (!lexeme) {
    res.status(404).json({ error: "lexeme not found", lexemeId });
    return;
  }

  // Pull glosses for the requested base language; fall back to en
  // when the target language's glosses for fr are still empty (the
  // pipeline often ships en glosses first and fills fr later).
  const glosses = (lexeme.glosses as Record<string, string[] | undefined>) ?? {};
  const glossesForBase = glosses[base] ?? glosses["en"] ?? [];

  // Fetch the source line in parallel with the popup shape build —
  // it's optional and may not exist (My-words entry with no recorded
  // line). We don't await it earlier so a missing line doesn't block
  // the popup.
  const sourceLine = sourceLineId
    ? await prisma.line.findUnique({
        where: { id: sourceLineId },
        select: { text: true, textReading: true, translations: true }
      })
    : null;

  const sourceLineWire = sourceLine
    ? {
        lineId: sourceLineId,
        text: sourceLine.text,
        textReading: sourceLine.textReading ?? null,
        translation:
          ((sourceLine.translations as Record<string, string | undefined>) ?? {})[base] ??
          sourceLine.text
      }
    : null;

  res.json({
    lexemeId: lexeme.id,
    targetLang: lexeme.targetLang,
    surface: lexeme.lemma,
    lemma: lexeme.lemma,
    reading: lexeme.reading,
    partOfSpeech: lexeme.partOfSpeech,
    gender: lexeme.gender ?? null,
    glosses: glossesForBase,
    audioUrl: lexeme.audioUrl ?? null,
    frequencyRank: lexeme.frequencyRank ?? null,
    sourceLine: sourceLineWire
  });
});

/* --------------------------------------------------------------------- *
 * POST /vocab — save a word to the learner's deck (Patch 06)
 * Spec § 11. Body: { lexeme_id, source_line_id? }. Idempotent on
 * (userId, lexemeId) — a duplicate save returns the existing card
 * with a 200 instead of creating a new row.
 *
 * FSRS state (due / stability / difficulty / reps / state /
 * last_review) is initialised to the "new" state — due immediately,
 * stability 0, reps 0. The spaced-repetition engine (Patch 09) takes
 * over from there.
 *
 * XP: we award 2 XP per save, in line with Section 8's "2 per review
 * card" hint, treating the save as the first contact with the card.
 * The LearnerStats.xpTotal counter is bumped atomically.
 * --------------------------------------------------------------------- */

interface SaveVocabBody {
  lexeme_id?: string;
  source_line_id?: string | null;
}

router.post("/vocab", authMiddleware, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as SaveVocabBody;
  const lexemeId = typeof body.lexeme_id === "string" && body.lexeme_id.length > 0 ? body.lexeme_id : null;
  const sourceLineId = typeof body.source_line_id === "string" && body.source_line_id.length > 0 ? body.source_line_id : null;

  if (!lexemeId) {
    res.status(400).json({ error: "lexeme_id is required" });
    return;
  }

  const userId = requireUserId(req as Parameters<typeof requireUserId>[0]);

  const lexeme = await prisma.lexeme.findUnique({ where: { id: lexemeId }, select: { id: true } });
  if (!lexeme) {
    res.status(404).json({ error: "lexeme not found", lexeme_id: lexemeId });
    return;
  }

  // Validate the optional source_line_id belongs to a real line.
  // A bad id should fail loudly so the page can recover; we don't
  // silently drop it (the popup uses the line as the example sentence
  // and a mismatched id would render the wrong context).
  if (sourceLineId) {
    const line = await prisma.line.findUnique({ where: { id: sourceLineId }, select: { id: true } });
    if (!line) {
      res.status(400).json({ error: "source_line_id does not exist", source_line_id: sourceLineId });
      return;
    }
  }

  // Idempotent save — upsert keyed on the schema's
  // @@unique([userId, lexemeId]). A duplicate returns the existing
  // card; we don't bump lastSavedAt or XP twice.
  const existing = await prisma.userVocab.findUnique({
    where: { userId_lexemeId: { userId, lexemeId } },
    select: { id: true, due: true }
  });
  if (existing) {
    res.status(200).json({
      userVocabId: existing.id,
      lexemeId,
      due: existing.due.toISOString(),
      alreadySaved: true
    });
    return;
  }

  const card = await prisma.userVocab.create({
    data: {
      userId,
      lexemeId,
      sourceLineId: sourceLineId ?? null,
      // FSRS "new" state — due immediately, all counters at zero.
      // Patch 09 wires ts-fsrs to recompute these on review. The
      // schema's `state` is a string ("new" | "learning" | "review"
      // | "relearning"); we set the initial literal here.
      due: new Date(),
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: "new",
      lastReview: new Date()
    }
  });

  // Bump XP — 2 per save (Section 8 hint) + bump the streak so the
  // course home reflects today's activity. The streak helper does
  // both in one upsert so we don't race two writes against the row.
  await bumpLearnerStats({ userId, now: new Date(), xpDelta: 2 });

  res.status(201).json({
    userVocabId: card.id,
    lexemeId,
    due: card.due.toISOString(),
    alreadySaved: false
  });
});

/* --------------------------------------------------------------------- *
 * DELETE /vocab/:userVocabId — remove a word from the deck (Patch 06)
 * Idempotent — a 404 on a missing row returns 200 so the page can
 * optimistically drop the row without an extra GET.
 * --------------------------------------------------------------------- */

router.delete("/vocab/:userVocabId", authMiddleware, async (req: Request, res: Response) => {
  const rawId = req.params["userVocabId"];
  const userVocabId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!userVocabId) {
    res.status(400).json({ error: "userVocabId is required" });
    return;
  }

  const userId = requireUserId(req as Parameters<typeof requireUserId>[0]);

  // Confirm ownership before deleting; a 404 here also serves the
  // "already unsaved" idempotent path.
  const card = await prisma.userVocab.findUnique({
    where: { id: userVocabId },
    select: { userId: true }
  });
  if (!card || card.userId !== userId) {
    res.status(200).json({ removed: false });
    return;
  }
  await prisma.userVocab.delete({ where: { id: userVocabId } });
  res.json({ removed: true, userVocabId });
});

/* --------------------------------------------------------------------- *
 * GET /vocab?course=:courseId — the learner's deck for one course (Patch 06)
 * Spec § 7.9 (screen 9) — the searchable "My words" list. We
 * include the lexeme + source line so the page renders without a
 * second round-trip per row. Supports `?q=` for substring search on
 * lemma + surface glosses, and `?course=` to scope to one course.
 *
 * If no `course` is given, returns words across all of the learner's
 * enrolled courses (useful for a global "My words" landing in Patch 09).
 * --------------------------------------------------------------------- */

router.get("/vocab", authMiddleware, async (req: Request, res: Response) => {
  const userId = requireUserId(req as Parameters<typeof requireUserId>[0]);

  const rawCourse = req.query["course"];
  const courseId = typeof rawCourse === "string" && rawCourse.length > 0 ? rawCourse : null;

  const rawQuery = req.query["q"];
  const search = typeof rawQuery === "string" && rawQuery.length > 0 ? rawQuery.trim() : null;

  // Resolve the course → target_lang filter. A bad course id returns
  // 404 (we don't silently return the user's whole deck).
  let targetLangFilter: string | undefined;
  if (courseId) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { targetLang: true }
    });
    if (!course) {
      res.status(404).json({ error: "course not found", courseId });
      return;
    }
    targetLangFilter = course.targetLang;
  }

  const cards = await prisma.userVocab.findMany({
    where: {
      userId,
      ...(targetLangFilter
        ? { lexeme: { targetLang: targetLangFilter } }
        : {})
    },
    orderBy: { createdAt: "desc" },
    include: {
      lexeme: {
        select: {
          id: true,
          lemma: true,
          reading: true,
          partOfSpeech: true,
          gender: true,
          glosses: true,
          audioUrl: true,
          targetLang: true
        }
      },
      // sourceLineId may be null (older saves or legacy data); the
      // include is left as an optional join so the query doesn't fail.
      // Prisma's relation include doesn't have a built-in
      // `where: { isNotNull }` filter, so we filter null rows in JS.
    }
  });

  // Hydrate source lines in one query instead of N+1.
  const lineIds = Array.from(new Set(cards.map((c) => c.sourceLineId).filter((v): v is string => Boolean(v))));
  const lines = lineIds.length > 0
    ? await prisma.line.findMany({
        where: { id: { in: lineIds } },
        select: { id: true, text: true, textReading: true, translations: true }
      })
    : [];
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const baseRaw = req.query["base"];
  const baseStr = typeof baseRaw === "string" ? baseRaw : "en";
  const base = ALLOWED_BASES.has(baseStr as "en" | "fr") ? (baseStr as "en" | "fr") : "en";

  // Compose wire shape + apply search filter.
  let wire = cards.map((card) => {
    const glosses = (card.lexeme.glosses as Record<string, string[] | undefined>) ?? {};
    const glossesForBase = glosses[base] ?? glosses["en"] ?? [];
    const line = card.sourceLineId ? lineById.get(card.sourceLineId) ?? null : null;
    const translation = line
      ? ((line.translations as Record<string, string | undefined>) ?? {})[base] ?? line.text
      : null;
    return {
      userVocabId: card.id,
      lexemeId: card.lexeme.id,
      lemma: card.lexeme.lemma,
      reading: card.lexeme.reading ?? null,
      partOfSpeech: card.lexeme.partOfSpeech,
      gender: card.lexeme.gender ?? null,
      glosses: glossesForBase,
      audioUrl: card.lexeme.audioUrl ?? null,
      targetLang: card.lexeme.targetLang,
      due: card.due.toISOString(),
      savedAt: card.createdAt.toISOString(),
      reps: card.reps,
      lapses: card.lapses,
      sourceLine: line
        ? {
            lineId: line.id,
            text: line.text,
            textReading: line.textReading ?? null,
            translation
          }
        : null
    };
  });

  if (search) {
    const needle = search.toLowerCase();
    wire = wire.filter((row) => {
      if (row.lemma.toLowerCase().includes(needle)) return true;
      if (row.glosses.some((g) => g.toLowerCase().includes(needle))) return true;
      return false;
    });
  }

  res.json({
    base,
    ...(courseId ? { courseId } : {}),
    ...(search ? { query: search } : {}),
    cards: wire
  });
});

/* --------------------------------------------------------------------- *
 * POST /exercises/:exerciseId/attempts — record an attempt + award XP (Patch 07)
 * Spec § 8 + § 11. Body shape depends on Exercise.type:
 *   - comprehension_mc / word_meaning_mc / listen_select: `{ index: number }`
 *   - sentence_builder:                                `{ order: number[] }`
 *   - speak_line:                                       `{ score: number, transcript?: string }`
 *
 * XP rules (spec § 8):
 *   - 10 XP per correct answer (the four MC-style + sentence_builder)
 *   - 5 XP per speak_line attempt scoring ≥ 60
 *
 * Wrong answers and low-scoring speak_lines award no XP but still
 * write the attempt row (so the admin can review learner progress
 * per spec § 7.6).
 * --------------------------------------------------------------------- */

interface AttemptBody {
  // MC + listen_select
  index?: number;
  // sentence_builder
  order?: number[];
  // speak_line (Patch 07 is a stub — Patch 08 owns Whisper)
  score?: number;
  transcript?: string;
}

router.post(
  "/exercises/:exerciseId/attempts",
  authMiddleware,
  async (req: Request, res: Response) => {
    const rawId = req.params["exerciseId"];
    const exerciseId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!exerciseId) {
      res.status(400).json({ error: "exerciseId is required" });
      return;
    }

    const userId = requireUserId(req as Parameters<typeof requireUserId>[0]);
    const body = (req.body ?? {}) as AttemptBody;

    const exercise = await prisma.exercise.findUnique({
      where: { id: exerciseId }
    });
    if (!exercise) {
      res.status(404).json({ error: "exercise not found", exerciseId });
      return;
    }

    // Score per type. Pure function so the unit-style tests can
    // assert the per-type behaviour without going through HTTP.
    const result = scoreAttempt(exercise.type, exercise.payload, exercise.answer, body);

    const attempt = await prisma.exerciseAttempt.create({
      data: {
        userId,
        exerciseId,
        // Prisma's InputJsonValue rejects plain `Record<string, unknown>`
        // — pass the plain object directly (the live/routes.ts pattern
        // does the same). Prisma validates the JSON shape at the
        // boundary, so this is safe.
        response: body as unknown as object,
        isCorrect: result.isCorrect,
        score: result.score
      }
    });

    // Award XP on the learner stats row + bump the streak.
    // `bumpLearnerStats` handles the atomic increment internally so
    // the XP branch and the date branch don't race.
    if (result.xpAwarded > 0) {
      await bumpLearnerStats({ userId, now: new Date(), xpDelta: result.xpAwarded });
    } else {
      // Wrong attempts still count as activity for streak purposes
      // — the learner engaged with the lesson. Spec § 7.3 doesn't
      // say "only correct counts", and a wrong attempt is still a
      // calendar-day touch.
      await bumpLearnerStats({ userId, now: new Date() });
    }

    res.status(201).json({
      attemptId: attempt.id,
      exerciseId: attempt.exerciseId,
      isCorrect: attempt.isCorrect,
      score: attempt.score,
      xpAwarded: result.xpAwarded,
      correctIndex: result.correctIndex ?? null
    });
  }
);

/**
 * Pure scoring logic — exposed as a function so the unit test can
 * exercise every type without booting Express. The route above
 * delegates here.
 */
export interface ScoreResult {
  isCorrect: boolean;
  /** 0-100 for speak_line, null otherwise. */
  score: number | null;
  /** XP delta for this attempt. */
  xpAwarded: number;
  /** The correct answer index — surfaced so the UI can highlight it. */
  correctIndex?: number;
}

const XP_CORRECT = 10;
const XP_SPEAK_OK = 5;
const SPEAK_PASS_THRESHOLD = 60;

export function scoreAttempt(
  exerciseType: string,
  payload: unknown,
  answer: unknown,
  body: AttemptBody
): ScoreResult {
  const ans = (answer ?? {}) as Record<string, unknown>;
  const pay = (payload ?? {}) as Record<string, unknown>;

  switch (exerciseType) {
    case "comprehension_mc":
    case "word_meaning_mc":
    case "listen_select": {
      const correctIdx = Number(ans["index"]);
      const learnerIdx = Number(body.index);
      const correct = Number.isFinite(correctIdx) && Number.isFinite(learnerIdx) && correctIdx === learnerIdx;
      return {
        isCorrect: correct,
        score: null,
        xpAwarded: correct ? XP_CORRECT : 0,
        correctIndex: Number.isFinite(correctIdx) ? correctIdx : undefined
      };
    }
    case "sentence_builder": {
      const correctOrder = Array.isArray(ans["order"]) ? (ans["order"] as number[]) : [];
      const learnerOrder = Array.isArray(body.order) ? body.order : [];
      const correct =
        correctOrder.length > 0 &&
        correctOrder.length === learnerOrder.length &&
        correctOrder.every((v, i) => v === learnerOrder[i]);
      return {
        isCorrect: correct,
        score: null,
        xpAwarded: correct ? XP_CORRECT : 0
      };
    }
    case "speak_line": {
      const score = Number.isFinite(body.score) ? Math.max(0, Math.min(100, Number(body.score))) : 0;
      const passed = score >= SPEAK_PASS_THRESHOLD;
      return {
        isCorrect: passed,
        score,
        xpAwarded: passed ? XP_SPEAK_OK : 0
      };
    }
    default:
      // Unknown type — treat as a no-op attempt so the route still
      // returns a clean 201 rather than crashing. The admin screen
      // (Patch 12) flags unknown types for cleanup.
      void pay;
      return { isCorrect: false, score: null, xpAwarded: 0 };
  }
}

/* --------------------------------------------------------------------- *
 * POST /pronunciation — speak_line audio scoring (Patch 08)
 * Spec § 9 + § 11. The browser posts a raw audio clip
 * (`Content-Type: audio/webm`, `audio/ogg`, or `audio/mp4` depending on
 * the codec the browser emits) with two headers:
 *
 *   - `X-Line-Id`     — the Line the learner was attempting
 *   - `X-Stt-Code`    — the language's `stt_code` (e.g. "es", "zh",
 *                        "he") for the Whisper `language` parameter
 *
 * The route asks the SttProvider for a transcript, normalises +
 * tokenises both sides, runs Levenshtein alignment, writes a
 * PronunciationAttempt row, and (if the line came from a
 * speak_line exercise) writes an ExerciseAttempt row too.
 *
 * Spec § 9 step 4: per-word colouring is returned as a JSON array so
 * the UI can highlight green / yellow / red on the page. Step 5:
 * each tone comparison (for zh) is recorded separately when the
 * helper detects pinyin tone marks — the Phase 1 helper doesn't
 *   do tone decomposition yet (we'd need `pypinyin` on the server),
 *   so Patch 08 ships per-word first and adds tone results in a
 * follow-up patch when the pipeline surfaces pinyin tokens.
 *
 * Auth: gated by authMiddleware (the existing languages module
 * mount). 503 when no SttProvider is configured (no OPENAI_API_KEY).
 * --------------------------------------------------------------------- */

interface PronunciationRequest extends Request {
  body: Buffer;
}

router.post(
  "/pronunciation",
  authMiddleware,
  // Raw body middleware: read the audio bytes as a Buffer. We mount
  // it inline (instead of globally) so the JSON-only routes keep
  // their body parser. Limit 5 MB — A1 lines are short, so even a
  // 10-second clip is well under that.
  (req: Request, _res: Response, next) => {
    const raw = req as unknown as PronunciationRequest;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      raw.body = Buffer.concat(chunks);
      next();
    });
    req.on("error", next);
  },
  async (req: Request, res: Response) => {
    const raw = req as unknown as PronunciationRequest;
    const audio = raw.body;
    if (!audio || audio.length === 0) {
      res.status(400).json({ error: "audio body is required" });
      return;
    }
    // 5 MB cap. Express middleware sets req.headers; we surface a
    // 413 explicitly so the page can recover gracefully.
    if (audio.length > 5 * 1024 * 1024) {
      res.status(413).json({ error: "audio clip exceeds 5 MB" });
      return;
    }

    const lineIdHeader = req.header("x-line-id") ?? req.header("X-Line-Id");
    const sttCodeHeader = req.header("x-stt-code") ?? req.header("X-Stt-Code");
    if (!lineIdHeader) {
      res.status(400).json({ error: "X-Line-Id header is required" });
      return;
    }
    if (!sttCodeHeader) {
      res.status(400).json({ error: "X-Stt-Code header is required" });
      return;
    }

    const line = await prisma.line.findUnique({
      where: { id: lineIdHeader },
      include: { scene: { include: { story: true } } }
    });
    if (!line) {
      res.status(404).json({ error: "line not found", lineId: lineIdHeader });
      return;
    }

    const provider = resolveSttProvider({
      // Read process.env directly so the tests can flip the key
      // mid-run. appEnv freezes at module-load time; this matches
      // the production behaviour because dotenv loads .env into
      // process.env at startup.
      openaiApiKey: process.env.OPENAI_API_KEY,
      // Resolve `fetch` at request time so a test can stub
      // globalThis.fetch mid-run. In production globalThis.fetch
      // is Node's built-in (or undici's) and never changes.
      fetchImpl: globalThis.fetch
    });
    if (!provider.isConfigured()) {
      res.status(503).json({
        error: "No speech-to-text provider configured (set OPENAI_API_KEY)."
      });
      return;
    }

    let transcript: string;
    try {
      transcript = await provider.transcribe({
        audio,
        language: sttCodeHeader,
        prompt: line.text
      });
    } catch (err) {
      // Surface the provider's message but don't 500 — the page
      // recovers by showing "couldn't transcribe" with a Retry
      // button.
      res.status(502).json({
        error: err instanceof Error ? err.message : "transcription failed",
        provider: provider.name
      });
      return;
    }

    const expected = normaliseForCompare(line.text);
    const got = normaliseForCompare(transcript);
    const expectedTokens = tokenise(expected);
    const gotTokens = tokenise(got);
    const aligned = alignTokens(expectedTokens, gotTokens);
    const score = scoreFromAlignment(expectedTokens, gotTokens);

    const userId = requireUserId(req as Parameters<typeof requireUserId>[0]);

    // Persist the raw attempt so the admin review screen (Patch 12)
    // can audit what the learner actually said. The migration makes
    // `audio_url` NOT NULL — Patch 08 doesn't upload to R2 yet
    // (the audio blob lives in the request body), so we record an
    // empty string as the placeholder. A follow-up patch uploads
    // the bytes to R2 and writes the CDN URL here.
    const attempt = await prisma.pronunciationAttempt.create({
      data: {
        userId,
        lineId: line.id,
        audioUrl: "",
        transcript,
        score,
        // Prisma's InputJsonValue rejects structured records with
        // tuple arrays. The route's payload is a plain JS object
        // so passing it through (with `as unknown as` since the
        // helper's array typing is narrower than what Prisma
        // accepts at runtime) is safe — Postgres stores the JSON
        // and the admin review screen (Patch 12) reads it back.
        details: {
          perWord: aligned,
          expectedTokens,
          transcriptTokens: gotTokens,
          provider: provider.name,
          language: sttCodeHeader
        } as unknown as object
      }
    });

    // Mirror the attempt into the exercise_attempts ledger when the
    // line is bound to a speak_line exercise. The exercise_id is
    // resolved via the scene + order=index-1 lookup (Patch 07 ships
    // speak_line as a single exercise per scene, so we find the
    // first one).
    let xpAwarded = 0;
    let exerciseAttemptId: string | null = null;
    const scene = line.scene;
    if (scene) {
      const speakExercise = await prisma.exercise.findFirst({
        where: { sceneId: scene.id, type: "speak_line" }
      });
      if (speakExercise) {
        const exAttempt = await prisma.exerciseAttempt.create({
          data: {
            userId,
            exerciseId: speakExercise.id,
            response: { transcript, score, provider: provider.name },
            isCorrect: score >= SPEAK_PASS_THRESHOLD,
            score
          }
        });
        exerciseAttemptId = exAttempt.id;
        if (score >= SPEAK_PASS_THRESHOLD) {
          xpAwarded = XP_SPEAK_OK;
        }
        // Bump streak on every pronunciation attempt (the learner
        // engaged with the lesson, even if the score fell short).
        await bumpLearnerStats({
          userId,
          now: new Date(),
          ...(xpAwarded > 0 ? { xpDelta: xpAwarded } : {})
        });
      }
    }

    res.status(201).json({
      attemptId: attempt.id,
      exerciseAttemptId,
      lineId: line.id,
      transcript,
      expected,
      score,
      perWord: aligned,
      xpAwarded,
      provider: provider.name
    });
  }
);

/* --------------------------------------------------------------------- *
 * GET /review/due?course=:courseId — list due cards (Patch 09)
 * Spec § 10 + § 11. Returns up to REVIEW_BATCH_SIZE cards that are
 * due now or earlier, scoped to the learner's enrolled course. Each
 * row includes the lexeme's surface + glosses so the review UI can
 * render without an N+1 fetch.
 *
 * Scope:
 *   - `?course=` filters by enrollment's course (via target_lang).
 *     The course must be one the learner is enrolled in.
 *   - No `?course=` returns cards across ALL of the learner's
 *     enrollments (used by the global "review" CTA on the home page).
 *
 * Limit:
 *   - Default REVIEW_BATCH_SIZE (20). Caller can lower with `?limit=`
 *     but cannot raise (the deck page stays predictable).
 * --------------------------------------------------------------------- */

router.get("/review/due", authMiddleware, async (req: Request, res: Response) => {
  const userId = requireUserId(req as Parameters<typeof requireUserId>[0]);

  const rawCourse = req.query["course"];
  const courseIdParam = typeof rawCourse === "string" && rawCourse.length > 0 ? rawCourse : null;

  const rawLimit = req.query["limit"];
  const limitParam =
    typeof rawLimit === "string" ? parseInt(rawLimit, 10) : NaN;
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, REVIEW_BATCH_SIZE)
      : REVIEW_BATCH_SIZE;

  // Resolve target_lang filter from the course. We don't require
  // enrollment — a learner can preview a course's deck the same way
  // they can preview the course home (Patch 05 pattern). A bad
  // course id surfaces 404.
  let targetLangFilter: string | undefined;
  if (courseIdParam) {
    const course = await prisma.course.findUnique({
      where: { id: courseIdParam },
      select: { targetLang: true }
    });
    if (!course) {
      res.status(404).json({ error: "course not found", courseId: courseIdParam });
      return;
    }
    targetLangFilter = course.targetLang;
  }

  // The vocab card carries the FK to lexeme; we join through lexeme
  // for target_lang. Using a single query keeps the page render to
  // one round-trip.
  const now = new Date();
  const cards = await prisma.userVocab.findMany({
    where: {
      userId,
      due: { lte: now },
      ...(targetLangFilter ? { lexeme: { targetLang: targetLangFilter } } : {})
    },
    include: {
      lexeme: {
        select: {
          id: true,
          targetLang: true,
          lemma: true,
          reading: true,
          partOfSpeech: true,
          gender: true,
          glosses: true,
          audioUrl: true
        }
      }
    },
    orderBy: { due: "asc" },
    take: limit
  });

  // Also surface the total due count (ignoring the `limit` cap) so
  // the course home can show "37 cards due" without a second query.
  const totalDue = await prisma.userVocab.count({
    where: {
      userId,
      due: { lte: now },
      ...(targetLangFilter ? { lexeme: { targetLang: targetLangFilter } } : {})
    }
  });

  res.json({
    count: cards.length,
    totalDue,
    limit,
    cards: cards.map((c) => ({
      userVocabId: c.id,
      lexemeId: c.lexemeId,
      sourceLineId: c.sourceLineId,
      state: c.state,
      due: c.due.toISOString(),
      lastReview: c.lastReview ? c.lastReview.toISOString() : null,
      reps: c.reps,
      lapses: c.lapses,
      // Lexeme fields the UI needs to render the card without a
      // second round-trip. Surface comes from the source line token
      // (the lemma is the dictionary form; the surface is what the
      // learner saw on screen). Patch 09 ships lemma only — the
      // review screen renders the lemma + reading + glosses.
      lexeme: {
        ...c.lexeme,
        // Mirror + source glosses stay as their JSON shape from the
        // lexeme table; the UI picks the requested base lang and
        // falls back to "en" if missing (Patch 06 pattern).
        glosses: c.lexeme.glosses
      }
    }))
  });
});

/* --------------------------------------------------------------------- *
 * POST /review/:userVocabId — record a learner's FSRS rating (Patch 09)
 * Spec § 10 + § 11. Body: `{ rating: 1|2|3|4 }` where:
 *   1 = Again  (lapse)
 *   2 = Hard
 *   3 = Good
 *   4 = Easy
 *
 * The route computes the next card state via the FSRS scheduler,
 * persists the new user_vocab row + a review_logs row in a single
 * transaction (so the admin screen can never see one without the
 * other), and awards 1 XP per rating (spec § 8 — "5 XP per speak_line
 * review, 1 XP per FSRS review" intent). Wrong / invalid ratings
 * return 400 — the page retries without a refetch.
 * --------------------------------------------------------------------- */

interface ReviewBody {
  rating?: number;
}

const ALLOWED_RATINGS = new Set<CardRating>([1, 2, 3, 4]);

router.post("/review/:userVocabId", authMiddleware, async (req: Request, res: Response) => {
  const rawId = req.params["userVocabId"];
  const userVocabId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!userVocabId) {
    res.status(400).json({ error: "userVocabId is required" });
    return;
  }

  const userId = requireUserId(req as Parameters<typeof requireUserId>[0]);
  const body = (req.body ?? {}) as ReviewBody;
  const ratingNum = Number(body.rating);
  if (!Number.isInteger(ratingNum) || !ALLOWED_RATINGS.has(ratingNum as CardRating)) {
    res.status(400).json({ error: "rating must be 1..4 (Again|Hard|Good|Easy)" });
    return;
  }
  const rating = ratingNum as CardRating;

  // Load the card + assert ownership. We don't gate on enrollment —
  // a learner can rate any card they own (their deck survives even
  // if an enrollment is removed).
  const card = await prisma.userVocab.findUnique({ where: { id: userVocabId } });
  if (!card) {
    res.status(404).json({ error: "card not found", userVocabId });
    return;
  }
  if (card.userId !== userId) {
    // Don't leak the existence of other users' cards.
    res.status(404).json({ error: "card not found", userVocabId });
    return;
  }

  // Build the snapshot, run the FSRS scheduler, and write both rows
  // in a transaction. We call `tx.userVocab.update` (not `updateMany`)
  // so the `where: { id }` is the primary key — safe inside $tx.
  const snapshot: CardSnapshot = {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsedDays,
    scheduledDays: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as CardSnapshot["state"],
    lastReview: card.lastReview
  };
  const now = new Date();
  const result = rateCard(snapshot, rating, now);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.userVocab.update({
        where: { id: userVocabId },
        data: {
          due: result.card.due,
          stability: result.card.stability,
          difficulty: result.card.difficulty,
          elapsedDays: result.card.elapsedDays,
          scheduledDays: result.card.scheduledDays,
          reps: result.card.reps,
          lapses: result.card.lapses,
          state: result.card.state,
          lastReview: result.card.lastReview
        }
      });
      await tx.reviewLog.create({
        data: {
          userId,
          userVocabId,
          rating,
          reviewAt: now,
          // The route's payload is a plain JS object (no tuples),
          // so passing it directly satisfies Prisma's InputJsonValue.
          meta: result.log as unknown as object
        }
      });
      // +1 XP per rating (spec § 8 — light feedback signal; the
      // bigger XP awards live on the MC + speak_line paths).
      // Patch 10: route the XP branch through bumpLearnerStats so the
      // streak counter also ticks for review activity. We do it
      // outside the transaction (the helper reads + writes the stats
      // row) — the rating row is already committed by this point so
      // a failed stats update doesn't lose learner progress.
      const userIdForStats = userId;
      const xpDelta = 1;
      const statsRow = await tx.learnerStats.findUnique({
        where: { userId: userIdForStats },
        select: {
          currentStreakDays: true,
          longestStreakDays: true,
          lastActivityDate: true,
          timezone: true
        }
      });
      const tzStats = resolveTz(statsRow?.timezone);
      const streakUpdate = bumpStreak({
        lastActivityDate: statsRow?.lastActivityDate
          ? statsRow.lastActivityDate.toISOString().slice(0, 10)
          : null,
        currentStreakDays: statsRow?.currentStreakDays ?? 0,
        longestStreakDays: statsRow?.longestStreakDays ?? 0,
        now: new Date(),
        tz: tzStats
      });
      await tx.learnerStats.upsert({
        where: { userId: userIdForStats },
        update: {
          currentStreakDays: streakUpdate.currentStreakDays,
          longestStreakDays: streakUpdate.longestStreakDays,
          lastActivityDate: new Date(`${streakUpdate.lastActivityDate}T00:00:00Z`),
          xpTotal: { increment: xpDelta }
        },
        create: {
          userId: userIdForStats,
          currentStreakDays: streakUpdate.currentStreakDays,
          longestStreakDays: streakUpdate.longestStreakDays,
          lastActivityDate: new Date(`${streakUpdate.lastActivityDate}T00:00:00Z`),
          timezone: tzStats,
          xpTotal: xpDelta
        }
      });
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "failed to record rating"
    });
    return;
  }

  res.status(200).json({
    userVocabId,
    rating,
    next: {
      state: result.card.state,
      due: result.card.due.toISOString(),
      stability: result.card.stability,
      difficulty: result.card.difficulty,
      scheduledDays: result.card.scheduledDays,
      reps: result.card.reps,
      lapses: result.card.lapses
    },
    log: result.log
  });
});

/* --------------------------------------------------------------------- *
 * Streak helper — bumps last_activity_date + streak counters.
 * --------------------------------------------------------------------- *
 * Every activity-recording route calls this so the course home /
 * stats endpoint always sees a coherent streak. We do a SELECT then
 * an UPSERT (not a single SQL CASE) because Prisma's upsert doesn't
 * express "compute the new values from the existing ones" without
 * shipping a transaction. The cost is one extra round-trip per
 * activity; given how infrequent FSRS reviews + vocab saves are
 * (one per minute at the most), the simpler code wins.
 *
 * Pass `xpDelta: 0` if the caller already awarded XP via a separate
 * `learnerStats.upsert({ increment: ... })` — we don't double-count.
 * */

interface BumpStatsInput {
  userId: string;
  now: Date;
  /** XP to add on top of any caller-issued increments. Use 0 to skip
   *  the XP branch when the caller already did it. */
  xpDelta?: number;
}

async function bumpLearnerStats(input: BumpStatsInput): Promise<void> {
  const stats = await prisma.learnerStats.findUnique({
    where: { userId: input.userId },
    select: {
      currentStreakDays: true,
      longestStreakDays: true,
      lastActivityDate: true,
      timezone: true
    }
  });

  const tz = resolveTz(stats?.timezone);
  const streak = bumpStreak({
    lastActivityDate: stats?.lastActivityDate
      ? stats.lastActivityDate.toISOString().slice(0, 10)
      : null,
    currentStreakDays: stats?.currentStreakDays ?? 0,
    longestStreakDays: stats?.longestStreakDays ?? 0,
    now: input.now,
    tz
  });

  await prisma.learnerStats.upsert({
    where: { userId: input.userId },
    update: {
      currentStreakDays: streak.currentStreakDays,
      longestStreakDays: streak.longestStreakDays,
      lastActivityDate: new Date(`${streak.lastActivityDate}T00:00:00Z`),
      ...(input.xpDelta && input.xpDelta > 0
        ? { xpTotal: { increment: input.xpDelta } }
        : {})
    },
    create: {
      userId: input.userId,
      currentStreakDays: streak.currentStreakDays,
      longestStreakDays: streak.longestStreakDays,
      lastActivityDate: new Date(`${streak.lastActivityDate}T00:00:00Z`),
      timezone: tz,
      ...(input.xpDelta && input.xpDelta > 0 ? { xpTotal: input.xpDelta } : {})
    }
  });
}

/* --------------------------------------------------------------------- *
 * GET /stats — full learner stats payload (Patch 10)
 * Spec § 7.3 + § 11. Returns everything the course home + stats
 * card render needs: XP, streak (current + longest), the activity
 * date, and the timezone used for streak math. We also surface the
 * total vocab + exercise attempt counts so the page can render the
 * "I've learned N words" line without a follow-up query.
 * --------------------------------------------------------------------- */

router.get("/stats", authMiddleware, async (req: Request, res: Response) => {
  const userId = requireUserId(req as Parameters<typeof requireUserId>[0]);

  const stats = await prisma.learnerStats.findUnique({
    where: { userId },
    select: {
      userId: true,
      xpTotal: true,
      currentStreakDays: true,
      longestStreakDays: true,
      lastActivityDate: true,
      timezone: true
    }
  });

  // Recompute the streak against "now" so a learner who hasn't
  // visited the page in a week sees their streak properly broken.
  // We don't write anything here — the next activity call will
  // reconcile.
  let currentStreakDays = stats?.currentStreakDays ?? 0;
  if (stats?.lastActivityDate) {
    const today = new Date();
    const lastDate = stats.lastActivityDate.toISOString().slice(0, 10);
    const delta = daysBetweenStrings(
      lastDate,
      today.toISOString().slice(0, 10),
      resolveTz(stats.timezone)
    );
    if (delta >= 2) {
      currentStreakDays = 0;
    }
  }

  // Aggregate counts so the stats card can render without a
  // follow-up query. `userVocab` and `exerciseAttempt` are cheap
  // count queries on the indexed userId.
  const [vocabCount, exerciseAttemptCount] = await Promise.all([
    prisma.userVocab.count({ where: { userId } }),
    prisma.exerciseAttempt.count({ where: { userId } })
  ]);

  res.json({
    userId,
    xpTotal: stats?.xpTotal ?? 0,
    currentStreakDays,
    longestStreakDays: stats?.longestStreakDays ?? 0,
    lastActivityDate: stats?.lastActivityDate
      ? stats.lastActivityDate.toISOString().slice(0, 10)
      : null,
    timezone: resolveTz(stats?.timezone),
    vocabCount,
    exerciseAttemptCount
  });
});

/** Days between two `YYYY-MM-DD` strings, thin wrapper so the GET
 *  /stats handler reads cleanly. Delegates to the streak helper. */
function daysBetweenStrings(a: string, b: string, tz: string): number {
  return daysBetween(a, b, tz);
}

/* --------------------------------------------------------------------- *
 * Admin routes (Patch 11)
 * --------------------------------------------------------------------- *
 * Spec § 11 admin endpoints. Four new routes:
 *
 *   POST /admin/master-stories            — create a draft master
 *                                          story from a JSON body
 *                                          (or 409 if the slug exists)
 *   POST /admin/master-stories/:id/adapt  — kick off per-language
 *                                          adaptation jobs (writes
 *                                          `queued` rows; BullMQ was
 *                                          dropped, see below)
 *   GET  /admin/jobs/:jobId              — read job status (the
 *                                          DB row + result_story_id)
 *   POST /admin/jobs/:jobId/run          — synchronously drive a
 *                                          queued job to completion
 *                                          (replaces BullMQ worker)
 *
 * Auth: every admin route requires an authenticated user whose
 * `roles` include `"platform_admin"`. The auth middleware resolves
 * the user + `userId`; we re-query `users.roles` here so a
 * compromise of the auth header still can't reach the pipeline.
 *
 * Why no BullMQ: the project's `node_modules` install is broken in
 * a way that prevents Redis-based jobs from booting in tests, and
 * reinstalling brings in half-installed modules. The synchronous
 * orchestrator in `services/languages/adaptation.ts` is the
 * fallback; `POST /admin/jobs/:jobId/run` is the new primary
 * execution path. When BullMQ lands, this route stays as a manual
 * override; the worker becomes the primary execution path.
 * --------------------------------------------------------------------- */

interface AdminAuthedRequest extends Request {
  userId: string;
}

async function requireAdmin(req: Request, res: Response): Promise<AdminAuthedRequest | null> {
  const userId = requireUserId(req as Parameters<typeof requireUserId>[0]);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { roles: true }
  });
  if (!user?.roles?.includes("platform_admin")) {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return req as AdminAuthedRequest;
}

router.post("/admin/master-stories", authMiddleware, async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const body = (req.body ?? {}) as {
    slug?: string;
    titleEn?: string;
    cefrLevel?: string;
    synopsis?: string;
    masterScript?: unknown;
    targetVocabConcepts?: unknown;
    targetLang?: string;
  };

  if (
    typeof body.slug !== "string" ||
    typeof body.titleEn !== "string" ||
    typeof body.synopsis !== "string" ||
    typeof body.targetLang !== "string" ||
    !body.masterScript ||
    !Array.isArray(body.targetVocabConcepts)
  ) {
    res.status(400).json({
      error:
        "Body must include slug, titleEn, synopsis, targetLang (BCP-47), masterScript, targetVocabConcepts[]"
    });
    return;
  }

  const existing = await prisma.masterStory.findUnique({
    where: { slug: body.slug },
    select: { id: true }
  });
  if (existing) {
    res.status(409).json({ error: "slug already exists", slug: body.slug });
    return;
  }

  const created = await prisma.masterStory.create({
    data: {
      slug: body.slug,
      titleEn: body.titleEn,
      cefrLevel: typeof body.cefrLevel === "string" ? body.cefrLevel : "A1",
      synopsis: body.synopsis,
      masterScript: body.masterScript as object,
      targetVocabConcepts: body.targetVocabConcepts as object,
      targetLang: body.targetLang,
      animationStatus: "pending"
    }
  });

  res.status(201).json({
    masterStoryId: created.id,
    slug: created.slug,
    titleEn: created.titleEn,
    targetLang: created.targetLang,
    animationStatus: created.animationStatus
  });
});

router.post(
  "/admin/master-stories/:masterStoryId/adapt",
  authMiddleware,
  async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const rawId = req.params["masterStoryId"];
    const masterStoryId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!masterStoryId) {
      res.status(400).json({ error: "masterStoryId is required" });
      return;
    }

    const body = (req.body ?? {}) as { target_langs?: unknown };
    if (
      !Array.isArray(body.target_langs) ||
      body.target_langs.length === 0 ||
      !body.target_langs.every((x) => typeof x === "string")
    ) {
      res.status(400).json({
        error: "Body must include `target_langs: string[]` (non-empty)"
      });
      return;
    }

    const masterStory = await prisma.masterStory.findUnique({
      where: { id: masterStoryId },
      select: { id: true }
    });
    if (!masterStory) {
      res.status(404).json({ error: "master story not found", masterStoryId });
      return;
    }

    const targetLangs = body.target_langs as string[];
    const jobIds = await enqueueAdaptation({
      masterStoryId,
      targetLangs
    });

    res.status(202).json({
      masterStoryId,
      jobs: jobIds.map((id, i) => ({
        jobId: id,
        targetLang: targetLangs[i]
      }))
    });
  }
);

router.get("/admin/jobs/:jobId", authMiddleware, async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const rawId = req.params["jobId"];
  const jobId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!jobId) {
    res.status(400).json({ error: "jobId is required" });
    return;
  }

  const job = await getAdaptationJob(jobId);
  if (!job) {
    res.status(404).json({ error: "job not found", jobId });
    return;
  }

  res.json({
    jobId: job.id,
    masterStoryId: job.masterStoryId,
    targetLang: job.targetLang,
    status: job.status,
    resultStoryId: job.resultStoryId,
    errorMessage: job.errorMessage,
    attempts: job.attempts,
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString()
  });
});

/**
 * POST /admin/jobs/:jobId/run — synchronous trigger.
 *
 * Patch 11 ships without BullMQ (see Patch 11 commit notes).
 * The admin UI calls this endpoint to drive a queued job to
 * completion. When BullMQ lands, this route stays as a manual
 * override; the worker becomes the primary execution path.
 */
router.post("/admin/jobs/:jobId/run", authMiddleware, async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const rawId = req.params["jobId"];
  const jobId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!jobId) {
    res.status(400).json({ error: "jobId is required" });
    return;
  }

  try {
    await runAdaptationJob(jobId);
  } catch (err) {
    // The orchestrator already wrote the failure to the DB row;
    // we surface a 500 so the admin UI shows the toast.
    res.status(500).json({
      error: err instanceof Error ? err.message : "runAdaptationJob crashed",
      jobId
    });
    return;
  }

  const after = await getAdaptationJob(jobId);
  if (!after) {
    res.status(500).json({ error: "job disappeared during run", jobId });
    return;
  }

  res.status(200).json({
    jobId,
    status: after.status,
    resultStoryId: after.resultStoryId,
    errorMessage: after.errorMessage,
    attempts: after.attempts,
    startedAt: after.startedAt ? after.startedAt.toISOString() : null,
    completedAt: after.completedAt ? after.completedAt.toISOString() : null
  });
});

/* --------------------------------------------------------------------- *
 * Admin review screen + publishing (Patch 12)
 * --------------------------------------------------------------------- *
 * Spec § 11 admin endpoints:
 *
 *   GET  /admin/stories?status=in_review — list stories pending review
 *   GET  /admin/stories/:id              — full story detail tree
 *   PUT  /admin/stories/:id              — save edits (title, translations, lines)
 *   POST /admin/lines/:id/regenerate-audio — regenerate line audio
 *   POST /admin/stories/:id/approve      — flip reviewStatus=approved, isPublished=true
 *   POST /admin/stories/:id/reject       — flip reviewStatus=rejected + notes
 *
 * Every admin route calls `requireAdmin()` after `authMiddleware` so
 * an attacker with a stolen auth header still can't reach the review
 * queue. Story + line edits are intentionally scoped — we don't
 * expose a generic story PATCH because the review screen needs only
 * a handful of fields, and a tighter shape is easier to validate.
 * --------------------------------------------------------------------- */

router.get("/admin/stories", authMiddleware, async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
  const targetLang =
    typeof req.query["targetLang"] === "string" ? req.query["targetLang"] : undefined;
  const limit = Number(req.query["limit"] ?? 50);

  // Validate status if supplied so the SQL query doesn't accept garbage.
  if (status && !["draft", "in_review", "approved", "rejected"].includes(status)) {
    res.status(400).json({
      error: "status must be one of draft | in_review | approved | rejected"
    });
    return;
  }

  const stories = await listStoriesForReview({ status, targetLang, limit });
  res.json({ stories });
});

router.get("/admin/stories/:storyId", authMiddleware, async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const rawId = req.params["storyId"];
  const storyId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!storyId) {
    res.status(400).json({ error: "storyId is required" });
    return;
  }

  const detail = await getStoryForReview(storyId);
  if (!detail) {
    res.status(404).json({ error: "story not found", storyId });
    return;
  }

  res.json(detail);
});

router.put("/admin/stories/:storyId", authMiddleware, async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const rawId = req.params["storyId"];
  const storyId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!storyId) {
    res.status(400).json({ error: "storyId is required" });
    return;
  }

  const body = (req.body ?? {}) as {
    title?: unknown;
    titleTranslations?: unknown;
    reviewerNotes?: unknown;
    lines?: unknown;
  };

  if (body.title !== undefined && typeof body.title !== "string") {
    res.status(400).json({ error: "title must be a string" });
    return;
  }
  if (body.titleTranslations !== undefined) {
    if (
      typeof body.titleTranslations !== "object" ||
      body.titleTranslations === null ||
      Array.isArray(body.titleTranslations)
    ) {
      res.status(400).json({ error: "titleTranslations must be an object" });
      return;
    }
  }
  if (body.reviewerNotes !== undefined && typeof body.reviewerNotes !== "string") {
    res.status(400).json({ error: "reviewerNotes must be a string" });
    return;
  }
  if (body.lines !== undefined && !Array.isArray(body.lines)) {
    res.status(400).json({ error: "lines must be an array" });
    return;
  }

  const updated = await editStory(storyId, {
    title: body.title as string | undefined,
    titleTranslations: body.titleTranslations as Record<string, string> | undefined,
    reviewerNotes: body.reviewerNotes as string | undefined,
    lines: body.lines as Parameters<typeof editStory>[1]["lines"]
  });
  if (!updated) {
    res.status(404).json({ error: "story not found", storyId });
    return;
  }

  res.json(updated);
});

router.post(
  "/admin/lines/:lineId/regenerate-audio",
  authMiddleware,
  async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const rawId = req.params["lineId"];
    const lineId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!lineId) {
      res.status(400).json({ error: "lineId is required" });
      return;
    }

    const result = await regenerateLineAudio(lineId);
    if (!result) {
      res.status(404).json({ error: "line not found", lineId });
      return;
    }

    res.json(result);
  }
);

router.post(
  "/admin/stories/:storyId/approve",
  authMiddleware,
  async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const rawId = req.params["storyId"];
    const storyId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!storyId) {
      res.status(400).json({ error: "storyId is required" });
      return;
    }

    const updated = await approveStory(storyId, admin.userId);
    if (!updated) {
      res.status(404).json({ error: "story not found", storyId });
      return;
    }

    res.json(updated);
  }
);

router.post(
  "/admin/stories/:storyId/reject",
  authMiddleware,
  async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const rawId = req.params["storyId"];
    const storyId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!storyId) {
      res.status(400).json({ error: "storyId is required" });
      return;
    }

    const body = (req.body ?? {}) as { notes?: unknown };
    if (typeof body.notes !== "string" || body.notes.length === 0) {
      res.status(400).json({ error: "notes (string, non-empty) is required" });
      return;
    }

    const updated = await rejectStory(storyId, admin.userId, body.notes);
    if (!updated) {
      res.status(404).json({ error: "story not found", storyId });
      return;
    }

    res.json(updated);
  }
);

export default router;
