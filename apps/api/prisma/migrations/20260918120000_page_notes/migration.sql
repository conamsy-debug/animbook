-- Margin notes readers leave on a page, and profile photos.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" TEXT;

CREATE TABLE IF NOT EXISTS "page_notes" (
  "id" TEXT NOT NULL,
  "page_id" TEXT NOT NULL,
  "book_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'VISIBLE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "page_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "page_notes_page_id_status_created_at_idx" ON "page_notes" ("page_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "page_notes_book_id_status_idx" ON "page_notes" ("book_id", "status");
CREATE INDEX IF NOT EXISTS "page_notes_user_id_idx" ON "page_notes" ("user_id");
DO $$ BEGIN
  ALTER TABLE "page_notes" ADD CONSTRAINT "page_notes_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "page_notes" ADD CONSTRAINT "page_notes_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "page_notes" ADD CONSTRAINT "page_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
