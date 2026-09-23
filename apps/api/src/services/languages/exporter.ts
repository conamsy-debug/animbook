/**
 * AnimBook Languages (Phase 1) — Lesson exporter.
 *
 * Inverse of `importer.ts`. Reads a Story (with its scenes, lines,
 * tokens, lexemes, exercises) and produces the JSON shape from
 * spec § 5. The output is what you'd commit to git if you wanted
 * to round-trip a story out of the database and back in.
 *
 * Fields intentionally omitted from the export (they don't survive
 * a re-import):
 *   - All cuid IDs (masterStory.id, story.id, scene.id, line.id,
 *     token.id, exercise.id, lexeme.id). The importer regenerates
 *     them.
 *   - timestamps (created_at, updated_at).
 *   - reviewStatus, isPublished (admin fields; importer resets
 *     both to draft/false).
 *   - audioUrl, startMs, endMs, wordTimings (TTS fields; filled
 *     by Patch 11's pipeline after import).
 *   - The MasterScene records and any cross-language lexeme
 *     sharing — the exporter follows the Story subtree only.
 *
 * Round-trip contract: `parseLesson(exportStory(story))` produces
 * a JSON value that, when passed back to `importLesson`, writes
 * the same DB rows modulo the regenerated ids and the admin/TTS
 * fields above.
 */
import type { PrismaClient } from "@prisma/client";
import type { Lesson, LessonToken, LessonExercise } from "./types.js";

export interface ExportOptions {
  /** Base language for the export's translations + glosses. Defaults to "en". */
  baseLang?: "en" | "fr";
}

/**
 * Export a Story by its cuid id. Throws if the story doesn't exist
 * or has no target_lang (defensive — schema requires it).
 */
export async function exportStory(
  prisma: PrismaClient,
  storyId: string,
  options: ExportOptions = {}
): Promise<Lesson> {
  const baseLang = options.baseLang ?? "en";

  const story = await prisma.story.findUnique({
    where: { id: storyId },
    include: {
      masterStory: true,
      scenes: {
        orderBy: { order: "asc" },
        include: {
          lines: {
            orderBy: { order: "asc" },
            include: {
              tokens: {
                orderBy: { order: "asc" },
                include: { lexeme: true }
              }
            }
          },
          exercises: { orderBy: { order: "asc" } }
        }
      }
    }
  });
  if (!story) {
    throw new Error(`exportStory: story ${storyId} not found`);
  }

  // Title translations come from `title_translations` JSON which is
  // shaped `{en: string, fr: string}` per spec. Fall back to the
  // story.title if a base language is missing.
  const titleTranslations = (story.titleTranslations as unknown as {
    en?: string;
    fr?: string;
  }) ?? { en: story.title, fr: story.title };

  return {
    master_story_slug: story.masterStory.slug,
    target_lang: story.targetLang as Lesson["target_lang"],
    cefr_level: story.cefrLevel as Lesson["cefr_level"],
    title: story.title,
    title_translations: {
      en: titleTranslations.en ?? story.title,
      fr: titleTranslations.fr ?? story.title
    },
    scenes: story.scenes.map((scene) => ({
      master_scene_order: scene.order,
      lines: scene.lines.map((line) => {
        const translations = (line.translations as unknown as {
          en?: string;
          fr?: string;
        }) ?? { en: line.text, fr: line.text };
        return {
          speaker: line.speaker,
          text: line.text,
          text_reading: line.textReading,
          translations: {
            en: translations.en ?? line.text,
            fr: translations.fr ?? line.text
          },
          tokens: line.tokens.map<LessonToken>((token) => tokenToLessonToken(token, baseLang))
        };
      }),
      exercises: scene.exercises.map<LessonExercise>((ex) => exerciseToLessonExercise(ex))
    }))
  };
}

/* --------------------------------------------------------------------- *
 * Per-row converters
 * --------------------------------------------------------------------- */

interface TokenWithLexeme {
  surface: string;
  reading: string | null;
  isNewInStory: boolean;
  lexeme: {
    id: string;
    lemma: string;
    partOfSpeech: string;
    gender: string | null;
    glosses: unknown;
    reading: string | null;
  } | null;
}

function tokenToLessonToken(token: TokenWithLexeme, baseLang: "en" | "fr"): LessonToken {
  const out: LessonToken = {
    surface: token.surface,
    lemma: token.lexeme?.lemma ?? null,
    reading: token.reading ?? null,
    is_new: token.isNewInStory
  };
  if (token.lexeme) {
    // Patch 06 — surface the lexeme cuid so the player can hand the
    // popup endpoint an authoritative id (no need to resolve by
    // lemma+pos, which collides for homonyms like the Spanish
    // "banco" seat vs bank).
    out.lexeme_id = token.lexeme.id;
    out.pos = token.lexeme.partOfSpeech;
    if (token.lexeme.gender) out.gender = token.lexeme.gender as "m" | "f" | "n";
    const glosses = (token.lexeme.glosses as Record<string, string[]>) ?? {};
    const filtered: { en?: string[]; fr?: string[] } = {};
    for (const lang of ["en", "fr"] as const) {
      if (Array.isArray(glosses[lang]) && glosses[lang].length > 0) {
        filtered[lang] = glosses[lang];
      }
    }
    // Always include at least the requested base lang, even if empty,
    // so a re-import carries the same shape the admin would type.
    if (Object.keys(filtered).length > 0) {
      out.glosses = filtered;
    }
    // baseLang is currently unused — the importer preserves all
    // glosses regardless of base. Reserved for future per-base
    // filtering (e.g. "only en glosses for a French-base viewer").
    void baseLang;
  }
  return out;
}

interface ExerciseRow {
  type: string;
  payload: unknown;
  answer: unknown;
}

function exerciseToLessonExercise(ex: ExerciseRow): LessonExercise {
  const payload = ex.payload as Record<string, unknown>;
  const answer = ex.answer as Record<string, unknown> | null;
  switch (ex.type) {
    case "comprehension_mc":
      return {
        type: "comprehension_mc",
        payload: payload as { question: { en: string; fr: string }; options: string[] },
        answer: { index: (answer?.index as number) ?? 0 }
      };
    case "word_meaning_mc":
      return {
        type: "word_meaning_mc",
        payload: payload as { lexeme_id: string; options: { en: string[]; fr: string[] } },
        answer: { index: (answer?.index as number) ?? 0 }
      };
    case "sentence_builder":
      return {
        type: "sentence_builder",
        payload: payload as { line_id: string; tokens: string[] },
        answer: { order: (answer?.order as number[]) ?? [] }
      };
    case "listen_select":
      return {
        type: "listen_select",
        payload: payload as { audio_url: string; options: string[] },
        answer: { index: (answer?.index as number) ?? 0 }
      };
    case "speak_line":
      return {
        type: "speak_line",
        payload: payload as { line_id: string },
        answer: null
      };
    default:
      throw new Error(`exportStory: unknown exercise type "${ex.type}"`);
  }
}
