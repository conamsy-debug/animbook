/**
 * Smoke the public API payload after splitPipeline=true was flipped.
 *
 * Public routes only — confirms the live deployment surfaces the new
 * schema (splitPipeline + stillStatus/clipStatus/audioStatus/motionTier)
 * so the Studio UI renders the SplitReview panel + the animation
 * controls without a database migration missing.
 */
const slug = "lagos-nights-2-the-lagoon";
const base = "https://api.animbook.com";

// Book detail
const book = await fetch(`${base}/api/books/${slug}`).then((r) => r.json());
const splitFlag = book.splitPipeline;
const vertical = book.vertical;
console.log(`Book: ${book.title}`);
console.log(`  splitPipeline: ${splitFlag}`);
console.log(`  vertical: ${vertical}`);
console.log(`  totalPages: ${book.totalPages}`);
console.log("");

// All pages
const pagesResp = await fetch(`${base}/api/books/${encodeURIComponent(slug)}/pages`).then((r) => r.json());
const pages = pagesResp.pages ?? [];
console.log(`GET /pages returned ${pages.length} pages.`);
console.log("New per-page fields present on each page:");
const newFields = ["stillStatus", "clipStatus", "audioStatus", "motionTier", "stillVersion"];
for (const p of pages) {
  const present = newFields.filter((f) => f in p);
  console.log(`  page ${p.pageNum}: ${present.join(", ") || "(none)"}`);
  console.log(`    stillStatus=${p.stillStatus}  clipStatus=${p.clipStatus}  audioStatus=${p.audioStatus}  motionTier=${p.motionTier}  stillVersion=${p.stillVersion}`);
}
console.log("");

// Single-page direct (most likely path used by the Studio)
if (pages.length) {
  const first = pages[0];
  const single = await fetch(`${base}/api/books/${encodeURIComponent(slug)}/pages/${first.pageNum}`).then((r) => r.json());
  console.log(`GET /pages/${first.pageNum} returns page fields:`);
  console.log(`  splitPipeline flag: ${book.splitPipeline}`);
  console.log(`  page keys: ${Object.keys(single.page ?? {}).sort().join(", ")}`);
}
