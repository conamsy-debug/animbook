-- Trailer + shareable marketing link.
-- One book can have many shares; each gets a short opaque token the author
-- drops into a social bio. Every click on /share/<token> increments the
-- share's counter; authors can rotate tokens for re-launches without
-- breaking old ones.
DO $$ BEGIN
  CREATE TYPE "ShareStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'FAILED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "book_shares" (
  "id" TEXT NOT NULL,
  "book_id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "hook" TEXT NOT NULL,
  "trailer_url" TEXT,
  "thumbnail_url" TEXT,
  "status" "ShareStatus" NOT NULL DEFAULT 'PENDING',
  "failure_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "book_shares_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "book_shares_token_key" ON "book_shares" ("token");
CREATE INDEX IF NOT EXISTS "book_shares_book_id_idx" ON "book_shares" ("book_id");
CREATE INDEX IF NOT EXISTS "book_shares_status_idx" ON "book_shares" ("status");
DO $$ BEGIN
  ALTER TABLE "book_shares" ADD CONSTRAINT "book_shares_book_id_fkey"
    FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "share_clicks" (
  "id" TEXT NOT NULL,
  "share_id" TEXT NOT NULL,
  "referer" TEXT,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "share_clicks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "share_clicks_share_id_at_idx" ON "share_clicks" ("share_id", "at" DESC);
DO $$ BEGIN
  ALTER TABLE "share_clicks" ADD CONSTRAINT "share_clicks_share_id_fkey"
    FOREIGN KEY ("share_id") REFERENCES "book_shares"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
