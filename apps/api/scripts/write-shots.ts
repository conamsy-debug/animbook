/**
 * Write the shot plan for a book — the Brain shot-writer step.
 *
 *   npx tsx apps/api/scripts/write-shots.ts <slug> [--dry-run] [--keep]
 *
 * This step ONLY writes the plan: the character bible, the narration beats,
 * and one shot per beat with its first-frame prompt and its motion prompt.
 * It never calls the video API and never spends a credit. The clips are
 * generated later, one shot at a time, by the pipeline.
 *
 * Flags:
 *   --dry-run  do not write anything to the database
 *   --keep     keep the shots that already exist instead of replacing the
 *              PLANNED ones
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Point at the DIRECT Neon endpoint before the Prisma client is created.
 *
 * The pooled endpoint is intermittently unreachable from a laptop, and this
 * script runs over a long-distance link. Prisma's 5s connect timeout is tuned
 * for a server next to the database, so it is lengthened too.
 */
function prepareDatabaseUrl(): void {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  let raw = process.env.DATABASE_URL;
  try {
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*#/.test(line) || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const key = line.slice(0, i).trim();
      if (key !== "DATABASE_URL") continue;
      let value = line.slice(i + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      raw = value;
      break;
    }
  } catch {
    /* fall back to the environment */
  }
  if (!raw) return;
  try {
    const url = new URL(raw.replace("-pooler.", "."));
    if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "30");
    if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "60");
    if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "5");
    process.env.DATABASE_URL = url.toString();
    console.log(`[shots] database host: ${url.host}`);
  } catch {
    /* unparseable - leave it for Prisma to report */
  }
}

prepareDatabaseUrl();

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const replace = !args.includes("--keep");

if (!slug) {
  console.error("usage: npx tsx apps/api/scripts/write-shots.ts <slug> [--dry-run] [--keep]");
  process.exit(2);
}

const { writeShotsForBook } = await import("../src/services/shotWriter.js");
const { prisma } = await import("../src/db.js");

try {
  const result = await writeShotsForBook(slug, { dryRun, replace });
  console.log(`\n=== ${result.bookSlug} ===`);
  console.log(`characters in the bible: ${result.characters.length}`);
  for (const c of result.characters) {
    console.log(`  - ${c.roleLabel}`);
    console.log(`      look:   ${c.look}`);
    if (c.motion) console.log(`      motion: ${c.motion}`);
  }
  console.log(`\nshots written: ${result.written}${dryRun ? " (dry run - nothing saved)" : ""}`);
  for (const p of result.pages) {
    console.log(
      `\npage ${p.pageNum}: ${p.shots} shot(s), narration ${(p.narrationMs / 1000).toFixed(2)}s` +
        (p.violations.length ? `  [${p.violations.length} rule issue(s) repaired]` : "")
    );
    for (const v of p.violations) console.log(`    ! ${v.rule}: ${v.detail}`);
  }

  if (!dryRun) {
    const rows = await prisma.shot.findMany({
      where: { page: { book: { slug } } },
      orderBy: [{ page: { pageNum: "asc" } }, { order: "asc" }],
      select: {
        order: true,
        narrationStartMs: true,
        narrationEndMs: true,
        narrationText: true,
        durationSeconds: true,
        shotPrompt: true,
        stillPrompt: true,
        charactersInFrame: true,
        status: true,
        page: { select: { pageNum: true } }
      }
    });
    console.log(`\n--- saved shots (${rows.length}) ---`);
    for (const r of rows) {
      console.log(
        `\n[p${r.page.pageNum} #${r.order}] ${(r.narrationStartMs / 1000).toFixed(2)}s -> ${(r.narrationEndMs / 1000).toFixed(2)}s ` +
          `(${r.durationSeconds}s clip, ${r.status})`
      );
      console.log(`  narration: ${r.narrationText}`);
      console.log(`  in frame: ${r.charactersInFrame.length ? r.charactersInFrame.join(", ") : "(nobody)"}`);
      console.log(`  shot:   ${r.shotPrompt}`);
      console.log(`  still:  ${r.stillPrompt}`);
    }
  }
} finally {
  await prisma.$disconnect();
}
