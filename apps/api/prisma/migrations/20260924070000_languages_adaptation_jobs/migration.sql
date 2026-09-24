-- AnimBook Languages Phase 1 — Patch 11: adaptation job ledger.
--
-- One row per BullMQ adaptation job kicked off by
-- POST /api/lang/admin/master-stories/:id/adapt. The route writes
-- a `queued` row synchronously and the worker flips it through
-- `running → completed | failed`. The admin screen (Patch 12)
-- reads the row straight off the table to render progress.
--
-- `target_langs` carries the comma-separated BCP-47 codes (the
-- route splits a single adapt call into per-language child jobs
-- so a failure on `he` doesn't abort `es`).
--
-- `result_story_ids` is JSONB so we don't need a second table for
-- the per-language Story ids produced by the worker. Patch 12's
-- admin review screen reads the array to jump to each version.
--
-- No FK to `master_stories.id` because we don't want a cascade
-- delete of the in-flight jobs — the worker can read the master
-- story by id and decide whether to abort when it's gone.

CREATE TABLE "languages_adaptation_jobs" (
    "id"              TEXT         PRIMARY KEY,
    "master_story_id" TEXT         NOT NULL,
    "target_lang"     TEXT         NOT NULL,
    "status"          TEXT         NOT NULL DEFAULT 'queued',
    -- queued | running | completed | failed
    "result_story_id" TEXT,
    "error_message"   TEXT,
    "attempts"        INTEGER      NOT NULL DEFAULT 0,
    "started_at"      TIMESTAMP(3),
    "completed_at"    TIMESTAMP(3),
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL
);

CREATE INDEX "languages_adaptation_jobs_master_story_id_idx"
    ON "languages_adaptation_jobs"("master_story_id");

CREATE INDEX "languages_adaptation_jobs_status_idx"
    ON "languages_adaptation_jobs"("status");

CREATE INDEX "languages_adaptation_jobs_created_at_idx"
    ON "languages_adaptation_jobs"("created_at");
