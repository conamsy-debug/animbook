-- Voice clone UX polish (multi-file upload + preview + quality scoring).
-- All columns are additive nullable / with defaults — no breaking change to
-- existing rows. Authors who uploaded a single file before this migration
-- will have:
--   voice_sample_urls   = NULL (legacy single URL lives in voice_sample_url)
--   voice_quality_score = NULL (quality not yet computed)
--   voice_quality_computed_at = NULL
ALTER TABLE users
  ADD COLUMN voice_sample_urls       JSONB    DEFAULT NULL,
  ADD COLUMN voice_quality_score     INTEGER  DEFAULT NULL
    CHECK (voice_quality_score IS NULL OR (voice_quality_score >= 0 AND voice_quality_score <= 100)),
  ADD COLUMN voice_quality_details   JSONB    DEFAULT NULL,
  ADD COLUMN voice_quality_computed_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN users.voice_sample_urls IS
  'Array of R2 URLs for each individual sample uploaded during the most recent voice clone. voice_sample_url stays as the first/primary URL for backwards compat.';
COMMENT ON COLUMN users.voice_quality_score IS
  'Heuristic quality score 0-100 for the latest clone: weighted sum of sample count, total duration, audio format / bitrate. Higher = better trained clone. NULL until computed.';
COMMENT ON COLUMN users.voice_quality_details IS
  'Per-component breakdown of the quality score so the UI can show "samples: 4/5 · duration: 2:13 · format: mp3 192kbps".';
COMMENT ON COLUMN users.voice_quality_computed_at IS
  'When voice_quality_score was last computed. The score is stale once the underlying samples change (next clone / delete).';

CREATE INDEX users_voice_quality_score_idx
  ON users (voice_quality_score)
  WHERE voice_quality_score IS NOT NULL;
