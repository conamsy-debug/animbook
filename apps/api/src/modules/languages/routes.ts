/**
 * AnimBook Languages (Phase 1) — HTTP routes.
 *
 * Mounted at `/api/lang` in src/index.ts when isFeatureEnabled("LANGUAGES")
 * is true. Patch 04 adds the first real endpoint: the story player
 * payload. Patches 05–12 add the rest per docs/languages-phase1.md § 11.
 *
 * Every learner-facing route uses requireUserId() so unauthenticated
 * requests 401; admin routes use requireAdmin() once that helper
 * exists (Patch 12).
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

export default router;
