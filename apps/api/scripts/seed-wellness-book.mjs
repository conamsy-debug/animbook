// Seed a single WELLNESS-vertical book so AnimBook DREAM has real demo
// content. Idempotent: re-running updates in place.
//
// Run from apps/api/ so Prisma auto-loads .env:
//   node scripts/seed-wellness-book.mjs

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SLUG = "the-quiet-hour";

const PAGES = [
  { pageNum: 1, chapter: "I. The room", text: "The lamp was warm and the window open. Outside, the city had begun to forget itself." },
  { pageNum: 2, chapter: "I. The room", text: "Somewhere below, a bell struck nine. The kettle answered it with a slow exhale of steam." },
  { pageNum: 3, chapter: "I. The room", text: "You sit at the table. You do not know what you are waiting for. That is the first thing the night teaches." },
  { pageNum: 4, chapter: "II. The breath", text: "Breathe in slowly. Count to four. Hold. Count to four again. Let it go for a count of six." },
  { pageNum: 5, chapter: "II. The breath", text: "The breath that returns is not the same breath that left. It carries new weight. It carries the room." },
  { pageNum: 6, chapter: "II. The breath", text: "Your shoulders begin to lower. They had been waiting for permission. You give it to them now." },
  { pageNum: 7, chapter: "III. The tide", text: "There is a tide inside the chest. It rises, it recedes. You do not push it. You only watch." },
  { pageNum: 8, chapter: "III. The tide", text: "Each breath is a wave. Each wave is small. Together they are the ocean you have been searching for." },
  { pageNum: 9, chapter: "IV. The dim", text: "The lamp dims itself. You did not touch it. The room is doing what rooms do when no one is in charge." },
  { pageNum: 10, chapter: "IV. The dim", text: "Soft things gather in the corners: the curve of a cup, the fold of a sleeve, the slow blink of an eye." },
  { pageNum: 11, chapter: "V. The drift", text: "Now you are not at the table. You are somewhere between the table and the window, suspended in the breath of the house." },
  { pageNum: 12, chapter: "V. The drift", text: "This is the drift. It is not sleep. It is the body's way of rehearsing sleep, a private dress-rehearsal before the play." },
  { pageNum: 13, chapter: "VI. The letting go", text: "You do not hold the breath. You do not hold the day. You do not hold the small unfinished sentence you carried up the stairs." },
  { pageNum: 14, chapter: "VI. The letting go", text: "The letting go is the door. The door does not need to be opened. It only needs to be acknowledged." },
  { pageNum: 15, chapter: "VII. The night", text: "The night comes not because you asked for it but because you stopped asking for anything else." },
  { pageNum: 16, chapter: "VII. The night", text: "Outside, the city remembers its name. Inside, you are already somewhere gentler. The lamp goes out by itself." },
  { pageNum: 17, chapter: "VIII. The sleep", text: "And then there is nothing to say. And the nothing is soft. And you fall into it the way a leaf falls into a still pond — without sound, without witness." }
];

const BOOK = {
  slug: SLUG,
  title: "The Quiet Hour",
  author: "AnimBook Originals",
  synopsis: "A short sleep-story for the end of the day. Seventeen pages, paced for the body's slow exhale.",
  vertical: "WELLNESS",
  language: "en",
  genre: ["Sleep", "Meditation"],
  mood: ["calm", "soft", "restful"],
  cover: "https://placehold.co/640x900/0A0710/3F8172/png?text=The+Quiet+Hour",
  pages: PAGES
};

async function main() {
  const book = await prisma.book.upsert({
    where: { slug: BOOK.slug },
    update: {
      title: BOOK.title,
      author: BOOK.author,
      synopsis: BOOK.synopsis,
      vertical: BOOK.vertical,
      language: BOOK.language,
      genreTags: BOOK.genre,
      moodTags: BOOK.mood,
      coverUrl: BOOK.cover,
      status: "PUBLISHED",
      totalPages: BOOK.pages.length
    },
    create: {
      slug: BOOK.slug,
      title: BOOK.title,
      author: BOOK.author,
      synopsis: BOOK.synopsis,
      vertical: BOOK.vertical,
      language: BOOK.language,
      genreTags: BOOK.genre,
      moodTags: BOOK.mood,
      coverUrl: BOOK.cover,
      status: "PUBLISHED",
      totalPages: BOOK.pages.length
    }
  });
  console.log(`Book upserted: ${book.slug} (${book.id})`);

  await prisma.page.deleteMany({ where: { bookId: book.id } });
  await prisma.page.createMany({
    data: BOOK.pages.map((p) => ({
      bookId: book.id,
      pageNum: p.pageNum,
      chapter: p.chapter,
      textExcerpt: p.text,
      sourceTextSha256: `${BOOK.slug}-${p.pageNum}`,
      emotionalRegister: "calm",
      cameraAngle: "fixed",
      status: "APPROVED",
      videoUrl: `https://placehold.co/640x900/0A0710/3F8172/png?text=Page+${p.pageNum}`,
      posterUrl: `https://placehold.co/640x900/0A0710/3F8172/png?text=Page+${p.pageNum}`,
      qualityScore: 0.9
    }))
  });
  console.log(`  ${BOOK.pages.length} pages seeded`);

  // A BookBrain is required for the Reader to load pages. Use a tiny one.
  await prisma.bookBrain.deleteMany({ where: { bookId: book.id } });
  const payloadJson = {
    title: BOOK.title,
    genre: BOOK.genre,
    cultural_origin: "Universal",
    target_audience: "Adults seeking sleep",
    style_recommendation: "cool, low-motion, ambient",
    characters: [],
    settings: [
      { name: "A lamp-lit room", description: "Soft amber", atmosphere: "still" }
    ],
    page_manifest: BOOK.pages.map((p) => ({
      page_num: p.pageNum,
      text_excerpt: p.text,
      setting: "lamp-lit room",
      characters_present: [],
      primary_action: "slow exhale",
      emotion: "calm",
      camera_angle: "fixed",
      animation_prompt_draft: "still interior, warm lamp, soft drift"
    }))
  };
  await prisma.bookBrain.create({
    data: {
      bookId: book.id,
      genre: BOOK.genre,
      culturalOrigin: "Universal",
      targetAudience: "Adults seeking sleep",
      styleSelected: "cool, low-motion, ambient",
      rawJson: payloadJson
    }
  });
  console.log("  BookBrain seeded");
  console.log("Done.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
