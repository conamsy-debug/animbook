-- AnimBook Languages Phase 1 — Patch 02.
--
-- Adds 16 new tables (10 content, 6 learner) to back the interactive
-- language-learning section. All tables are additive — no ALTERs touch
-- a pre-existing table. The FKs that reference `users(id)` are the only
-- cross-section links; everything else stays inside this section.
--
-- Down: drop the tables in reverse FK order. See migration_down.sql
-- companion note (not generated — Prisma migrate reset covers down).

-- ============================================================================
-- Content tables
-- ============================================================================

-- CreateTable
CREATE TABLE "languages" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_fr" TEXT NOT NULL,
    "name_native" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'ltr',
    "script" TEXT NOT NULL DEFAULT 'Latin',
    "reading_aid" TEXT NOT NULL DEFAULT 'none',
    "stt_code" TEXT NOT NULL,
    "is_target" BOOLEAN NOT NULL DEFAULT true,
    "is_base" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "languages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "languages_code_key" ON "languages"("code");

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "target_lang" TEXT NOT NULL,
    "base_lang" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "courses_target_lang_idx" ON "courses"("target_lang");

-- CreateIndex
CREATE INDEX "courses_base_lang_idx" ON "courses"("base_lang");

-- CreateIndex
CREATE UNIQUE INDEX "courses_target_lang_base_lang_key" ON "courses"("target_lang", "base_lang");

-- CreateTable
CREATE TABLE "master_stories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "cefr_level" TEXT NOT NULL,
    "synopsis" TEXT NOT NULL,
    "master_script" JSONB NOT NULL,
    "target_vocab_concepts" JSONB NOT NULL,
    "animation_status" TEXT NOT NULL DEFAULT 'pending',
    "target_lang" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_stories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_stories_slug_key" ON "master_stories"("slug");

-- CreateIndex
CREATE INDEX "master_stories_target_lang_idx" ON "master_stories"("target_lang");

-- CreateIndex
CREATE INDEX "master_stories_animation_status_idx" ON "master_stories"("animation_status");

