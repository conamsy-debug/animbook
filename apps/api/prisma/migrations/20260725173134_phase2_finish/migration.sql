-- AlterTable
ALTER TABLE "books" ADD COLUMN     "iconographic_notes" TEXT,
ADD COLUMN     "narration_languages" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "libraries" ADD COLUMN     "downloaded_at" TIMESTAMP(3),
ADD COLUMN     "narration_language" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "roles" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "review_decisions" (
    "id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "status" "ExpertReviewStatus" NOT NULL,
    "notes" TEXT NOT NULL,
    "iconographic_concerns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "royalty_entries" (
    "id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "payee_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "royalty_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_decisions_book_id_created_at_idx" ON "review_decisions"("book_id", "created_at");

-- CreateIndex
CREATE INDEX "review_decisions_reviewer_id_created_at_idx" ON "review_decisions"("reviewer_id", "created_at");

-- CreateIndex
CREATE INDEX "royalty_entries_payee_id_period_end_idx" ON "royalty_entries"("payee_id", "period_end");

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "royalty_entries" ADD CONSTRAINT "royalty_entries_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "royalty_entries" ADD CONSTRAINT "royalty_entries_payee_id_fkey" FOREIGN KEY ("payee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
