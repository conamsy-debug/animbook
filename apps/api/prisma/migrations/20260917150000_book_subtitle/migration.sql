-- Optional subtitle shown under a book's title.
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "subtitle" TEXT;
