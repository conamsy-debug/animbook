-- Shot system, part 2: the character reference image and the list of
-- characters in each shot's frame.
--
-- reference_image_url holds ONE image per character, generated once from the
-- character bible's `look` wording. It is passed as subject_reference when
-- generating a first-frame still so the same character looks the same in
-- every shot of the book.
--
-- characters_in_frame lists the role labels of the characters visible in a
-- shot, so the renderer knows which reference images to attach.
ALTER TABLE "shot_characters" ADD COLUMN "reference_image_url" TEXT;

ALTER TABLE "shots" ADD COLUMN "characters_in_frame" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
