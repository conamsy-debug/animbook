-- Cost / usage tracking
--
-- Records every external-cost event (Runway still / clip / kick,
-- ElevenLabs TTS, trailer, etc.) so the Profile "Spending" section
-- can show "spent $X this week" without scraping logs. Insert-only —
-- rows are never updated or deleted by the application.
--
-- Cascading FKs to User + Book so deleting a creator or a book cleans
-- up the corresponding rows automatically.
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "page_id" TEXT,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "unit_cost_usd" DOUBLE PRECISION NOT NULL,
    "total_usd" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- Composite indexes for the dashboard queries
--   by-week:        WHERE user_id = ? AND created_at >= ?  GROUP BY date_trunc('week', created_at)
--   by-book:        WHERE user_id = ?  GROUP BY book_id
--   by-kind:        WHERE user_id = ?  GROUP BY kind
CREATE INDEX "usage_events_user_id_created_at_idx" ON "usage_events"("user_id", "created_at");
CREATE INDEX "usage_events_book_id_idx" ON "usage_events"("book_id");
CREATE INDEX "usage_events_user_id_kind_created_at_idx" ON "usage_events"("user_id", "kind", "created_at");

-- Cascading FKs
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_book_id_fkey"
    FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
