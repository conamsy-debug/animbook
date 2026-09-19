/**
 * Find candidates for the live split-pipeline smoke.
 *
 * A good candidate is:
 *   - small (≤ 15 pages; the smoke only has to prove the contract, not
 *     actually animate a long book)
 *   - PUBLISHED (the user's Runway credits are at 0 anyway, so the
 *     smoke can't drive new pipeline work end-to-end. A published book
 *     already has a full backfilled still/clip/audio state.)
 *   - splitPipeline=false (we'll flip it)
 *   - non-ORIGINALS so we don't expose private/paid content; VERSE or
 *     SHORT_DOCS works best.
 */
import { prisma } from "../dist/db.js";

async function main() {
  const books = await prisma.book.findMany({
    where: { status: "PUBLISHED", splitPipeline: false },
    select: {
      id: true,
      slug: true,
      title: true,
      author: true,
      vertical: true,
      totalPages: true,
      _count: { select: { pages: true } }
    },
    orderBy: [{ totalPages: "asc" }],
    take: 10
  });

  console.log("Candidates (PUBLISHED, splitPipeline=false, smallest first):");
  console.log("");
  for (const b of books) {
    console.log(`  ${b.totalPages.toString().padStart(3)}p  ${b.vertical.padEnd(8)}  ${b.title}`);
    console.log(`        slug: ${b.slug}`);
    console.log(`        author: ${b.author}`);
    console.log(`        bookId: ${b.id}`);
    console.log("");
  }

  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
