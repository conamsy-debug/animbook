/**
 * Verify the split-pipeline migration backfilled correctly on production.
 *
 * Read-only probe — totals only. Run with:
 *   railway run -- node apps/api/scripts/verify-split-backfill.mjs
 */
import { prisma } from "../dist/db.js";

async function main() {
  const byStill = await prisma.page.groupBy({
    by: ["stillStatus"],
    _count: { _all: true }
  });
  const byClip = await prisma.page.groupBy({
    by: ["clipStatus"],
    _count: { _all: true }
  });
  const byAudio = await prisma.page.groupBy({
    by: ["audioStatus"],
    _count: { _all: true }
  });
  const byMotion = await prisma.page.groupBy({
    by: ["motionTier"],
    _count: { _all: true }
  });
  const splitBooks = await prisma.book.count({ where: { splitPipeline: true } });
  const stillVersionZero = await prisma.page.count({ where: { stillVersion: 0 } });
  const total = await prisma.page.count();

  console.log(JSON.stringify({
    total,
    splitBooksOptedIn: splitBooks,
    stillVersionZero,
    byStillStatus: byStill.map((r) => ({ status: r.stillStatus, count: r._count._all })),
    byClipStatus: byClip.map((r) => ({ status: r.clipStatus, count: r._count._all })),
    byAudioStatus: byAudio.map((r) => ({ status: r.audioStatus, count: r._count._all })),
    byMotionTier: byMotion.map((r) => ({ tier: r.motionTier, count: r._count._all }))
  }, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});