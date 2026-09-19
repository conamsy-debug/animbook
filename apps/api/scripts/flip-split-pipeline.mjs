/**
 * Flip Book.splitPipeline=true on a single test book.
 *
 * Use case: demo / smoke for the split stills-from-animation pipeline.
 * Run with: `npx railway run -- node apps/api/scripts/flip-split-pipeline.mjs <bookId>`
 */
import { prisma } from "../dist/db.js";

const targetId = process.argv[2];
if (!targetId) {
  console.error("Usage: node flip-split-pipeline.mjs <bookId>");
  process.exit(1);
}

async function main() {
  const before = await prisma.book.findUnique({
    where: { id: targetId },
    select: { id: true, title: true, slug: true, splitPipeline: true, vertical: true, totalPages: true }
  });
  if (!before) {
    console.error(`No book with id ${targetId}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log("Before:");
  console.log(JSON.stringify(before, null, 2));

  if (before.splitPipeline) {
    console.log("\nAlready splitPipeline=true — leaving as-is.");
  } else {
    const after = await prisma.book.update({
      where: { id: targetId },
      data: { splitPipeline: true },
      select: { id: true, title: true, slug: true, splitPipeline: true, vertical: true, totalPages: true }
    });
    console.log("\nAfter:");
    console.log(JSON.stringify(after, null, 2));
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
