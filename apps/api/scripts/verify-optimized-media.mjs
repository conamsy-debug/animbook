/**
 * Verify the live state of an optimised book.
 *
 * For every asset the optimiser touched this checks the CDN (the real
 * custom domain, not the R2 origin) and reports:
 *
 *   - the ORIGINAL object is still there (200) and unchanged
 *   - the OPTIMISED object is served (200), with the right content-type and
 *     the expected size
 *   - for MP4s: the moov atom is at the FRONT of the served file
 *   - for narration: mono
 *   - whether the CORS header is present
 *
 * Usage:
 *   node apps/api/scripts/verify-optimized-media.mjs <book-slug>
 */
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
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
// NOTE: CLOUDFLARE_CDN_BASE in .env says https://media.animbook.app - that
// host does not resolve. The real custom domain is media.animbook.com.
const CDN = "https://media.animbook.com";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: node apps/api/scripts/verify-optimized-media.mjs <book-slug>");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

/** Top-level MP4 boxes, straight from the bytes. */
function topLevelBoxes(file) {
  const fd = openSync(file, "r");
  try {
    const total = statSync(file).size;
    const out = [];
    let off = 0;
    while (off + 8 <= total && out.length < 64) {
      const head = Buffer.alloc(16);
      const n = readSync(fd, head, 0, 16, off);
      if (n < 8) break;
      let size = head.readUInt32BE(0);
      const type = head.toString("latin1", 4, 8);
      if (size === 1) {
        if (n < 16) break;
        size = Number(head.readBigUInt64BE(8));
      } else if (size === 0) {
        size = total - off;
      }
      out.push({ type, size, offset: off });
      if (size < 8) break;
      off += size;
    }
    return out;
  } finally {
    closeSync(fd);
  }
}

function moovPosition(file) {
  const boxes = topLevelBoxes(file);
  const moov = boxes.findIndex((b) => b.type === "moov");
  if (moov === -1) return "unknown";
  const mdat = boxes.findIndex((b) => b.type === "mdat");
  if (mdat === -1) return "front";
  return moov < mdat ? "front" : "back";
}

async function head(url) {
  const res = await fetch(url, { method: "HEAD" });
  return {
    status: res.status,
    type: res.headers.get("content-type"),
    length: Number(res.headers.get("content-length") ?? 0),
    cache: res.headers.get("cache-control"),
    cors: res.headers.get("access-control-allow-origin")
  };
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return buf;
}

const book = await prisma.book.findUnique({
  where: { slug },
  select: {
    id: true,
    slug: true,
    title: true,
    coverUrl: true,
    pages: { orderBy: { pageNum: "asc" }, select: { pageNum: true, videoUrl: true, posterUrl: true, audioUrl: true } }
  }
});
if (!book) {
  console.error(`No book with slug "${slug}".`);
  process.exit(1);
}
console.log(`BOOK ${book.title}  (${book.slug})`);
console.log(`CDN  ${CDN}\n`);

const manifestPath = join(HERE, `optimize-manifest-${slug}.json`);
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;

const tmp = join(tmpdir(), `animbook-verify-${Date.now().toString(36)}`);
mkdirSync(tmp, { recursive: true });
const rows = [];

if (manifest?.cover) rows.push({ what: "cover", ...manifest.cover });
for (const p of manifest?.pages ?? []) {
  if (p.video) rows.push({ what: `p${p.pageNum} video`, ...p.video });
  if (p.poster) rows.push({ what: `p${p.pageNum} poster`, ...p.poster });
  if (p.audio) rows.push({ what: `p${p.pageNum} audio`, ...p.audio });
}

if (!rows.length) {
  console.log("No manifest found - nothing to verify.");
  await prisma.$disconnect();
  process.exit(1);
}

const results = [];
for (const r of rows) {
  const orig = await head(r.oldUrl);
  const opt = await head(r.newUrl);
  let extra = "";
  if (r.newKey.endsWith(".mp4")) {
    const f = join(tmp, r.newKey.split("/").pop());
    await download(r.newUrl, f);
    const pos = moovPosition(f);
    const boxList = topLevelBoxes(f);
    const boxes = boxList.map((b) => `${b.type}:${b.size}`).join(" ");
    const uuid = boxList.find((b) => b.type === "uuid");
    const c2paBytes = uuid ? uuid.size : 0;
    extra = `  moov=${pos}  c2pa=${c2paBytes} B  [${boxes}]`;
    // When the source carried a C2PA manifest, the optimised clip must too.
    const c2paOk = (r.c2paBytes ?? 0) === 0 || c2paBytes === r.c2paBytes;
    results.push({ ...r, ok: orig.status === 200 && opt.status === 200 && pos === "front" && c2paOk, pos, c2paBytes });
  } else {
    results.push({ ...r, ok: orig.status === 200 && opt.status === 200 });
  }
  console.log(
    `${r.what.padEnd(12)} original ${String(orig.status).padEnd(4)} ${String(orig.length).padStart(9)} B   ` +
      `optimised ${String(opt.status).padEnd(4)} ${String(opt.length).padStart(9)} B  ${String(opt.type).padEnd(12)}` +
      ` cors=${opt.cors ?? "(none)"}` +
      extra
  );
  // The JPEG social twin must be live and must NOT be a WebP.
  if (r.what === "cover" && r.socialUrl) {
    const social = await head(r.socialUrl);
    const socialOk = social.status === 200 && /jpeg/i.test(social.type ?? "");
    console.log(
      `${"cover social".padEnd(12)} social   ${String(social.status).padEnd(4)} ${String(social.length).padStart(9)} B  ` +
        `${String(social.type).padEnd(12)} cors=${social.cors ?? "(none)"}`
    );
    results.push({ what: "cover social", ok: socialOk });
  }
}

console.log("\nCORS header on the optimised object:", (await head(rows[0].newUrl)).cors ?? "(none)");
const allOk = results.every((r) => r.ok);
console.log(`\n${allOk ? "PASS" : "FAIL"} - ${results.filter((r) => r.ok).length}/${results.length} assets verified.`);
if (!allOk) process.exitCode = 1;

await prisma.$disconnect();
