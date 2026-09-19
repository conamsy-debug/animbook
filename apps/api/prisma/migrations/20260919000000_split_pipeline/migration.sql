-- Split stills from animation — additive only, safe to apply to production.
--
-- Adds a per-book opt-in (Book.splitPipeline), and per-page lifecycle
-- columns (stillStatus / clipStatus / audioStatus) so authors can approve a
-- still before paying for its clip. Books with splitPipeline=false keep
-- the legacy single-stage VIDEO_GENERATION path exactly as it is today.
--
-- Backfill:
--   * pages that already have a still (posterUrl)        → stillStatus = APPROVED
--   * pages with status APPROVED                          → clipStatus  = APPROVED
--   * pages with status FLAGGED                           → clipStatus  = FLAGGED
--   * pages with status PENDING                           → clipStatus  = READY
--   * pages with status REGENERATING                      → clipStatus  = QUEUED
--   * pages with narration audio (audioUrl)               → audioStatus = READY
--
-- The brief is explicit: do NOT auto-enable splitPipeline on any existing
-- book — the user flips it on for one test book manually in the DB.

DO $$ BEGIN
  CREATE TYPE "StillStatus" AS ENUM ('NONE', 'GENERATING', 'READY', 'APPROVED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ClipStatus" AS ENUM ('NONE', 'QUEUED', 'GENERATING', 'READY', 'APPROVED', 'FLAGGED', 'FAILED', 'STALE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AudioStatus" AS ENUM ('NONE', 'GENERATING', 'READY', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MotionTier" AS ENUM ('HERO', 'STANDARD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "split_pipeline" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "still_status"  "StillStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "clip_status"   "ClipStatus"  NOT NULL DEFAULT 'NONE';
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "audio_status"  "AudioStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "still_prompt"  TEXT;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "still_version" INTEGER       NOT NULL DEFAULT 0;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "motion_tier"   "MotionTier"  NOT NULL DEFAULT 'STANDARD';

CREATE INDEX IF NOT EXISTS "pages_clip_status_idx"  ON "pages" ("book_id", "clip_status");
CREATE INDEX IF NOT EXISTS "pages_still_status_idx" ON "pages" ("book_id", "still_status");
CREATE INDEX IF NOT EXISTS "books_split_pipeline_idx" ON "books" ("split_pipeline") WHERE "split_pipeline" = true;

-- Backfill stills (any page with a poster frame was effectively "approved"
-- before this feature existed — author can't see the review queue to reject
-- legacy stills).
UPDATE "pages" SET "still_status" = 'APPROVED'
WHERE "poster_url" IS NOT NULL AND "still_status" = 'NONE';

-- Backfill clip status from legacy single-stage status column.
UPDATE "pages" SET "clip_status" = 'APPROVED' WHERE "status" = 'APPROVED'  AND "clip_status" = 'NONE';
UPDATE "pages" SET "clip_status" = 'FLAGGED'  WHERE "status" = 'FLAGGED'   AND "clip_status" = 'NONE';
UPDATE "pages" SET "clip_status" = 'READY'    WHERE "status" = 'PENDING'   AND "clip_status" = 'NONE';
UPDATE "pages" SET "clip_status" = 'QUEUED'   WHERE "status" = 'REGENERATING' AND "clip_status" = 'NONE';

-- Backfill audio status. Pages that already have narration are READY.
UPDATE "pages" SET "audio_status" = 'READY' WHERE "audio_url" IS NOT NULL AND "audio_status" = 'NONE';