-- Shot chaining: a shot that continues the previous one on the same page is
-- generated from the LAST FRAME of the previous clip instead of from a new
-- still, so the costume, the face and the light carry over from shot to shot.
ALTER TABLE "shots" ADD COLUMN "continues_previous" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shots" ADD COLUMN "previous_shot_id" TEXT;
ALTER TABLE "shots" ADD COLUMN "chained_frame_url" TEXT;
