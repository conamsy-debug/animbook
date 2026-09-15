/**
 * KIDS AnimBook seeder.
 *
 * Adds "The Tale of Peter Rabbit" (public domain, Beatrix Potter, 1902) as
 * the first KIDS vertical AnimBook. Each page tags the speaking character so
 * the Reader can route narration to the right ElevenLabs voice.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface PeterRabbitPage {
  pageNum: number;
  chapter: string;
  speaker: string;
  text: string;
  scene: string;
  emotion: string;
  camera: string;
  animationPrompt: string;
}

const pages: PeterRabbitPage[] = [
  {
    pageNum: 1,
    chapter: "Chapter 1",
    speaker: "narrator",
    text: "Once upon a time there were four little rabbits, and their names were Flopsy, Mopsy, Cotton-tail, and Peter.",
    scene: "Rabbit burrow under a hill",
    emotion: "warm",
    camera: "Wide establishing shot",
    animationPrompt: "Soft watercolour establishing shot of a sunny English hillside with a family of rabbits at the burrow entrance. Painterly."
  },
  {
    pageNum: 2,
    chapter: "Chapter 1",
    speaker: "mother",
    text: "Now, my dears, you may go into the fields or down the lane, but don't go into Mr McGregor's garden.",
    scene: "Mother rabbit by the burrow",
    emotion: "protective",
    camera: "Medium shot",
    animationPrompt: "Watercolour medium shot of a mother rabbit addressing her four little ones by the burrow entrance. Painterly."
  },
  {
    pageNum: 3,
    chapter: "Chapter 2",
    speaker: "narrator",
    text: "Flopsy, Mopsy, and Cotton-tail were good little rabbits and went down the lane to gather blackberries.",
    scene: "Lane with blackberry brambles",
    emotion: "peaceful",
    camera: "Wide tracking shot",
    animationPrompt: "Wide tracking shot following three little rabbits down a hedgerow lane picking blackberries. Watercolour."
  },
  {
    pageNum: 4,
    chapter: "Chapter 2",
    speaker: "narrator",
    text: "But Peter ran straight away to Mr McGregor's garden and squeezed under the gate.",
    scene: "Garden gate",
    emotion: "mischievous",
    camera: "Low angle close-up",
    animationPrompt: "Low angle close-up of a mischievous rabbit squeezing under a wooden garden gate. Watercolour."
  },
  {
    pageNum: 5,
    chapter: "Chapter 3",
    speaker: "fox",
    text: "First he ate some lettuces and some French beans, and then he ate some radishes.",
    scene: "Vegetable patch",
    emotion: "satisfied",
    camera: "Macro close-up",
    animationPrompt: "Macro close-up of a rabbit nibbling vegetables in a sunlit patch. Watercolour with grazing deer in the background."
  },
  {
    pageNum: 6,
    chapter: "Chapter 3",
    speaker: "narrator",
    text: "Mr McGregor was hoeing, and he saw Peter. He ran after Peter, waving a hoe and calling out 'Stop thief!'",
    scene: "Mr McGregor chasing Peter",
    emotion: "tense",
    camera: "Tracking shot",
    animationPrompt: "Tracking shot of a gardener in a straw hat chasing a small rabbit around the cabbages. Watercolour."
  },
  {
    pageNum: 7,
    chapter: "Chapter 4",
    speaker: "narrator",
    text: "Peter was most dreadfully frightened; he rushed all over the garden, for he had forgotten the way back to the gate.",
    scene: "Lost in the garden",
    emotion: "scared",
    camera: "Handheld chase",
    animationPrompt: "Handheld chase shot of a panicking rabbit darting through rows of plants. Watercolour."
  },
  {
    pageNum: 8,
    chapter: "Chapter 5",
    speaker: "narrator",
    text: "He found a door in a wall, but it was locked. The blue jacket hung on a scarecrow, and Peter put it on to hide in the gooseberry bushes.",
    scene: "Gooseberry bushes",
    emotion: "relieved",
    camera: "Wide overhead",
    animationPrompt: "Wide overhead shot of a rabbit in a too-large blue jacket hiding among gooseberry bushes. Watercolour."
  },
  {
    pageNum: 9,
    chapter: "Chapter 6",
    speaker: "narrator",
    text: "At last he found his way back to the gate and slipped underneath, and was home safe and sound.",
    scene: "Back at the gate",
    emotion: "joyful",
    camera: "Wide establishing",
    animationPrompt: "Wide establishing shot of Peter slipping under the gate into the lane, freckles glowing in the afternoon sun. Watercolour."
  }
];

async function main() {
  console.log("[kids-seed] starting");

  const book = await prisma.book.upsert({
    where: { slug: "the-tale-of-peter-rabbit" },
    update: {
      title: "The Tale of Peter Rabbit",
      author: "Beatrix Potter",
      synopsis:
        "Beatrix Potter's classic public-domain story, animated page by page. Bedtime mode dims the palette and slows the narration; character voices route narration to the rabbit, mother, fox and narrator.",
      vertical: "KIDS",
      language: "en",
      genreTags: ["Picture book", "Fairy tale"],
      moodTags: ["warm", "mischievous"],
      ageRating: "Ages 2-10",
      coverUrl: "https://placehold.co/600x900/0D1B2E/D9872A/png?text=Peter+Rabbit",
      status: "PUBLISHED",
      totalPages: pages.length
    },
    create: {
      slug: "the-tale-of-peter-rabbit",
      title: "The Tale of Peter Rabbit",
      author: "Beatrix Potter",
      synopsis:
        "Beatrix Potter's classic public-domain story, animated page by page. Bedtime mode dims the palette and slows the narration; character voices route narration to the rabbit, mother, fox and narrator.",
      vertical: "KIDS",
      language: "en",
      genreTags: ["Picture book", "Fairy tale"],
      moodTags: ["warm", "mischievous"],
      ageRating: "Ages 2-10",
      coverUrl: "https://placehold.co/600x900/0D1B2E/D9872A/png?text=Peter+Rabbit",
      status: "PUBLISHED",
      totalPages: pages.length
    }
  });

  await prisma.page.deleteMany({ where: { bookId: book.id } });
  await prisma.page.createMany({
    data: pages.map((p) => ({
      bookId: book.id,
      pageNum: p.pageNum,
      chapter: p.chapter,
      textExcerpt: p.text,
      sourceTextSha256: `peter-rabbit-${p.pageNum}`,
      animationPrompt: p.animationPrompt,
      negativePrompt: "scary, dark, unsettling",
      sceneType: p.scene,
      emotionalRegister: p.emotion,
      cameraAngle: p.camera,
      status: "APPROVED" as const,
      speakerName: p.speaker,
      videoUrl: `https://placehold.co/640x360/080C14/D9872A/png?text=Peter+Rabbit+${p.pageNum}`,
      posterUrl: `https://placehold.co/640x360/080C14/D9872A/png?text=Peter+Rabbit+${p.pageNum}`,
      qualityScore: 0.92
    }))
  });

  await prisma.bookBrain.upsert({
    where: { bookId: book.id },
    update: {},
    create: {
      bookId: book.id,
      genre: ["Picture book", "Fairy tale"],
      culturalOrigin: "United Kingdom · Lake District",
      targetAudience: "Ages 2-10",
      styleSelected: "Watercolour",
      rawJson: {
        title: "The Tale of Peter Rabbit",
        author: "Beatrix Potter",
        year: 1902,
        characters: [
          { name: "Peter", description: "Mischievous little rabbit in a blue jacket", role: "protagonist", visual_keywords: ["small rabbit", "blue jacket"] },
          { name: "Mother", description: "Caring rabbit mother", role: "supporting", visual_keywords: ["rabbit", "dappled coat"] },
          { name: "Mr McGregor", description: "The gardener", role: "antagonist", visual_keywords: ["gardener", "straw hat"] }
        ],
        settings: ["Sandylane", "Mr McGregor's garden", "Gooseberry bushes"],
        page_manifest: pages.map((p) => ({
          page_num: p.pageNum,
          text_excerpt: p.text,
          speaker: p.speaker,
          setting: p.chapter,
          primary_action: p.scene,
          emotion: p.emotion,
          camera_angle: p.camera,
          animation_prompt_draft: p.animationPrompt
        }))
      }
    }
  });

  console.log(`[kids-seed] the-tale-of-peter-rabbit -> ${pages.length} pages`);
  console.log("[kids-seed] done");
}

main()
  .catch((err) => {
    console.error("[kids-seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });