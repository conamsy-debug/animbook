-- Reader-to-author messaging (community patch 4 of 4).

-- How this account is treated by the community layer.
-- ADULT | SCHOOL | MINOR. Anything other than ADULT is a protected account.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "account_kind" TEXT NOT NULL DEFAULT 'ADULT';

-- Back-fill: anyone already sitting in a classroom is a school account, and
-- school accounts get no private messaging and no community writing.
UPDATE "users" u
SET "account_kind" = 'SCHOOL',
    "community_disabled" = TRUE,
    "messages_open" = FALSE
WHERE EXISTS (
  SELECT 1 FROM "classroom_memberships" m
  WHERE m."student_id" = u."id" AND m."role" = 'STUDENT'
);

-- Anyone previously switched off by hand keeps their inbox shut.
UPDATE "users" SET "messages_open" = FALSE WHERE "community_disabled" = TRUE;

CREATE TABLE IF NOT EXISTS "message_threads" (
  "id" TEXT NOT NULL,
  "reader_id" TEXT NOT NULL,
  "author_id" TEXT NOT NULL,
  "book_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reader_read_at" TIMESTAMP(3),
  "author_read_at" TIMESTAMP(3),
  CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "messages" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "sender_id" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'VISIBLE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "message_threads_reader_id_author_id_key" ON "message_threads"("reader_id", "author_id");
CREATE INDEX IF NOT EXISTS "message_threads_author_id_last_message_at_idx" ON "message_threads"("author_id", "last_message_at");
CREATE INDEX IF NOT EXISTS "message_threads_reader_id_last_message_at_idx" ON "message_threads"("reader_id", "last_message_at");
CREATE INDEX IF NOT EXISTS "messages_thread_id_created_at_idx" ON "messages"("thread_id", "created_at");
CREATE INDEX IF NOT EXISTS "messages_sender_id_idx" ON "messages"("sender_id");

ALTER TABLE "message_threads" DROP CONSTRAINT IF EXISTS "message_threads_reader_id_fkey";
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_reader_id_fkey"
  FOREIGN KEY ("reader_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_threads" DROP CONSTRAINT IF EXISTS "message_threads_author_id_fkey";
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_threads" DROP CONSTRAINT IF EXISTS "message_threads_book_id_fkey";
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_book_id_fkey"
  FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_thread_id_fkey";
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_sender_id_fkey";
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey"
  FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
