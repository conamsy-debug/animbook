/**
 * ROLLBACK for the one-time media optimiser.
 *
 * `optimize-existing-media.mjs` writes a manifest recording, for every
 * asset it touched, the ORIGINAL url/key and the OPTIMISED url/key. This
 * script reads that manifest and points the database back at the
 * originals. The optimised objects are left in the bucket (they are
 * harmless — nothing references them once the URLs are restored) so the
 * rollback is instant and does not need to re-upload anything.
 *
 * Usage:
 *   node apps/api/scripts/rollback-optimized-media.mjs <book-slug>
 *   node apps/api/scripts/rollback-optimized-media.mjs <book-slug> --dry-run
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PrismaClient } from "@prisma/client";

function loadEnv(p) {
  const out = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

const env = { ...loadEnv(fileURLToPath(new URL("../.env", import.meta.url))) };
const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_DIR = join(HERE);

const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const slug = args.find((a) => !a.startsWith("--"));
if (!slug) {
  console.error("Usage: node apps/api/scripts/rollback-optimized-media.mjs [--dry-run] <book-slug>");
  process.exit(1);
}

const manifestPath = join(MANIFEST_DIR, `optimize-manifest-${slug}.json`);
if (!existsSync(manifestPath)) {
  console.error(`No manifest at ${manifestPath}. Nothing to roll back.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
console.log(`MANIFEST ${manifestPath}`);
console.log(`BOOK     ${manifest.bookTitle} (${manifest.bookSlug}) — optimised ${manifest.generatedAt}\n`);

let restored = 0;

if (manifest.cover) {
  console.log(`  cover      → ${manifest.cover.oldUrl}`);
  if (!dryRun) {
    await prisma.book.update({ where: { id: manifest.bookId }, data: { coverUrl: manifest.cover.oldUrl } });
  }
  restored++;
}

for (const e of manifest.pages) {
  const data = {};
  if (e.video) data.videoUrl = e.video.oldUrl;
  if (e.poster) data.posterUrl = e.poster.oldUrl;
  if (e.audio) data.audioUrl = e.audio.oldUrl;
  if (Object.keys(data).length === 0) continue;
  const bits = [];
  if (e.video) bits.push("video");
  if (e.poster) bits.push("poster");
  if (e.audio) bits.push("audio");
  console.log(`  page ${String(e.pageNum).padStart(2)}  ${bits.join(", ")} → originals`);
  if (!dryRun) {
    await prisma.page.update({ where: { id: e.pageId }, data });
  }
  restored++;
}

console.log(`\n${dryRun ? "DRY RUN — " : ""}restored ${restored} row(s) to the original URLs.`);
if (!dryRun) {
  console.log("The optimised objects are still in the bucket but nothing points at them any more.");
}
await prisma.$disconnect();