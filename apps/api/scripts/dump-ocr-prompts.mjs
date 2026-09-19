// Dump current animationPrompt + textExcerpt for the OCR-garbage pages on
// Practical Physical Immortality so we can see what the brain wrote.
// Run via:  railway run -- node scripts/dump-ocr-prompts.mjs
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const bookId = process.argv[2] ?? "cmu5mod660003pb1553fnqaur";
const targetPages = [49, 50, 51, 52, 54, 55, 56];
const pages = await prisma.page.findMany({
  where: { bookId, pageNum: { in: targetPages } },
  select: { pageNum: true, animationPrompt: true, textExcerpt: true, status: true },
  orderBy: { pageNum: "asc" }
});
for (const p of pages) {
  console.log(`\n========== page ${p.pageNum} (${p.status}) ==========`);
  console.log("textExcerpt:", p.textExcerpt?.slice(0, 240));
  console.log("animationPrompt:", p.animationPrompt?.slice(0, 240));
  console.log("...");
}
await prisma.$disconnect();
