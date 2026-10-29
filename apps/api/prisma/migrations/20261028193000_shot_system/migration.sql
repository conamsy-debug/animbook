-- Multi-shot system.
--
-- A page used to own ONE ~5s clip that the player looped. It now owns a
-- sequence of SHOTS, each covering its own slice of the page narration, so
-- the picture moves with the voice instead of looping a single image.
--
-- `shots` is additive: `Page.videoUrl` stays exactly where it is and remains
-- the fallback for every book that has no shot rows.
--
-- `shot_characters` is the book-level character bible: the `look` wording is
-- reused verbatim in every shot prompt of the book, and `role_label` is how
-- the character is referred to in prompts (never their name).
CREATE TYPE "ShotStatus" AS ENUM ('PLANNED', 'QUEUED', 'GENERATING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "shots" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "narration_start_ms" INTEGER NOT NULL,
    "narration_end_ms" INTEGER NOT NULL,
    "narration_text" TEXT NOT NULL,
    "shot_prompt" TEXT NOT NULL,
    "still_prompt" TEXT NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "video_url" TEXT,
    "poster_url" TEXT,
    "provider" TEXT,
    "status" "ShotStatus" NOT NULL DEFAULT 'PLANNED',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shot_characters" (
    "id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "role_label" TEXT NOT NULL,
    "look" TEXT NOT NULL,
    "motion" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shot_characters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shots_page_id_status_idx" ON "shots"("page_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shots_page_id_order_key" ON "shots"("page_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "shot_characters_book_id_role_label_key" ON "shot_characters"("book_id", "role_label");

-- AddForeignKey
ALTER TABLE "shots" ADD CONSTRAINT "shots_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shot_characters" ADD CONSTRAINT "shot_characters_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
