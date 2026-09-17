/**
 * Archive leftover test books so they disappear from the library.
 *
 *   npx tsx apps/api/scripts/archive-test-books.ts [--dry-run]
 *
 * Matches the smoke-test slugs (smoke-…, stage-title-…, test-…). Nothing is
 * deleted — the rows stay, with status ARCHIVED.
 */
import "./slow-link-db.js";
import { prisma } from "../src/db.js";

const PATTERNS = [/^smoke-/, /^stage-title-/, /^test-/, /^demo-book-/];
const dry = process.argv.includes("--dry-run");

const books = await prisma.book.findMany({
  where: { status: "PUBLISHED" },
  select: { id: true, slug: true, title: true }
});
const targets = books.filter((b) => PATTERNS.some((re) => re.test(b.slug)));
for (const book of targets) console.log(`  ${dry ? "would archive" : "archived"} ${book.slug} — ${book.title}`);
if (!dry && targets.length) {
  await prisma.book.updateMany({ where: { id: { in: targets.map((b) => b.id) } }, data: { status: "ARCHIVED" } });
}
console.log(`\n${dry ? "Would archive" : "Archived"} ${targets.length} test book${targets.length === 1 ? "" : "s"}.`);
await prisma.$disconnect();
