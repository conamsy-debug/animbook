/**
 * AnimBook Languages (Phase 1) — Patch 02 seeder.
 *
 * Inserts the 7 Phase 1 languages and 12 Phase 1 courses. Idempotent:
 * uses `upsert` keyed on the unique constraint, so re-running the
 * script on a populated DB is a no-op apart from `updatedAt` churn.
 *
 * Run with:
 *   npx tsx apps/api/prisma/languages-seed.ts
 *
 * The CI / Railway migration order is:
 *   1. Apply migration `20260922120000_animbook_languages_p1` to prod
 *   2. Push the code change
 *   3. Run this seeder against prod (manual one-shot via
 *      `railway run npx tsx apps/api/prisma/languages-seed.ts`)
 *
 * The seeder deliberately stays out of the main `prisma/seed.ts`
 * pipeline — Patch 12 (admin review + publishing) owns the
 * post-launch content seeding, and we don't want every `db:seed`
 * run to also re-upsert languages.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import {
  LANGUAGE_SEED,
  COURSE_SEED,
  LANGUAGE_COUNT,
  COURSE_COUNT,
  isValidCoursePair
} from "./languages-seed-data";

const prisma = new PrismaClient();

async function main() {
  console.log(`[languages-seed] starting — ${LANGUAGE_COUNT} languages, ${COURSE_COUNT} courses`);

  // Phase 1: languages. Upserted by `code` (the PK after the second
  // migration). The new fields tts_voice_ids / font_family / is_active
  // (spec § 3) are written here; re-running the script refreshes them
  // so a font swap or voice-id bump propagates without a fresh seed.
  for (const row of LANGUAGE_SEED) {
    await prisma.language.upsert({
      where: { code: row.code },
      update: {
        nameEn: row.nameEn,
        nameFr: row.nameFr,
        nameNative: row.nameNative,
        direction: row.direction,
        script: row.script,
        readingAid: row.readingAid,
        sttCode: row.sttCode,
        ttsVoiceIds: row.ttsVoiceIds as Prisma.InputJsonValue,
        fontFamily: row.fontFamily,
        isTarget: row.isTarget,
        isBase: row.isBase,
        isActive: row.isActive
      },
      create: {
        code: row.code,
        nameEn: row.nameEn,
        nameFr: row.nameFr,
        nameNative: row.nameNative,
        direction: row.direction,
        script: row.script,
        readingAid: row.readingAid,
        sttCode: row.sttCode,
        ttsVoiceIds: row.ttsVoiceIds as Prisma.InputJsonValue,
        fontFamily: row.fontFamily,
        isTarget: row.isTarget,
        isBase: row.isBase,
        isActive: row.isActive
      }
    });
  }
  console.log(`[languages-seed] languages upserted: ${LANGUAGE_COUNT}`);

  // Phase 2: courses. Upserted by composite (targetLang, baseLang).
  // isValidCoursePair guards against a future copy/paste bug inserting
  // (en,en) or (fr,fr) — the unique constraint would catch it, but
  // failing loudly here surfaces the drift before the DB does.
  let coursesWritten = 0;
  for (const row of COURSE_SEED) {
    if (!isValidCoursePair(row.targetLang, row.baseLang)) {
      throw new Error(
        `[languages-seed] invalid course pair (${row.targetLang}, ${row.baseLang})`
      );
    }
    await prisma.course.upsert({
      where: {
        targetLang_baseLang: {
          targetLang: row.targetLang,
          baseLang: row.baseLang
        }
      },
      update: {
        title: row.title,
        description: row.description,
        // Patch 05 — the routes filter by isPublished so admin
        // drafts don't leak. The seed represents the live catalog,
        // so all 12 courses ship as published. An operator who
        // wants to retire a course sets this flag back to false
        // directly in the DB.
        isPublished: true
      },
      create: {
        targetLang: row.targetLang,
        baseLang: row.baseLang,
        title: row.title,
        description: row.description,
        isPublished: true
      }
    });
    coursesWritten += 1;
  }
  console.log(`[languages-seed] courses upserted: ${coursesWritten}`);

  // Sanity counts. We log rather than assert so an operator can spot
  // drift at a glance. The CI smoke is `apps/api/tests/languagesSeed.test.mjs`.
  const langCount = await prisma.language.count();
  const courseCount = await prisma.course.count();
  console.log(`[languages-seed] post-run counts: languages=${langCount}, courses=${courseCount}`);
  if (langCount < LANGUAGE_COUNT) {
    throw new Error(`[languages-seed] expected >= ${LANGUAGE_COUNT} languages, found ${langCount}`);
  }
  if (courseCount < COURSE_COUNT) {
    throw new Error(`[languages-seed] expected >= ${COURSE_COUNT} courses, found ${courseCount}`);
  }

  console.log("[languages-seed] done");
}

main()
  .catch((err) => {
    console.error("[languages-seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
