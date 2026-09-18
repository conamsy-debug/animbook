-- Author voice cloning — each author can upload audio samples and have
-- ElevenLabs clone them into a personal narrator voice for their books.
-- Stored on users; consent is captured at clone time for legal audit.
DO $$ BEGIN
  CREATE TYPE "VoiceStatus" AS ENUM ('NONE', 'UPLOADING', 'CLONED', 'FAILED', 'REMOVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "narrator_voice_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "voice_status" "VoiceStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "voice_sample_url" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "voice_consent_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "voice_consent_ip" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "voice_failure_reason" TEXT;
CREATE INDEX IF NOT EXISTS "users_narrator_voice_id_idx" ON "users" ("narrator_voice_id");
