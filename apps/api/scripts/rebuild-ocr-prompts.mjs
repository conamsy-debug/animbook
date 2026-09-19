// Rebuild the Book Brain + animation prompts for Practical Physical Immortality.
// The OCR-garbage cluster (pages 49-52, 54-56) flagged because Claude analyzed
// a dirty manuscript. Procedure:
//   1) Read all pages of the book.
//   2) Clean OCR garbage out of every textExcerpt (cleanOcrGarbage helps
//      even non-49 pages — defensive).
//   3) Re-run the Book Brain via Anthropic on the cleaned manuscript.
//   4) Persist the new brain.
//   5) Propagate brain.page_manifest → pages.animationPrompt via buildPrompts.
//   6) Reset the 7 OCR cluster pages to REGENERATING, enqueue pipeline
//      for them, leave the running batch alone.
// Run via:  railway run -- node scripts/rebuild-ocr-prompts.mjs
import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const projectId = process.argv[2] ?? "cmu5modam0005pb15hnka8rj7";
const OCR_PAGES = [49, 50, 51, 52, 54, 55, 56];

// These are imported by tsx from the source TypeScript modules.
const { cleanOcrGarbage } = await import("../src/services/manuscriptExtract.js");
const { generateBookBrain } = await import("../src/services/bookBrain.js");

const prisma = new PrismaClient();
const conn = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
const queue = new Queue("animbook-pipeline", { connection: conn });

const project = await prisma.studioProject.findUnique({
  where: { id: projectId },
  select: { id: true, bookId: true, vertical: true, name: true, book: { select: { title: true, author: true } } }
});
if (!project?.bookId) { console.error("no project/book"); process.exit(1); }
console.log("project:", project.name, "— bookId:", project.bookId);

// 1+2) Clean OCR garbage out of every page's textExcerpt.
const allPages = await prisma.page.findMany({
  where: { bookId: project.bookId },
  select: { id: true, pageNum: true, textExcerpt: true, chapter: true },
  orderBy: { pageNum: "asc" }
});
let cleanedPages = 0;
for (const p of allPages) {
  if (!p.textExcerpt) continue;
  const cleaned = cleanOcrGarbage(p.textExcerpt);
  if (cleaned !== p.textExcerpt) {
    await prisma.page.update({ where: { id: p.id }, data: { textExcerpt: cleaned } });
    cleanedPages++;
  }
}
console.log("cleaned OCR garbage out of", cleanedPages, "page text excerpts");

// Refresh pages after cleaning.
const refreshed = await prisma.page.findMany({
  where: { bookId: project.bookId },
  select: { id: true, pageNum: true, textExcerpt: true, chapter: true },
  orderBy: { pageNum: "asc" }
});

const manuscript = {
  sourceFilename: "practical-physical-immortality.txt",
  sha256: "",
  pages: refreshed.map((p) => ({ pageNum: p.pageNum, chapter: p.chapter ?? null, text: p.textExcerpt }))
};

// 3+4) Run the Book Brain on the cleaned manuscript.
console.log("calling Anthropic to rebuild Book Brain on", manuscript.pages.length, "cleaned pages…");
const { brain, source } = await generateBookBrain({
  title: project.book?.title ?? project.name,
  author: project.book?.author,
  vertical: project.vertical,
  manuscript
});
console.log("brain source:", source);

await prisma.bookBrain.upsert({
  where: { bookId: project.bookId },
  create: {
    bookId: project.bookId,
    genre: brain.genre,
    culturalOrigin: brain.cultural_origin,
    targetAudience: brain.target_audience,
    styleSelected: brain.style_recommendation,
    rawJson: brain
  },
  update: {
    genre: brain.genre,
    culturalOrigin: brain.cultural_origin,
    targetAudience: brain.target_audience,
    styleSelected: brain.style_recommendation,
    rawJson: brain
  }
});
console.log("brain persisted");

// 5) Propagate brain.page_manifest → pages.animationPrompt + sceneType etc.
await prisma.page.updateMany({ where: { bookId: project.bookId }, data: { status: "PENDING" } });
let propagated = 0;
for (const m of brain.page_manifest) {
  const found = await prisma.page.findUnique({
    where: { bookId_pageNum: { bookId: project.bookId, pageNum: m.page_num } },
    select: { id: true }
  });
  if (!found) continue;
  await prisma.page.update({
    where: { id: found.id },
    data: {
      animationPrompt: m.animation_prompt_draft,
      negativePrompt: "blurry, low quality, distorted faces",
      sceneType: m.primary_action,
      emotionalRegister: m.emotion,
      cameraAngle: m.camera_angle
    }
  });
  propagated++;
}
console.log("propagated prompts to", propagated, "pages");

// 6) Reset just the OCR cluster to REGENERATING and re-enqueue them.
const ocr = await prisma.page.findMany({
  where: { bookId: project.bookId, pageNum: { in: OCR_PAGES } },
  select: { id: true, pageNum: true },
  orderBy: { pageNum: "asc" }
});
console.log("OCR cluster pages:", ocr.map((p) => p.pageNum).join(","));

await prisma.page.updateMany({
  where: { id: { in: ocr.map((p) => p.id) } },
  data: { status: "REGENERATING", regenerationCount: { increment: 1 } }
});

let queued = 0;
for (const p of ocr) {
  const job = await queue.add(
    "pipeline",
    { projectId: project.id, triggerStage: "VIDEO_GENERATION", pageId: p.id },
    { removeOnComplete: 50, removeOnFail: 50, attempts: 1 }
  );
  if (job.id) queued++;
}
console.log("queued OCR cluster pages:", queued);

await prisma.$disconnect();
await queue.close();
await conn.quit();
