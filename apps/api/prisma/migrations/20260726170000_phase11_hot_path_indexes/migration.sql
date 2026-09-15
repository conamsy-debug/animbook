-- Phase 11 — hot-path indexes
-- Adds composite indexes for the most-frequent catalog and analytics queries.
-- Idempotent: every CREATE INDEX uses IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS "books_status_language_idx" ON "books" ("status", "language");
CREATE INDEX IF NOT EXISTS "books_status_vertical_updated_idx" ON "books" ("status", "vertical", "updated_at");
CREATE INDEX IF NOT EXISTS "checkpoint_responses_created_at_idx" ON "checkpoint_responses" ("created_at");
CREATE INDEX IF NOT EXISTS "generation_jobs_stage_status_created_idx" ON "generation_jobs" ("stage", "status", "created_at");
CREATE INDEX IF NOT EXISTS "dream_sessions_ended_at_idx" ON "dream_sessions" ("ended_at");
CREATE INDEX IF NOT EXISTS "page_signal_events_book_created_idx" ON "page_signal_events" ("book_id", "created_at");
