/**
 * AnimBook Languages (Phase 1) — Lesson importer.
 *
 * Takes a parsed lesson (output of `parseLesson`) and writes every
 * row to the database via Prisma. Idempotent: re-importing the same
 * lesson JSON produces the same DB state, so:
 *
 *  - MasterStory upserts by `slug`
 *  - Story upserts by (master_story_id, target_lang)
 *  - MasterScene upserts by (master_story_id, order)
 *  - Scene upserts by (story_id, order)
 *  - Line + Exercise: deletes-and-recreates for the story (lines +
 *    exercises don't have a natural stable key in the JSON, so the
 *    "delete everything in this Story's subtree, then re-insert"
 *    pattern is the safest). The lexeme FK uses `SetNull` so deleting
 *    lines won't cascade-kill lexemes.
 *  - Lexeme: find-or-create by (target_lang, lemma, pos). When a
 *    token's lexeme_id points at an existing lexeme, we re-use it;
 *    glosses are merged (new ones appended) so re-importing with
 *    richer glosses doesn't lose data.
 *
 * The function does NOT touch:
 *   - Course rows (the lesson JSON doesn't carry course_id — Patch 05
 *     wires Story.target_lang to a Course)
 *   - MasterScript content beyond a placeholder (Patch 11's pipeline
 *     fills master_script from a richer source)
 *   - Lexeme.audio_url (Patch 11 generates audio after import)
 *
 * Throws on:
 *   - Invalid input (LessonValidationError from `schema.ts`)
 *   - Unknown target_lang (FK violation surfaces as PrismaClientKnownRequestError)
 *   - Same on a per-row basis — partial imports don't half-write, we
 *     wrap the whole flow in prisma.$transaction so a single failure
 *     rolls everything back.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { ImportResult } from "./types.js";
import type { ParsedLesson } from "./schema.js";
// Prisma is imported for `Prisma.JsonNull` on the line.wordTimings column.

/** Prisma JSON-typed glosses — spec says `{en: [...], fr: [...]}` */
type GlossesMap = Record<string, string[]>;

export interface ImportOptions {
  /**
   * When true, write all rows inside a transaction so a failure
   * halfway through rolls everything back. Defaults to true.
   */
  transactional?: boolean;
}

/** Public entry point. Validates input then writes. */
export async function importLesson(
  prisma: PrismaClient,
  rawInput: unknown,
  options: ImportOptions = {}
): Promise<ImportResult> {
  // Importing parseLesson lazily to keep this file's cold-path cost
  // low. The schema is the source of truth for validation; this file
  // is purely the DB-writer.
  const { parseLesson } = await import("./schema.js");
  const lesson = parseLesson(rawInput);
  const useTxn = options.transactional ?? true;
  if (useTxn) {
    // NOTE: prisma.$transaction must be called via `prisma.$transaction`
    // — destructuring it (e.g. `const tx = prisma.$transaction`) breaks
    // because the method's `this` binding is the Prisma client.
    return prisma.$transaction(async (tx) => writeLesson(tx, lesson));
  }
  return writeLesson(prisma as unknown as Prisma.TransactionClient, lesson);
}

/* --------------------------------------------------------------------- *
 * Core writer
 * --------------------------------------------------------------------- */

