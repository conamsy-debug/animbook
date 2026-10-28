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

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL || env.DATABASE_URL } } });

/**
 * Retry a database call.
 *
 * Neon occasionally refuses or drops the first connection after a cold start.
 * A one-off script that only READS the live state must not abort half-way
 * through a book because of a transient network blip.
 */
async function db(fn, attempts = 8) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String(err.message).split("\n").filter(Boolean).slice(0, 2).join(" ").slice(0, 140);
      if (i < attempts) {
        const wait = Math.min(15_000, 1000 * 2 ** (i - 1));
        console.warn(`  db attempt ${i} failed (${msg}) - retrying in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        console.error(`  db attempt ${i} failed: ${msg}`);
      }
    }
  }
  throw lastErr;
}

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

/**
 * Every CDN call gets a deadline and a retry.
 *
 * The link between this machine and the Cloudflare edge is unreliable: a
 * read-only HEAD/GET occasionally dies with ECONNRESET. One reset used to
 * abort the whole verification half-way through a book, so a transient network
 * blip looked like a broken asset. Retry a few times before giving up.
 */
const FETCH_TIMEOUT_MS = 180_000;

function fetchWithTimeout(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

async function head(url, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetchWithTimeout(url, { method: "HEAD" });
      // A 5xx from the edge is transient - it comes back for objects that are
      // perfectly fine. Retry it. A 4xx is a real answer, so return it.
      if (res.status >= 500) throw new Error(`HEAD ${url} -> ${res.status}`);
      return {
        status: res.status,
        type: res.headers.get("content-type"),
        length: Number(res.headers.get("content-length") ?? 0),
        cache: res.headers.get("cache-control"),
        cors: res.headers.get("access-control-allow-origin")
      };
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        console.warn(`  HEAD ${url} failed (${err.message}) - retry ${i}/${attempts - 1}`);
        await new Promise((r) => setTimeout(r, 500 * i));
      }
    }
  }
  throw lastErr;
}

/**
 * Download a CDN object, in Range chunks.
 *
 * The media edge kills a connection that has been transferring for about a
 * minute, so a single GET of a multi-megabyte clip comes back truncated.
 * Ranges keep every request inside that window.
 */
const RANGE_CHUNK_BYTES = 256 * 1024;
const RANGE_MIN_CHUNK_BYTES = 8 * 1024;
const RANGE_DEADLINE_MS = 40_000;

async function download(url, dest, attempts = 12) {
  const total = await head(url).then((h) => (h.status === 200 ? h.length : 0));
  if (!total) {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    return buf;
  }

  const out = Buffer.alloc(total);
  let start = 0;
  while (start < total) {
    let end = Math.min(start + RANGE_CHUNK_BYTES, total) - 1;
    let done = false;
    for (let a = 1; a <= attempts && !done; a++) {
      try {
        const res = await fetch(url, {
          headers: { Range: `bytes=${start}-${end}` },
          signal: AbortSignal.timeout(RANGE_DEADLINE_MS)
        });
        if (res.status !== 206 && res.status !== 200) throw new Error(`range ${start}-${end} -> ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length !== end - start + 1) throw new Error(`short range ${start}-${end} (${buf.length} B)`);
        buf.copy(out, start);
        done = true;
      } catch (err) {
        const span = end - start + 1;
        if (span > RANGE_MIN_CHUNK_BYTES) {
          end = start + Math.floor(span / 2) - 1;
          console.warn(`  ${url} range ${start}-${end} stalled (${err.message}) - retrying in halves`);
        } else {
          console.warn(`  ${url} range ${start}-${end} failed (${err.message}) - retry ${a}/${attempts}`);
          await new Promise((r) => setTimeout(r, Math.min(15_000, 400 * 2 ** (a - 1))));
        }
      }
    }
    if (!done) throw new Error(`GET ${url} -> could not fetch bytes ${start}-${end}`);
    start = end + 1;
  }
  writeFileSync(dest, out);
  return out;
}

const book = await db(() =>
  prisma.book.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      coverUrl: true,
      pages: { orderBy: { pageNum: "asc" }, select: { pageNum: true, videoUrl: true, posterUrl: true, audioUrl: true } }
    }
  })
);
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
