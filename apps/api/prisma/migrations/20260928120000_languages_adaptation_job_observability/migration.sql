-- AnimBook Languages Patch 11 follow-up: adaptation job observability.
--
-- Adds columns to `languages_adaptation_jobs` so a failed job doesn't
-- lose its full LLM response (was capped at 4000 chars in errorMessage)
-- and so the orchestrator can record Anthropic token usage on every
-- job, success or failure.
--
-- Columns:
--   full_raw_output            TEXT  — full LLM response, no truncation
--   input_tokens               INT   — Anthropic input_tokens summed over attempts
--   output_tokens              INT   — Anthropic output_tokens summed over attempts
--   last_attempt_input_tokens  INT   — same but for the final attempt only
--   last_attempt_output_tokens INT   — same but for the final attempt only
--
-- All nullable so existing rows from before this migration don't need
-- backfill. ADD COLUMN IF NOT EXISTS is not standard Postgres, but
-- the migration only runs once so this is fine.

ALTER TABLE "languages_adaptation_jobs"
    ADD COLUMN "full_raw_output"            TEXT,
    ADD COLUMN "input_tokens"               INTEGER,
    ADD COLUMN "output_tokens"              INTEGER,
    ADD COLUMN "last_attempt_input_tokens"  INTEGER,
    ADD COLUMN "last_attempt_output_tokens" INTEGER;
