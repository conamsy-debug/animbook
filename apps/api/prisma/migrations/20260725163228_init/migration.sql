-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('BASIC', 'PREMIUM', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('INCOMPLETE', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BookVertical" AS ENUM ('CONSUMER', 'KIDS', 'EDU', 'FAITH', 'DOCS', 'VERSE', 'COMICS', 'BUSINESS', 'WELLNESS', 'LAW', 'TRAVEL', 'ORIGINALS');

-- CreateEnum
CREATE TYPE "BookStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ExpertReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'IN_REVIEW', 'APPROVED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "PageStatus" AS ENUM ('PENDING', 'APPROVED', 'FLAGGED', 'REGENERATING');

-- CreateEnum
CREATE TYPE "ReadingMode" AS ENUM ('WATCH', 'BOTH', 'READ');

-- CreateEnum
CREATE TYPE "InstitutionType" AS ENUM ('SCHOOL', 'UNIVERSITY', 'CORPORATE');

-- CreateEnum
CREATE TYPE "StudioProjectStatus" AS ENUM ('SETUP', 'ANALYZING', 'BRAIN_REVIEW', 'STYLE_SELECTION', 'STYLE_TRAINING', 'GENERATING', 'REVIEW', 'AUDIO', 'READY_TO_PUBLISH', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('MANUSCRIPT_INGESTION', 'BOOK_BRAIN_ANALYSIS', 'VISUAL_STYLE', 'PROMPT_GENERATION', 'VIDEO_GENERATION', 'QUALITY_TRIAGE', 'AUDIO_PRODUCTION', 'ASSEMBLY', 'METADATA_UPLOAD', 'PUBLISH');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRYING');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "clerk_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "UserTier" NOT NULL DEFAULT 'BASIC',
    "subscription_status" "SubscriptionStatus",
    "stripe_customer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "license_agreement_url" TEXT,
    "revenue_share_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publishers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "synopsis" TEXT NOT NULL,
    "isbn" TEXT,
    "publisher_id" TEXT,
    "vertical" "BookVertical" NOT NULL,
    "status" "BookStatus" NOT NULL DEFAULT 'DRAFT',
    "style_id" TEXT,
    "total_pages" INTEGER NOT NULL DEFAULT 0,
    "genre_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mood_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "age_rating" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "cover_url" TEXT,
    "requires_expert_review" BOOLEAN NOT NULL DEFAULT false,
    "expert_review_status" "ExpertReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "page_num" INTEGER NOT NULL,
    "chapter" TEXT,
    "text_excerpt" TEXT NOT NULL,
    "source_text_sha256" TEXT NOT NULL,
    "animation_prompt" TEXT,
    "negative_prompt" TEXT,
    "video_url" TEXT,
    "poster_url" TEXT,
    "audio_url" TEXT,
    "vtt_url" TEXT,
    "quality_score" DOUBLE PRECISION,
    "status" "PageStatus" NOT NULL DEFAULT 'PENDING',
    "direction_note" TEXT,
    "regeneration_count" INTEGER NOT NULL DEFAULT 0,
    "scene_type" TEXT,
    "emotional_register" TEXT,
    "camera_angle" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "libraries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "progress_page" INTEGER NOT NULL DEFAULT 1,
    "last_read" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" "ReadingMode" NOT NULL DEFAULT 'BOTH',
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "libraries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "stripe_subscription_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_brain" (
    "id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "genre" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cultural_origin" TEXT,
    "target_audience" TEXT,
    "style_selected" TEXT,
    "narrator_voice_id" TEXT,
    "raw_json" JSONB NOT NULL,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "book_brain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkpoints" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "correct_index" INTEGER,
    "explanation" TEXT NOT NULL,
    "question_type" TEXT NOT NULL,
    "curriculum_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkpoint_responses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "checkpoint_id" TEXT NOT NULL,
    "selected_index" INTEGER,
    "response_text" TEXT,
    "is_correct" BOOLEAN NOT NULL,
    "time_taken_seconds" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkpoint_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institutions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "InstitutionType" NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "seat_count" INTEGER NOT NULL DEFAULT 0,
    "license_expires_at" TIMESTAMP(3),
    "lms_integration" JSONB,
    "sso_config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_projects" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "book_id" TEXT,
    "name" TEXT NOT NULL,
    "vertical" "BookVertical" NOT NULL,
    "status" "StudioProjectStatus" NOT NULL DEFAULT 'SETUP',
    "current_stage" "PipelineStage" NOT NULL DEFAULT 'MANUSCRIPT_INGESTION',
    "source_filename" TEXT,
    "source_object_key" TEXT,
    "manuscript_sha256" TEXT,
    "expert_review_required" BOOLEAN NOT NULL DEFAULT false,
    "approved_for_publish_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_jobs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "queue_job_id" TEXT,
    "stage" "PipelineStage" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "error_message" TEXT,
    "result" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_clerk_id_key" ON "users"("clerk_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripe_customer_id_key" ON "users"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "books_slug_key" ON "books"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "books_isbn_key" ON "books"("isbn");

-- CreateIndex
CREATE INDEX "books_vertical_status_idx" ON "books"("vertical", "status");

-- CreateIndex
CREATE INDEX "books_title_idx" ON "books"("title");

-- CreateIndex
CREATE INDEX "pages_book_id_status_idx" ON "pages"("book_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pages_book_id_page_num_key" ON "pages"("book_id", "page_num");

-- CreateIndex
CREATE INDEX "libraries_user_id_last_read_idx" ON "libraries"("user_id", "last_read");

-- CreateIndex
CREATE UNIQUE INDEX "libraries_user_id_book_id_key" ON "libraries"("user_id", "book_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "book_brain_book_id_key" ON "book_brain"("book_id");

-- CreateIndex
CREATE INDEX "checkpoints_page_id_idx" ON "checkpoints"("page_id");

-- CreateIndex
CREATE INDEX "checkpoint_responses_user_id_created_at_idx" ON "checkpoint_responses"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "checkpoint_responses_checkpoint_id_idx" ON "checkpoint_responses"("checkpoint_id");

-- CreateIndex
CREATE INDEX "institutions_admin_user_id_idx" ON "institutions"("admin_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "studio_projects_book_id_key" ON "studio_projects"("book_id");

-- CreateIndex
CREATE INDEX "studio_projects_owner_id_updated_at_idx" ON "studio_projects"("owner_id", "updated_at");

-- CreateIndex
CREATE INDEX "studio_projects_status_current_stage_idx" ON "studio_projects"("status", "current_stage");

-- CreateIndex
CREATE UNIQUE INDEX "generation_jobs_queue_job_id_key" ON "generation_jobs"("queue_job_id");

-- CreateIndex
CREATE INDEX "generation_jobs_project_id_created_at_idx" ON "generation_jobs"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "generation_jobs_status_stage_idx" ON "generation_jobs"("status", "stage");

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "libraries" ADD CONSTRAINT "libraries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "libraries" ADD CONSTRAINT "libraries_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_brain" ADD CONSTRAINT "book_brain_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkpoint_responses" ADD CONSTRAINT "checkpoint_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkpoint_responses" ADD CONSTRAINT "checkpoint_responses_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "checkpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_projects" ADD CONSTRAINT "studio_projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_projects" ADD CONSTRAINT "studio_projects_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "studio_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
