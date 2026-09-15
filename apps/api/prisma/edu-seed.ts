/**
 * EDU AnimBook seeder.
 *
 * Adds a mitosis-themed AnimBook so the EDU module has live data for the
 * student reader, checkpoint overlay, teacher dashboard, and curriculum
 * heatmap. Mirrors the schema shape used by the seed script in prisma/seed.ts
 * and writes through the same Prisma client.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface MitosisPage {
  pageNum: number;
  chapter: string;
  text: string;
  scene: string;
  emotion: string;
  camera: string;
  animationPrompt: string;
}

const pages: MitosisPage[] = [
  {
    pageNum: 1,
    chapter: "Chapter 1 · Interphase",
    text: "Before a cell divides it lives for most of its life in interphase, growing steadily and quietly duplicating its DNA. The chromosomes we associate with division are not yet visible — they exist as long, thin strands of chromatin.",
    scene: "Cell at rest",
    emotion: "calm",
    camera: "Microscopy close-up",
    animationPrompt:
      "Slow microscopy drift across a single eukaryotic cell at interphase. The nucleus glows softly; chromatin strands drift like loose thread. Painterly realism with scientific accuracy."
  },
  {
    pageNum: 2,
    chapter: "Chapter 1 · Prophase",
    text: "In prophase the chromatin coils into visible chromosomes, each made of two sister chromatids joined at the centromere. The nuclear envelope begins to break down and the mitotic spindle assembles from centrioles that have moved to opposite poles.",
    scene: "Chromosome condensing",
    emotion: "anticipation",
    camera: "Macro detail",
    animationPrompt:
      "Macro cinematic push-in as chromatin coils into X-shaped chromosomes inside a dissolving nucleus. Spindle fibres begin to reach outward. Painterly mysticism."
  },
  {
    pageNum: 3,
    chapter: "Chapter 2 · Metaphase",
    text: "Metaphase lines the chromosomes up along the metaphase plate at the centre of the cell. Spindle fibres from opposite poles attach to each sister chromatid at the kinetochore of its centromere.",
    scene: "Chromosomes aligned",
    emotion: "tension",
    camera: "Overhead top-down",
    animationPrompt:
      "Top-down microscopy view of chromosomes aligning along a glowing equatorial plane. Spindle fibres stretch from the poles like piano strings. Painterly."
  },
  {
    pageNum: 4,
    chapter: "Chapter 2 · Anaphase",
    text: "Anaphase pulls the sister chromatids apart. Each chromatid is now considered its own chromosome. They move toward opposite poles along the shortening spindle fibres.",
    scene: "Chromatids separating",
    emotion: "release",
    camera: "Side view slow pan",
    animationPrompt:
      "Side-view microscopy pan as chromatids separate and slide along spindle fibres toward the poles. Painterly mysticism."
  },
  {
    pageNum: 5,
    chapter: "Chapter 3 · Telophase & Cytokinesis",
    text: "In telophase a new nuclear envelope forms around each set of chromosomes at opposite poles. Cytokinesis then divides the cytoplasm, producing two genetically identical daughter cells.",
    scene: "Two daughter cells",
    emotion: "completion",
    camera: "Wide microscope pullback",
    animationPrompt:
      "Microscopy pullback as two daughter cells separate, each with its own nucleus glowing. Painterly realism."
  }
];

async function main() {
  console.log("[edu-seed] starting");

  const book = await prisma.book.upsert({
    where: { slug: "mitosis-a-living-cell-divides" },
    update: {
      title: "Mitosis · A Living Cell Divides",
      author: "AnimBook EDU",
      synopsis:
        "An EDU AnimBook that animates the five phases of mitosis. Built for the EDU Reader's comprehension checkpoint overlay, the Kenya CBC Grade 9 Biology strand, and the misconception-targeted remediation flow.",
      vertical: "EDU",
      language: "en",
      genreTags: ["Biology", "Cell Science"],
      moodTags: ["calm", "scientific"],
      ageRating: "14+",
      coverUrl: "https://placehold.co/600x900/0D1B2E/1A6B3C/png?text=Mitosis",
      status: "PUBLISHED",
      totalPages: pages.length,
      requiresExpertReview: true,
      expertReviewStatus: "APPROVED"
    },
    create: {
      slug: "mitosis-a-living-cell-divides",
      title: "Mitosis · A Living Cell Divides",
      author: "AnimBook EDU",
      synopsis:
        "An EDU AnimBook that animates the five phases of mitosis. Built for the EDU Reader's comprehension checkpoint overlay, the Kenya CBC Grade 9 Biology strand, and the misconception-targeted remediation flow.",
      vertical: "EDU",
      language: "en",
      genreTags: ["Biology", "Cell Science"],
      moodTags: ["calm", "scientific"],
      ageRating: "14+",
      coverUrl: "https://placehold.co/600x900/0D1B2E/1A6B3C/png?text=Mitosis",
      status: "PUBLISHED",
      totalPages: pages.length,
      requiresExpertReview: true,
      expertReviewStatus: "APPROVED"
    }
  });

  await prisma.page.deleteMany({ where: { bookId: book.id } });
  await prisma.page.createMany({
    data: pages.map((p) => ({
      bookId: book.id,
      pageNum: p.pageNum,
      chapter: p.chapter,
      textExcerpt: p.text,
      sourceTextSha256: `mitosis-${p.pageNum}`,
      animationPrompt: p.animationPrompt,
      negativePrompt: "blurry, distorted cells, watermarks",
      sceneType: p.scene,
      emotionalRegister: p.emotion,
      cameraAngle: p.camera,
      status: "APPROVED" as const,
      videoUrl: `https://placehold.co/640x360/080C14/1A6B3C/png?text=Mitosis+${p.pageNum}`,
      posterUrl: `https://placehold.co/640x360/080C14/1A6B3C/png?text=Mitosis+${p.pageNum}`,
      qualityScore: 0.9
    }))
  });

  await prisma.bookBrain.upsert({
    where: { bookId: book.id },
    update: {},
    create: {
      bookId: book.id,
      genre: ["Biology", "Cell Science"],
      culturalOrigin: "Kenya CBC Grade 9",
      targetAudience: "Grade 9",
      styleSelected: "Scientific Microscopy",
      rawJson: {
        title: "Mitosis · A Living Cell Divides",
        framework: "KENYA_CBC",
        strand: "Biology",
        grade: "9",
        standards: ["KENYA_CBC:BIOLOGY.9.MITOSIS", "NGSS:HS-LS1-4", "COMMON_CORE:CCSS.ELA.9-10.RST.3"],
        characters: [],
        settings: ["Eukaryotic cell at interphase", "Cell entering prophase", "Metaphase plate", "Anaphase separation", "Telophase cytokinesis"],
        page_manifest: pages.map((p) => ({
          page_num: p.pageNum,
          text_excerpt: p.text,
          setting: p.chapter,
          primary_action: p.scene,
          emotion: p.emotion,
          camera_angle: p.camera,
          animation_prompt_draft: p.animationPrompt
        }))
      }
    }
  });

  console.log(`[edu-seed] mitosis-a-living-cell-divides -> ${pages.length} pages`);
  console.log("[edu-seed] done");
}

main()
  .catch((err) => {
    console.error("[edu-seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });