-- AlterEnum
ALTER TYPE "PipelineStage" ADD VALUE 'TRAILER_GENERATION';

-- DropIndex
DROP INDEX "books_creator_id_idx";

-- DropIndex
DROP INDEX "pages_clip_status_idx";

-- DropIndex
DROP INDEX "pages_still_status_idx";

-- DropIndex
DROP INDEX "share_clicks_share_id_at_idx";

-- DropIndex
DROP INDEX "users_narrator_voice_id_idx";

-- AlterTable
ALTER TABLE "book_shares" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "voice_quality_computed_at" SET DATA TYPE TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "share_clicks_share_id_at_idx" ON "share_clicks"("share_id", "at");

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "books_status_vertical_updated_idx" RENAME TO "books_status_vertical_updated_at_idx";

-- RenameIndex
ALTER INDEX "generation_jobs_stage_status_created_idx" RENAME TO "generation_jobs_stage_status_created_at_idx";

-- RenameIndex
ALTER INDEX "page_signal_events_book_created_idx" RENAME TO "page_signal_events_book_id_created_at_idx";