async function writeLesson(
  tx: Prisma.TransactionClient,
  lesson: ParsedLesson
): Promise<ImportResult> {
  // 1. Upsert MasterStory by slug.
  const masterScriptPayload = {
    slug: lesson.master_story_slug,
    cefr_level: lesson.cefr_level,
    scenes: lesson.scenes.map((s) => ({
      order: s.master_scene_order,
      visual_prompt: `placeholder — Patch 11 will generate from master script`,
      lines: []
    }))
  };
  const masterStory = await tx.masterStory.upsert({
    where: { slug: lesson.master_story_slug },
    update: {
      titleEn: lesson.title,
      cefrLevel: lesson.cefr_level,
      targetLang: lesson.target_lang,
      // synopsis is on MasterStory as a NOT NULL text column; fall back
      // to the lesson synopsis or the title if the lesson didn't ship
      // one.
      synopsis: lesson.synopsis ?? lesson.title,
      // Master_script is a placeholder until Patch 11's pipeline fills
      // it. The importer records scene order + a generic visual prompt
      // so the admin screen has something to render.
      masterScript: masterScriptPayload as unknown as Prisma.InputJsonValue,
      targetVocabConcepts: (lesson.target_vocab_concepts ?? []) as unknown as Prisma.InputJsonValue,
      animationStatus: "pending" as const
    },
    create: {
      slug: lesson.master_story_slug,
      titleEn: lesson.title,
      cefrLevel: lesson.cefr_level,
      targetLang: lesson.target_lang,
      synopsis: lesson.synopsis ?? lesson.title,
      masterScript: masterScriptPayload as unknown as Prisma.InputJsonValue,
      targetVocabConcepts: (lesson.target_vocab_concepts ?? []) as unknown as Prisma.InputJsonValue,
      animationStatus: "pending" as const
    }
  });

  // 2. Upsert Story by (master_story_id, target_lang). Story doesn't
  //    carry a stable `slug` because the same slug serves many
  //    languages.
  const story = await tx.story.upsert({
    where: {
      masterStoryId_targetLang: {
        masterStoryId: masterStory.id,
        targetLang: lesson.target_lang
      }
    },
    update: {
      title: lesson.title,
      titleTranslations: lesson.title_translations,
      cefrLevel: lesson.cefr_level,
      isPublished: false,
      reviewStatus: "draft"
    },
    create: {
      masterStoryId: masterStory.id,
      targetLang: lesson.target_lang,
      title: lesson.title,
      titleTranslations: lesson.title_translations,
      cefrLevel: lesson.cefr_level,
      isPublished: false,
      reviewStatus: "draft"
    }
  });

  // 3. Wipe the story's subtree (lines + tokens + scenes + exercises)
  //    so the importer is idempotent. The schema's onDelete rules:
  //      Line → Scene   (Cascade, via Scene.lines)
  //      LineToken → Line (Cascade)
  //      Exercise → Scene (Cascade)
  //    So deleting scenes nukes everything beneath them in one
  //    statement. MasterScenes stay — they're shared across
  //    languages.
  await tx.scene.deleteMany({ where: { storyId: story.id } });

  let scenesCreated = 0;
  let linesCreated = 0;
  let tokensCreated = 0;
  let exercisesCreated = 0;
  let lexemesCreated = 0;
  let lexemesReused = 0;

  // 4. Per-scene: upsert MasterScene, create Scene, write lines,
  //    tokens, exercises, upsert lexemes.
  for (const lessonScene of lesson.scenes) {
    // MasterScene: shared across languages. order is the natural key.
    const masterScene = await tx.masterScene.upsert({
      where: {
        masterStoryId_order: {
          masterStoryId: masterStory.id,
          order: lessonScene.master_scene_order
        }
      },
      update: {
        // Visual prompt is owned by Patch 11's pipeline. Leave
        // existing values alone; only set the placeholder on first
        // insert.
      },
      create: {
        masterStoryId: masterStory.id,
        order: lessonScene.master_scene_order,
        visualPrompt: "placeholder — Patch 11 will generate visual prompt"
      }
    });

    const scene = await tx.scene.create({
      data: {
        storyId: story.id,
        masterSceneId: masterScene.id,
        order: lessonScene.master_scene_order
      }
    });
    scenesCreated += 1;

    // Lines.
    for (let lineIdx = 0; lineIdx < lessonScene.lines.length; lineIdx++) {
      const lessonLine = lessonScene.lines[lineIdx];
      const line = await tx.line.create({
        data: {
          sceneId: scene.id,
          order: lineIdx + 1,
          speaker: lessonLine.speaker,
          text: lessonLine.text,
          textReading: lessonLine.text_reading ?? null,
          translations: lessonLine.translations,
          audioUrl: null,
          startMs: null,
          endMs: null,
          wordTimings: Prisma.JsonNull
        }
      });
      linesCreated += 1;

      // Tokens + lexemes. We resolve the lexeme_id FIRST so the
      // token row can carry the FK.
      for (let tokenIdx = 0; tokenIdx < lessonLine.tokens.length; tokenIdx++) {
        const token = lessonLine.tokens[tokenIdx];
        let lexemeId: string | null = null;
        if (token.lemma !== null && token.pos) {
          const lexemeResult = await upsertLexeme(tx, lesson.target_lang, {
            lemma: token.lemma,
            partOfSpeech: token.pos,
            gender: token.gender ?? null,
            glosses: token.glosses ?? null,
            reading: token.reading ?? null
          });
          lexemeId = lexemeResult.id;
          if (lexemeResult.created) lexemesCreated += 1;
          else lexemesReused += 1;
        }
        await tx.lineToken.create({
          data: {
            lineId: line.id,
            order: tokenIdx + 1,
            surface: token.surface,
            reading: token.reading ?? null,
            lexemeId,
            isNewInStory: Boolean(token.is_new),
            startChar: 0, // Patch 11 fills via real TTS alignment
            endChar: token.surface.length
          }
        });
        tokensCreated += 1;
      }
    }

    // Exercises.
    for (let exIdx = 0; exIdx < lessonScene.exercises.length; exIdx++) {
      const ex = lessonScene.exercises[exIdx];
      // Patch 07 — word_meaning_mc payloads carry `lexeme_id` so the
      // learner knows which word's meaning to pick. The lesson JSON
      // can't ship real cuids (those don't exist until import), so
      // fixtures use a `<placeholder-<lemma>-id>` convention. Resolve
      // the placeholder against the lexemes we just imported so the
      // DB row carries an authoritative id.
      const resolvedPayload = await resolveExercisePayload(tx, ex.payload, lesson.target_lang);
      await tx.exercise.create({
        data: {
          sceneId: scene.id,
          order: exIdx + 1,
          type: ex.type,
          payload: resolvedPayload,
          answer: ex.answer ?? {}
        }
      });
      exercisesCreated += 1;
    }
  }

  return {
    masterStoryId: masterStory.id,
    storyId: story.id,
    scenesCreated,
    linesCreated,
    tokensCreated,
    lexemesCreated,
    lexemesReused,
    exercisesCreated
  };
}

