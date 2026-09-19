// One-shot: tally page statuses for the Practical Physical Immortality book.
// Run via:  railway run -- node scripts/page-status-group.mjs
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const bookId = process.argv[2] ?? "cmu5mod660003pb1553fnqaur";
const ps = await prisma.page.groupBy({
  by: ["status"],
  where: { bookId },
  _count: { _all: true }
});
console.log(JSON.stringify(ps, null, 2));
await prisma.$disconnect();