-- CreateTable
CREATE TABLE "master_scenes" (
    "id" TEXT NOT NULL,
    "master_story_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "visual_prompt" TEXT NOT NULL,
    "still_url" TEXT,
    "clip_url" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_scenes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "master_scenes_master_story_id_idx" ON "master_scenes"("master_story_id");

-- CreateIndex
CREATE UNIQUE INDEX "master_scenes_master_story_id_order_key" ON "master_scenes"("master_story_id", "order");

-- CreateTable
CREATE TABLE "stories" (
    "id" TEXT NOT NULL,
    "master_story_id" TEXT NOT NULL,
    "target_lang" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "title_translations" JSONB NOT NULL,
    "cefr_level" TEXT NOT NULL,
    "review_status" TEXT NOT NULL DEFAULT 'draft',
    "reviewer_id" TEXT,
    "reviewer_notes" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stories_target_lang_idx" ON "stories"("target_lang");

-- CreateIndex
CREATE INDEX "stories_review_status_idx" ON "stories"("review_status");

-- CreateIndex
CREATE INDEX "stories_is_published_idx" ON "stories"("is_published");

-- CreateIndex
CREATE UNIQUE INDEX "stories_master_story_id_target_lang_key" ON "stories"("master_story_id", "target_lang");

-- CreateTable
CREATE TABLE "scenes" (
    "id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "master_scene_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scenes_story_id_idx" ON "scenes"("story_id");

-- CreateIndex
CREATE INDEX "scenes_master_scene_id_idx" ON "scenes"("master_scene_id");

-- CreateIndex
CREATE UNIQUE INDEX "scenes_story_id_order_key" ON "scenes"("story_id", "order");

-- CreateTable
CREATE TABLE "lines" (
    "id" TEXT NOT NULL,
    "scene_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "speaker" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "text_reading" TEXT,
    "translations" JSONB NOT NULL,
    "audio_url" TEXT,
    "start_ms" INTEGER,
    "end_ms" INTEGER,
    "word_timings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lines_scene_id_idx" ON "lines"("scene_id");

-- CreateIndex
CREATE UNIQUE INDEX "lines_scene_id_order_key" ON "lines"("scene_id", "order");

-- CreateTable
CREATE TABLE "lexemes" (
    "id" TEXT NOT NULL,
    "target_lang" TEXT NOT NULL,
    "lemma" TEXT NOT NULL,
    "reading" TEXT,
    "part_of_speech" TEXT NOT NULL,
    "gender" TEXT,
    "glosses" JSONB NOT NULL,
    "audio_url" TEXT,
    "frequency_rank" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lexemes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lexemes_target_lang_idx" ON "lexemes"("target_lang");

-- CreateIndex
CREATE INDEX "lexemes_target_lang_frequency_rank_idx" ON "lexemes"("target_lang", "frequency_rank");

-- CreateIndex
CREATE UNIQUE INDEX "lexemes_target_lang_lemma_part_of_speech_key" ON "lexemes"("target_lang", "lemma", "part_of_speech");

-- CreateTable
CREATE TABLE "line_tokens" (
    "id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "surface" TEXT NOT NULL,
    "reading" TEXT,
    "lexeme_id" TEXT,
    "is_new_in_story" BOOLEAN NOT NULL DEFAULT false,
    "start_char" INTEGER NOT NULL,
    "end_char" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "line_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "line_tokens_line_id_idx" ON "line_tokens"("line_id");

-- CreateIndex
CREATE INDEX "line_tokens_lexeme_id_idx" ON "line_tokens"("lexeme_id");

-- CreateIndex
CREATE UNIQUE INDEX "line_tokens_line_id_order_key" ON "line_tokens"("line_id", "order");

-- CreateTable
CREATE TABLE "exercises" (
    "id" TEXT NOT NULL,
    "scene_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "answer" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exercises_scene_id_idx" ON "exercises"("scene_id");

-- CreateIndex
CREATE INDEX "exercises_type_idx" ON "exercises"("type");

-- CreateIndex
CREATE UNIQUE INDEX "exercises_scene_id_order_key" ON "exercises"("scene_id", "order");

-- ============================================================================
-- Learner tables
-- ============================================================================

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_story_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enrollments_user_id_idx" ON "enrollments"("user_id");

-- CreateIndex
CREATE INDEX "enrollments_course_id_idx" ON "enrollments"("course_id");

-- CreateIndex
CREATE INDEX "enrollments_last_active_at_idx" ON "enrollments"("last_active_at");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_user_id_course_id_key" ON "enrollments"("user_id", "course_id");

-- CreateTable
CREATE TABLE "story_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "last_scene_order" INTEGER NOT NULL DEFAULT 1,
    "score_pct" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "story_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "story_progress_user_id_idx" ON "story_progress"("user_id");

-- CreateIndex
CREATE INDEX "story_progress_story_id_idx" ON "story_progress"("story_id");

-- CreateIndex
CREATE INDEX "story_progress_status_idx" ON "story_progress"("status");

-- CreateIndex
CREATE UNIQUE INDEX "story_progress_user_id_story_id_key" ON "story_progress"("user_id", "story_id");

-- CreateTable
CREATE TABLE "exercise_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "score" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exercise_attempts_user_id_created_at_idx" ON "exercise_attempts"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "exercise_attempts_exercise_id_idx" ON "exercise_attempts"("exercise_id");

-- CreateTable
CREATE TABLE "pronunciation_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "audio_url" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pronunciation_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pronunciation_attempts_user_id_created_at_idx" ON "pronunciation_attempts"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "pronunciation_attempts_line_id_idx" ON "pronunciation_attempts"("line_id");

-- CreateTable
CREATE TABLE "user_vocab" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "lexeme_id" TEXT NOT NULL,
    "source_line_id" TEXT,
    "due" TIMESTAMP(3) NOT NULL,
    "stability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difficulty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "elapsed_days" INTEGER NOT NULL DEFAULT 0,
    "scheduled_days" INTEGER NOT NULL DEFAULT 0,
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'new',
    "last_review" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_vocab_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_vocab_user_id_due_idx" ON "user_vocab"("user_id", "due");

-- CreateIndex
CREATE INDEX "user_vocab_lexeme_id_idx" ON "user_vocab"("lexeme_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_vocab_user_id_lexeme_id_key" ON "user_vocab"("user_id", "lexeme_id");

-- CreateTable
CREATE TABLE "review_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_vocab_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "review_at" TIMESTAMP(3) NOT NULL,
    "meta" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_logs_user_id_review_at_idx" ON "review_logs"("user_id", "review_at");

-- CreateIndex
CREATE INDEX "review_logs_user_vocab_id_idx" ON "review_logs"("user_vocab_id");

-- CreateTable
CREATE TABLE "learner_stats" (
    "user_id" TEXT NOT NULL,
    "xp_total" INTEGER NOT NULL DEFAULT 0,
    "current_streak_days" INTEGER NOT NULL DEFAULT 0,
    "longest_streak_days" INTEGER NOT NULL DEFAULT 0,
    "last_activity_date" DATE,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_stats_pkey" PRIMARY KEY ("user_id")
);

-- ============================================================================
-- Foreign keys
-- ============================================================================

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_target_lang_fkey" FOREIGN KEY ("target_lang") REFERENCES "languages"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_base_lang_fkey" FOREIGN KEY ("base_lang") REFERENCES "languages"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_stories" ADD CONSTRAINT "master_stories_target_lang_fkey" FOREIGN KEY ("target_lang") REFERENCES "languages"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_scenes" ADD CONSTRAINT "master_scenes_master_story_id_fkey" FOREIGN KEY ("master_story_id") REFERENCES "master_stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_master_story_id_fkey" FOREIGN KEY ("master_story_id") REFERENCES "master_stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_master_scene_id_fkey" FOREIGN KEY ("master_scene_id") REFERENCES "master_scenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lines" ADD CONSTRAINT "lines_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lexemes" ADD CONSTRAINT "lexemes_target_lang_fkey" FOREIGN KEY ("target_lang") REFERENCES "languages"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tokens" ADD CONSTRAINT "line_tokens_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_tokens" ADD CONSTRAINT "line_tokens_lexeme_id_fkey" FOREIGN KEY ("lexeme_id") REFERENCES "lexemes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_progress" ADD CONSTRAINT "story_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_progress" ADD CONSTRAINT "story_progress_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pronunciation_attempts" ADD CONSTRAINT "pronunciation_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pronunciation_attempts" ADD CONSTRAINT "pronunciation_attempts_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_vocab" ADD CONSTRAINT "user_vocab_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_vocab" ADD CONSTRAINT "user_vocab_lexeme_id_fkey" FOREIGN KEY ("lexeme_id") REFERENCES "lexemes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_user_vocab_id_fkey" FOREIGN KEY ("user_vocab_id") REFERENCES "user_vocab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_stats" ADD CONSTRAINT "learner_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