/* --------------------------------------------------------------------- *
 * Lexeme upsert
 * --------------------------------------------------------------------- */

interface UpsertLexemeInput {
  lemma: string;
  partOfSpeech: string;
  gender: string | null;
  glosses: { en?: string[]; fr?: string[] } | null;
  reading: string | null;
}

/**
 * Find-or-create a Lexeme by (target_lang, lemma, part_of_speech).
 * On reuse, merge new glosses into the existing record (dedupe by
 * string so re-imports don't accumulate duplicates).
 */
async function upsertLexeme(
  tx: Prisma.TransactionClient,
  targetLang: string,
  input: UpsertLexemeInput
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.lexeme.findUnique({
    where: {
      targetLang_lemma_partOfSpeech: {
        targetLang,
        lemma: input.lemma,
        partOfSpeech: input.partOfSpeech
      }
    }
  });

  if (existing) {
    // Merge glosses (dedupe per base lang).
    const merged = mergeGlosses(
      (existing.glosses as unknown as GlossesMap) ?? {},
      input.glosses ?? {}
    );
    await tx.lexeme.update({
      where: { id: existing.id },
      data: {
        glosses: merged,
        // Only overwrite gender/reading if the new value is set.
        gender: input.gender ?? existing.gender,
        reading: input.reading ?? existing.reading
      }
    });
    return { id: existing.id, created: false };
  }

  const created = await tx.lexeme.create({
    data: {
      targetLang,
      lemma: input.lemma,
      partOfSpeech: input.partOfSpeech,
      gender: input.gender,
      glosses: input.glosses ?? {},
      reading: input.reading
    }
  });
  return { id: created.id, created: true };
}

function mergeGlosses(existing: GlossesMap, incoming: { en?: string[]; fr?: string[] }): GlossesMap {
  const out: GlossesMap = { ...existing };
  for (const lang of ["en", "fr"] as const) {
    const add = incoming[lang];
    if (!add || add.length === 0) continue;
    const cur = out[lang] ?? [];
    const seen = new Set(cur.map((g) => g.toLowerCase()));
    const merged = [...cur];
    for (const g of add) {
      if (!seen.has(g.toLowerCase())) {
        merged.push(g);
        seen.add(g.toLowerCase());
      }
    }
    out[lang] = merged;
  }
  return out;
}

/**
 * Resolve `<placeholder-<lemma>-id>` placeholders inside an exercise
 * payload to the real Lexeme cuid. We only touch the `lexeme_id`
 * field — other strings in the payload are left verbatim. If the
 * placeholder lemma isn't in the catalogue (e.g. a typo in the
 * fixture), we leave the placeholder in place so the admin can spot
 * the drift via the admin review screen (Patch 12).
 */
async function resolveExercisePayload(
  tx: Prisma.TransactionClient,
  payload: Record<string, unknown>,
  targetLang: string
): Promise<Record<string, unknown>> {
  const lexemeId = payload["lexeme_id"];
  if (typeof lexemeId !== "string") return payload;
  // Convention: <placeholder-<lemma>-id> for hand-written fixtures.
  // Real cuids start with `cm` and don't contain angle brackets.
  const match = /^<placeholder-([a-zA-ZÀ-ɏ_-]+)-id>$/.exec(lexemeId);
  if (!match) return payload;
  const lemma = match[1]!;
  const lex = await tx.lexeme.findFirst({
    where: { targetLang, lemma },
    select: { id: true, partOfSpeech: true }
  });
  if (!lex) return payload;
  return { ...payload, lexeme_id: lex.id };
}
