-- AnimBook Languages Phase 1 — Patch 02 follow-up: align the
-- `languages` table with the full spec § 3 field list and switch its
-- primary key from the synthetic `id` (cuid) to the BCP-47 `code`.
--
-- Fields added:
--   tts_voice_ids  JSONB, default '{}'
--   font_family    TEXT, nullable
--   is_active      BOOLEAN, NOT NULL default true
--
-- PK swap:
--   Drop the existing `languages_pkey` (on `id`) and the `id` column,
--   then promote `code` to PK. No other table has an FK on `languages.id`
--   — every cross-table reference uses `code` (Course.target_lang,
--   Course.base_lang, MasterStory.target_lang, Lexeme.target_lang).
--
-- The redundant unique index `languages_code_key` (created when `code`
-- was `@unique`) is dropped CASCADE, which drops the four FK
-- constraints that reference it. We re-add them after the PK swap.
-- CASCADE is unavoidable here: Postgres refuses to drop an index that
-- other objects depend on without it. Re-adding the FKs by hand
-- matches the FK actions in the original Patch 02 migration.
--
-- Backwards-compatible with Patch 02's seed because the seed already
-- inserts 7 rows keyed on `code`; only the PK semantics change.

-- Step 1: Drop the redundant unique index. CASCADE drops the four FK
-- constraints that reference (code).
DROP INDEX IF EXISTS "languages_code_key" CASCADE;

-- Step 2: Drop the old PK + the now-unused id column.
ALTER TABLE "languages" DROP CONSTRAINT "languages_pkey";

ALTER TABLE "languages" DROP COLUMN "id";

-- Step 3: Add the three new fields from spec § 3.
ALTER TABLE "languages" ADD COLUMN "tts_voice_ids" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "languages" ADD COLUMN "font_family" TEXT;

ALTER TABLE "languages" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- Step 4: Promote `code` to PK.
ALTER TABLE "languages" ADD CONSTRAINT "languages_pkey" PRIMARY KEY ("code");

-- Step 5: Re-add the four FK constraints that CASCADE dropped.
-- Actions mirror the FK actions in the original Patch 02 migration.
ALTER TABLE "courses" ADD CONSTRAINT "courses_target_lang_fkey" FOREIGN KEY ("target_lang") REFERENCES "languages"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "courses" ADD CONSTRAINT "courses_base_lang_fkey" FOREIGN KEY ("base_lang") REFERENCES "languages"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "master_stories" ADD CONSTRAINT "master_stories_target_lang_fkey" FOREIGN KEY ("target_lang") REFERENCES "languages"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lexemes" ADD CONSTRAINT "lexemes_target_lang_fkey" FOREIGN KEY ("target_lang") REFERENCES "languages"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
