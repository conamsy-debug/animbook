-- Reading circles: small private groups reading a book together.
CREATE TABLE IF NOT EXISTS "circles" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "book_id" TEXT,
  "owner_id" TEXT NOT NULL,
  "invite_code" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "circles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "circles_invite_code_key" ON "circles" ("invite_code");
CREATE INDEX IF NOT EXISTS "circles_owner_id_idx" ON "circles" ("owner_id");

CREATE TABLE IF NOT EXISTS "circle_members" (
  "id" TEXT NOT NULL,
  "circle_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'MEMBER',
  "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "circle_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "circle_members_circle_id_user_id_key" ON "circle_members" ("circle_id", "user_id");
CREATE INDEX IF NOT EXISTS "circle_members_user_id_idx" ON "circle_members" ("user_id");

CREATE TABLE IF NOT EXISTS "circle_posts" (
  "id" TEXT NOT NULL,
  "circle_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "page_num" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'VISIBLE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "circle_posts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "circle_posts_circle_id_created_at_idx" ON "circle_posts" ("circle_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "circles" ADD CONSTRAINT "circles_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "circles" ADD CONSTRAINT "circles_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "circle_members" ADD CONSTRAINT "circle_members_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "circle_members" ADD CONSTRAINT "circle_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "circle_posts" ADD CONSTRAINT "circle_posts_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "circle_posts" ADD CONSTRAINT "circle_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
