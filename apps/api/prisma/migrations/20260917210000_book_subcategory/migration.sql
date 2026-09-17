-- Shelf inside a vertical, e.g. "christian" for FAITH.
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "subcategory" TEXT;
CREATE INDEX IF NOT EXISTS "books_vertical_subcategory_status_idx" ON "books" ("vertical", "subcategory", "status");
