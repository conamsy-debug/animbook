/**
 * Phase 6 seed: AnimBook DREAM + AnimBook STUDIO PRO.
 *
 * - Mints a CompanionLink for every PUBLISHED book (deterministic marker
 *   hash + NFC tag id derived from the book id).
 * - Opens a fresh DREAM session for the demo user on the WELLNESS book
 *   (the-sleeping-coast) so the dashboard has something to show.
 * - Logs a single companion session against the consumer flagship
 *   (the-night-train) so analytics has a non-empty row.
 */
import { PrismaClient } from "@prisma/client";
import { ensureCompanionLink, logCompanionSession } from "../src/services/studioPro.js";

const prisma = new PrismaClient();

async function main() {
  console.log("[phase6-seed] starting");

  const published = await prisma.book.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, slug: true, title: true, vertical: true, status: true }
  });

  console.log(`[phase6-seed] minting companion links for ${published.length} published books`);

  for (const book of published) {
    const experienceMode = book.vertical === "WELLNESS" ? "AR_AND_NFC" : book.vertical === "KIDS" ? "AR_OVERLAY" : "AR_AND_NFC";
    const link = await ensureCompanionLink(book.id, {
      experienceMode,
      anchorPage: 1,
      title: book.title,
      companionLabel: `Point your camera at any AnimBook cover.`
    });
    console.log(`  · ${book.slug} → marker=${link.markerHash.slice(0, 12)}… nfc=${link.nfcTagId}`);
  }

  // Open a dream session for the wellness book.
  const wellness = await prisma.book.findUnique({ where: { slug: "the-sleeping-coast" } });
  if (wellness) {
    const demoUser = await prisma.user.findUnique({ where: { email: "demo@animbook.com" } });
    if (demoUser) {
      const open = await prisma.dreamSession.findFirst({
        where: { userId: demoUser.id, bookId: wellness.id, endedAt: null }
      });
      if (!open) {
        const session = await prisma.dreamSession.create({
          data: {
            userId: demoUser.id,
            bookId: wellness.id,
            ambientTrack: "ocean_waves",
            pagesRead: 2
          }
        });
        console.log(`[phase6-seed] dream session opened: ${session.id} (pages=2)`);
      }
    }
  }

  // Log a sample companion session.
  const flagship = await prisma.book.findUnique({ where: { slug: "the-night-train" } });
  const demoUser = await prisma.user.findUnique({ where: { email: "demo@animbook.com" } });
  if (flagship && demoUser) {
    const link = await prisma.companionLink.findFirst({ where: { bookId: flagship.id } });
    if (link) {
      const session = await logCompanionSession(link.id, demoUser.id, "AR_OVERLAY", 2);
      console.log(`[phase6-seed] companion session opened: ${session.id} (mode=AR_OVERLAY)`);
    }
  }

  console.log("[phase6-seed] done");
}

main()
  .catch((err) => {
    console.error("[phase6-seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
