/**
 * One-off: file the seeded books under a shelf inside their vertical.
 *
 *   npx tsx apps/api/scripts/assign-subcategories.ts [--dry-run]
 *
 * Books added later choose their own shelf in the Studio.
 */
import "./slow-link-db.js";
import { prisma } from "../src/db.js";
import { isValidSubcategory } from "../src/config/subcategories.js";

const BY_SLUG: Record<string, string> = {
  "the-night-train": "literary-fiction",
  "the-last-bus-to-jinja": "literary-fiction",
  "the-third-floor": "shared-worlds",
  "the-tale-of-peter-rabbit": "folktales",
  "the-moon-that-lost-his-hat": "bedtime",
  "the-fish-who-loved-music": "picture-books",
  "mitosis-a-living-cell-divides": "science",
  "how-a-seed-becomes-a-tree": "science",
  "psalm-of-the-market": "christian",
  "vespers-at-the-window": "christian",
  "the-lords-prayer-illuminated": "christian",
  "how-to-change-a-tyre": "how-to-repair",
  "first-aid-for-the-road": "health-first-aid",
  "boil-an-egg-and-other-kitchen-basics": "cooking",
  "growing-tomatoes-on-a-balcony": "gardening",
  "the-six-minute-stretch": "fitness-movement",
  "a-poem-for-accra": "city-poems",
  "a-poem-for-lagos": "city-poems",
  "lagos-nights-prologue-the-bridge": "city-poems",
  "lagos-nights-1-the-last-train": "literary-fiction",
  "lagos-nights-2-the-lagoon": "city-journeys",
  "lagos-nights-3-the-letter": "city-poems",
  "a-rainy-afternoon-in-cape-town": "city-journeys",
  "the-coast-of-mombasa": "coast-islands",
  "tide-and-bell": "sleep-stories",
  "the-sleeping-coast": "sleep-stories",
  "a-walk-through-the-rain": "meditation",
  "morning-pages": "mental-wellbeing",
  "the-six-feedback-loops": "leadership",
  "the-first-90-days": "onboarding"
};

/** Fallback shelf per vertical for anything not named above. */
const DEFAULT_BY_VERTICAL: Record<string, string> = {
  CONSUMER: "literary-fiction",
  KIDS: "picture-books",
  EDU: "science",
  FAITH: "interfaith",
  DOCS: "how-to-repair",
  VERSE: "contemporary-poetry",
  COMICS: "all-ages",
  BUSINESS: "leadership",
  WELLNESS: "meditation",
  LAW: "rights-citizenship",
  TRAVEL: "city-journeys",
  ORIGINALS: "experimental"
};

const dry = process.argv.includes("--dry-run");

const books = await prisma.book.findMany({ select: { id: true, slug: true, title: true, vertical: true, subcategory: true } });
let changed = 0;
for (const book of books) {
  if (book.subcategory) continue;
  // A named shelf only applies if it belongs to this book's vertical.
  const named = BY_SLUG[book.slug];
  const want = named && isValidSubcategory(book.vertical, named) ? named : DEFAULT_BY_VERTICAL[book.vertical];
  if (!want || !isValidSubcategory(book.vertical, want)) {
    console.warn(`  ? ${book.slug}: no shelf for ${book.vertical}`);
    continue;
  }
  if (named && want !== named) console.log(`  (${book.slug}: "${named}" isn't a ${book.vertical} shelf — using "${want}")`);
  console.log(`  ${dry ? "would set" : "set"} ${book.slug.padEnd(40)} ${book.vertical} → ${want}`);
  if (!dry) await prisma.book.update({ where: { id: book.id }, data: { subcategory: want } });
  changed++;
}
console.log(`\n${dry ? "Would update" : "Updated"} ${changed} of ${books.length} books.`);
await prisma.$disconnect();
