-- Release schedule: how a book reaches its readers.
-- IMMEDIATE keeps the legacy publish-all-at-once behaviour.
-- TIME drips chunks on a calendar cadence (DAILY/WEEKLY/MONTHLY).
-- TASK unlocks a chunk each time a reader submits the daily task the
-- author wrote for that chunk.
--
-- Chunks are materialised at publish time (one row per chunk). For TIME
-- books `released_at` is set lazily on first read so we don't need a cron.

-- Enums ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "ReleaseMode" AS ENUM ('IMMEDIATE', 'TIME', 'TASK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "ReleaseCadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Books ---------------------------------------------------------------------
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "release_mode"           "ReleaseMode";
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "release_cadence"        "ReleaseCadence";
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "release_chunk_percent"  INTEGER;
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "release_start_at"       TIMESTAMP(3);
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "release_schedule_locked_at" TIMESTAMP(3);

-- Chunks --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "book_chunks" (
  "id"            TEXT NOT NULL,
  "book_id"       TEXT NOT NULL,
  "chunk_index"   INTEGER NOT NULL,
  "page_start"    INTEGER NOT NULL,
  "page_end"      INTEGER NOT NULL,
  "scheduled_for" TIMESTAMP(3) NOT NULL,
  "released_at"   TIMESTAMP(3),
  CONSTRAINT "book_chunks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "book_chunks_book_id_chunk_index_key"
  ON "book_chunks" ("book_id", "chunk_index");
CREATE INDEX IF NOT EXISTS "book_chunks_book_id_scheduled_for_idx"
  ON "book_chunks" ("book_id", "scheduled_for");

-- Daily tasks ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "book_daily_tasks" (
  "id"          TEXT NOT NULL,
  "book_id"     TEXT NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "prompt"      TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "book_daily_tasks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "book_daily_tasks_book_id_chunk_index_key"
  ON "book_daily_tasks" ("book_id", "chunk_index");

-- Task submissions ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "book_task_submissions" (
  "id"           TEXT NOT NULL,
  "book_id"      TEXT NOT NULL,
  "chunk_index"  INTEGER NOT NULL,
  "user_id"      TEXT NOT NULL,
  "text"         TEXT NOT NULL,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "book_task_submissions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "book_task_submissions_user_id_book_id_idx"
  ON "book_task_submissions" ("user_id", "book_id");
CREATE INDEX IF NOT EXISTS "book_task_submissions_book_id_chunk_index_idx"
  ON "book_task_submissions" ("book_id", "chunk_index");

-- Foreign keys (idempotent via DO block) -----------------------------------
DO $$ BEGIN
  ALTER TABLE "book_chunks" ADD CONSTRAINT "book_chunks_book_id_fkey"
    FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "book_daily_tasks" ADD CONSTRAINT "book_daily_tasks_book_id_fkey"
    FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "book_task_submissions" ADD CONSTRAINT "book_task_submissions_book_id_fkey"
    FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "book_task_submissions" ADD CONSTRAINT "book_task_submissions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
