-- CreateTable
CREATE TABLE "worlds" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "synopsis" TEXT NOT NULL,
    "accent_color" TEXT NOT NULL DEFAULT '#C49A1C',
    "style_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worlds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world_members" (
    "id" TEXT NOT NULL,
    "world_id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "shared_characters" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "world_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_rounds" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "brief" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "opens_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closes_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_contributions" (
    "id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "contributor_id" TEXT NOT NULL,
    "page_num" INTEGER NOT NULL,
    "text_excerpt" TEXT NOT NULL,
    "voice" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rate_limit_rpm" INTEGER NOT NULL DEFAULT 60,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_signal_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "page_num" INTEGER NOT NULL,
    "vertical" TEXT NOT NULL,
    "dwell_ms" INTEGER NOT NULL,
    "scrolled_back" BOOLEAN NOT NULL DEFAULT false,
    "abandoned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_signal_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "worlds_slug_key" ON "worlds"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "world_members_book_id_key" ON "world_members"("book_id");

-- CreateIndex
CREATE INDEX "world_members_world_id_ordinal_idx" ON "world_members"("world_id", "ordinal");

-- CreateIndex
CREATE INDEX "stage_rounds_project_id_ordinal_idx" ON "stage_rounds"("project_id", "ordinal");

-- CreateIndex
CREATE INDEX "stage_contributions_round_id_page_num_idx" ON "stage_contributions"("round_id", "page_num");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_owner_id_revoked_at_idx" ON "api_keys"("owner_id", "revoked_at");

-- CreateIndex
CREATE INDEX "page_signal_events_user_id_created_at_idx" ON "page_signal_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "page_signal_events_book_id_page_num_idx" ON "page_signal_events"("book_id", "page_num");

-- AddForeignKey
ALTER TABLE "world_members" ADD CONSTRAINT "world_members_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_members" ADD CONSTRAINT "world_members_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_rounds" ADD CONSTRAINT "stage_rounds_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "studio_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_rounds" ADD CONSTRAINT "stage_rounds_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_contributions" ADD CONSTRAINT "stage_contributions_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "stage_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_signal_events" ADD CONSTRAINT "page_signal_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
