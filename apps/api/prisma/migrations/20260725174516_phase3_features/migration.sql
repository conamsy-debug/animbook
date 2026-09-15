-- CreateTable
CREATE TABLE "memory_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "palette" TEXT NOT NULL DEFAULT 'default',
    "pacing" TEXT NOT NULL DEFAULT 'default',
    "camera_style" TEXT NOT NULL DEFAULT 'default',
    "narration_speed" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "font_size" INTEGER NOT NULL DEFAULT 18,
    "motion_level" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "lens_enabled" BOOLEAN NOT NULL DEFAULT false,
    "echo_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_trees" (
    "id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "root_page" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oracle_trees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_nodes" (
    "id" TEXT NOT NULL,
    "tree_id" TEXT NOT NULL,
    "parent_node_id" TEXT,
    "prompt_text" TEXT NOT NULL,
    "choice_label" TEXT NOT NULL,
    "page_num" INTEGER NOT NULL,
    "generated_text" TEXT NOT NULL,
    "animation_prompt" TEXT NOT NULL,
    "speaker_name" TEXT,
    "emotion" TEXT NOT NULL DEFAULT 'reflective',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oracle_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_sessions" (
    "id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LIVE',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "current_page" INTEGER NOT NULL DEFAULT 1,
    "audience_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "live_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_events" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_glosses" (
    "id" TEXT NOT NULL,
    "source_lang" TEXT NOT NULL,
    "target_lang" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "pronunciation" TEXT,
    "example_sentence" TEXT,
    "book_id" TEXT,

    CONSTRAINT "translation_glosses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "memory_profiles_user_id_key" ON "memory_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oracle_trees_book_id_root_page_key" ON "oracle_trees"("book_id", "root_page");

-- CreateIndex
CREATE INDEX "oracle_nodes_tree_id_page_num_idx" ON "oracle_nodes"("tree_id", "page_num");

-- CreateIndex
CREATE INDEX "live_sessions_status_started_at_idx" ON "live_sessions"("status", "started_at");

-- CreateIndex
CREATE INDEX "live_events_session_id_created_at_idx" ON "live_events"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "translation_glosses_book_id_idx" ON "translation_glosses"("book_id");

-- CreateIndex
CREATE UNIQUE INDEX "translation_glosses_source_lang_target_lang_word_key" ON "translation_glosses"("source_lang", "target_lang", "word");

-- AddForeignKey
ALTER TABLE "memory_profiles" ADD CONSTRAINT "memory_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_trees" ADD CONSTRAINT "oracle_trees_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_nodes" ADD CONSTRAINT "oracle_nodes_tree_id_fkey" FOREIGN KEY ("tree_id") REFERENCES "oracle_trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oracle_nodes" ADD CONSTRAINT "oracle_nodes_parent_node_id_fkey" FOREIGN KEY ("parent_node_id") REFERENCES "oracle_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_events" ADD CONSTRAINT "live_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
