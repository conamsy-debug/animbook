-- CreateTable
CREATE TABLE "dream_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "ambient_track" TEXT NOT NULL DEFAULT 'ocean_waves',
    "pages_read" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "fell_asleep_at" TIMESTAMP(3),
    "exit_reason" TEXT,

    CONSTRAINT "dream_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companion_links" (
    "id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "marker_hash" TEXT NOT NULL,
    "nfc_tag_id" TEXT NOT NULL,
    "experience_mode" TEXT NOT NULL DEFAULT 'AR_OVERLAY',
    "anchor_page" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT,
    "companion_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companion_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companion_sessions" (
    "id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trigger_mode" TEXT NOT NULL,
    "page_reached" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "companion_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dream_sessions_user_id_started_at_idx" ON "dream_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "dream_sessions_book_id_started_at_idx" ON "dream_sessions"("book_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "companion_links_marker_hash_key" ON "companion_links"("marker_hash");

-- CreateIndex
CREATE UNIQUE INDEX "companion_links_nfc_tag_id_key" ON "companion_links"("nfc_tag_id");

-- CreateIndex
CREATE INDEX "companion_links_book_id_idx" ON "companion_links"("book_id");

-- CreateIndex
CREATE INDEX "companion_sessions_link_id_started_at_idx" ON "companion_sessions"("link_id", "started_at");

-- CreateIndex
CREATE INDEX "companion_sessions_user_id_started_at_idx" ON "companion_sessions"("user_id", "started_at");

-- AddForeignKey
ALTER TABLE "companion_sessions" ADD CONSTRAINT "companion_sessions_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "companion_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
