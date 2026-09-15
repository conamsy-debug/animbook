-- AlterTable
ALTER TABLE "checkpoints" ADD COLUMN     "correct_text" TEXT,
ADD COLUMN     "difficulty_score" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "misconception_targets" TEXT[] DEFAULT ARRAY[]::TEXT[];
