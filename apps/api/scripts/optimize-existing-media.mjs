/**
 * ONE-TIME optimiser for EXISTING media.
 *
 * Re-encodes the already-published assets of a book so the reader stops
 * downloading megabytes of PNG and non-faststart MP4:
 *
 *   - MP4   -> remuxed with `-movflags +faststart` (streams COPIED, no
 *              re-encode, no quality loss) so the moov index is at the FRONT.
 *              The C2PA `uuid` box (Content Credentials / AI provenance) is
 *              re-injected afterwards, because ffmpeg's mp4 muxer drops it.
 *   - PNG/JPG -> WebP (q80) at the size the asset is displayed at.
 *   - MP3  -> mono 48 kbps.
 *
 * The cover additionally gets a JPEG "social twin" (`<name>.social.jpg`):
 * social platforms do not render WebP in a preview card.
 *
 * The originals are NEVER deleted or overwritten. Every optimised file is
 * written under a NEW key (`<name>.opt.<ext>`) and the database is
 * repointed at it. `rollback-optimized-media.mjs` restores the old URLs
 * using the manifest this script writes.
 *
 * RE-RUNNING IS SAFE. When the database already points at an optimised key,
 * the previous manifest is used to find the ORIGINAL object again, and the
 * asset is re-optimised from that original. That matters for the C2PA box:
 * the plain remux dropped it, so re-optimising the ALREADY-OPTIMISED clip
 * would optimise a clip that has no manifest to preserve. It also stops the
 * script from creating a `.opt.opt.<ext>` key.
 *
 * Usage:
 *   node apps/api/scripts/optimize-existing-media.mjs <book-slug-or-id>
 *   node apps/api/scripts/optimize-existing-media.mjs --dry-run <slug>
 *
 * Safety: it only touches the ONE book you name. It refuses to run
 * without an explicit target.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, openSync, readSync, closeSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { AwsClient } from "aws4fetch";

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
const CDN = "https://media.animbook.com";

const POSTER_MAX_WIDTH = 1280;
const COVER_MAX_WIDTH = 800;
const WEBP_QUALITY = 80;

/**
 * What the optimiser can actually work on.
 *
 * Two kinds of URL are NOT real media and must be skipped:
 *
 *  - placeholder art (placehold.co), which is a generated PNG standing in for
 *    a video frame or a cover that was never produced. It is not an R2 object
 *    key, and turning it into a temp filename produces an illegal path on
 *    Windows, which aborted the whole book.
 *  - inline `data:` / `blob:` URLs, which some scaffolded books carry instead
 *    of a stored object. There is nothing in the bucket to re-encode.
 */
const SKIPPABLE_RE = /placehold\.co|placeholder|dummy|^data:|^blob:/i;
const isSkippable = (url) => Boolean(url) && (SKIPPABLE_RE.test(url) || !/^https?:\/\//i.test(url));

/**
 * The database to use. Defaults to apps/api/.env, but an explicit
 * DATABASE_URL in the environment wins — that is how you point this at the
 * DIRECT (non-pooled) Neon endpoint when the pooler is flaky.
 */
const DB_URL = process.env.DATABASE_URL || env.DATABASE_URL;

/**
 * Every network call gets a deadline — a stalled CDN must not hang the run.
 *
 * The deadline is generous because this link can run at well under 5 KB/s: a
 * 2 MB cover legitimately needs minutes. A connection that is killed
 * mid-transfer still fails immediately, so the long deadline only bounds
 * genuinely stuck sockets - it does not slow down the common retry path.
 */
const FETCH_TIMEOUT_MS = 180_000;

function fetchWithTimeout(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

/**
 * Retry a database call.
 *
 * Neon (especially the pooled endpoint) occasionally refuses or drops the
 * first connection after a cold start. A one-off script that repoints
 * production rows must survive that, not abort half-way through.
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
        // The link to Neon goes down for a while at a time. Back off
        // exponentially (capped) and ride the outage out.
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

const r2 = new AwsClient({
  accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID,
  secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto"
});
const objectUrl = (key) =>
  `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.CLOUDFLARE_R2_BUCKET}/${key
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const target = args.find((a) => !a.startsWith("--"));
if (!target) {
  console.error("Usage: node apps/api/scripts/optimize-existing-media.mjs [--dry-run] <book-slug-or-id>");
  process.exit(1);
}

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

function ffprobeJson(url) {
  const r = spawnSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", url], {
    encoding: "utf8",
    maxBuffer: 32e6
  });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${(r.stderr || "").slice(0, 200)}`);
  return JSON.parse(r.stdout);
}

/**
 * Read the top-level MP4 box list straight from the file bytes.
 * This is the authoritative answer to "where is the moov atom" and does not
 * depend on ffmpeg's log format.
 */
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

/** Where does the moov atom sit? "front" | "back" | "unknown". */
function moovPosition(file) {
  const boxes = topLevelBoxes(file);
  const moov = boxes.findIndex((b) => b.type === "moov");
  if (moov === -1) return "unknown";
  const mdat = boxes.findIndex((b) => b.type === "mdat");
  if (mdat === -1) return "front";
  return moov < mdat ? "front" : "back";
}

/** Cross-check with ffprobe's own demuxer trace (independent implementation). */
function moovPositionViaFfprobe(file) {
  const r = spawnSync(FFPROBE, ["-v", "trace", "-i", file], { encoding: "utf8", maxBuffer: 32e6 });
  const text = `${r.stdout || ""}${r.stderr || ""}`;
  const mdat = text.search(/type:'mdat'/);
  const moov = text.search(/type:'moov'/);
  if (moov === -1) return "unknown";
  if (mdat === -1) return "front";
  return moov < mdat ? "front" : "back";
}

/* ------------------------------------------------------------------ *
 * C2PA (Content Credentials)
 *
 * AI-generated clips carry a JUMBF manifest in a top-level `uuid` box.
 * ffmpeg's mp4 muxer does not know that box, so a plain remux DROPS it —
 * which strips the AI-content provenance from the optimised clip. We pull
 * the box out of the source and splice it back into the remuxed file.
 * ------------------------------------------------------------------ */

/** The top-level `uuid` box of an MP4 buffer, or null. */
function extractUuidBox(mp4) {
  let off = 0;
  while (off + 8 <= mp4.length) {
    let size = mp4.readUInt32BE(off);
    const type = mp4.toString("latin1", off + 4, off + 8);
    if (size === 1) {
      if (off + 16 > mp4.length) break;
      size = Number(mp4.readBigUInt64BE(off + 8));
    } else if (size === 0) {
      size = mp4.length - off;
    }
    if (size < 8) break;
    if (type === "uuid") return mp4.subarray(off, off + size);
    off += size;
  }
  return null;
}

/**
 * Splice a top-level box into an MP4, right after the `ftyp` box.
 * Box sizes are self-contained, so inserting bytes does not invalidate any
 * other box, and `moov` still ends up before `mdat` (faststart holds).
 */
function injectBox(mp4, box) {
  let off = 0;
  let at = 0;
  while (off + 8 <= mp4.length) {
    let size = mp4.readUInt32BE(off);
    const type = mp4.toString("latin1", off + 4, off + 8);
    if (size === 1) {
      if (off + 16 > mp4.length) break;
      size = Number(mp4.readBigUInt64BE(off + 8));
    } else if (size === 0) {
      size = mp4.length - off;
    }
    if (size < 8) break;
    if (type === "ftyp") {
      at = off + size;
      break;
    }
    off += size;
  }
  return Buffer.concat([mp4.subarray(0, at), box, mp4.subarray(at)]);
}

/**
 * Run ffmpeg. `outputArgs` are the ENCODER options and must come AFTER
 * `-i <input>` -- ffmpeg treats anything before `-i` as an input option.
 */
function runFfmpeg(outputArgs, inputPath, outputPath) {
  const r = spawnSync(FFMPEG, ["-v", "error", "-y", "-i", inputPath, ...outputArgs, outputPath], {
    encoding: "utf8",
    maxBuffer: 32e6
  });
  return { ok: r.status === 0, stderr: (r.stderr || "").slice(0, 400) };
}

/**
 * Download a CDN object to a local path, in Range chunks.
 *
 * The media edge kills a connection that has been transferring for about a
 * minute: a single GET of a multi-megabyte file dies part-way through, at
 * whatever byte it had reached. Measured on this link, a 917 KB object came
 * back truncated at 60.008 s, while the very next range request pulled
 * 131 KB in 1.26 s.
 *
 * So the object is fetched as small ranges instead, each one its own
 * connection and each one comfortably inside that window. A range that stalls
 * is retried, and retried in halves, because a throttled connection gets
 * through far more often when it carries less data.
 */
const RANGE_CHUNK_BYTES = 256 * 1024;
const RANGE_MIN_CHUNK_BYTES = 8 * 1024;
/** Below the edge's ~60 s kill window, so a stall is detected by us first. */
const RANGE_DEADLINE_MS = 40_000;

async function fetchRange(url, start, end, deadlineMs) {
  const res = await fetch(url, {
    headers: { Range: `bytes=${start}-${end}` },
    signal: AbortSignal.timeout(deadlineMs)
  });
  if (res.status !== 206 && res.status !== 200) {
    throw new Error(`range ${start}-${end} -> ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== end - start + 1) {
    throw new Error(`short range ${start}-${end} (${buf.length} B)`);
  }
  return buf;
}

/**
 * The size of an object, via HEAD.
 *
 * The edge returns the occasional 5xx for a perfectly good object, so this
 * retries - without it one transient 500 loses the whole book.
 */
async function headContentLength(url, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetchWithTimeout(url, { method: "HEAD" });
      if (!res.ok) throw new Error(`HEAD ${url} -> ${res.status}`);
      return Number(res.headers.get("content-length") ?? 0);
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

async function download(url, dest, attempts = 12) {
  const total = await headContentLength(url);
  if (!total) {
    // No content-length to range over - fall back to a plain GET.
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error(`GET ${url} -> empty body`);
    writeFileSync(dest, buf);
    return buf.length;
  }

  const out = Buffer.alloc(total);
  let start = 0;
  while (start < total) {
    let end = Math.min(start + RANGE_CHUNK_BYTES, total) - 1;
    let done = false;
    for (let a = 1; a <= attempts && !done; a++) {
      try {
        const buf = await fetchRange(url, start, end, RANGE_DEADLINE_MS);
        buf.copy(out, start);
        done = true;
      } catch (err) {
        const span = end - start + 1;
        if (span > RANGE_MIN_CHUNK_BYTES) {
          // Halve the range: a throttled connection usually gets through with
          // less data on it.
          end = start + Math.floor(span / 2) - 1;
          console.warn(`  ${url} range ${start}-${end} stalled (${err.message}) - retrying in halves`);
        } else {
          console.warn(`  ${url} range ${start}-${end} failed (${err.message}) - retry ${a}/${attempts}`);
          // The link goes through patches where every connection dies. Back off
          // exponentially (capped) so a patch that clears in a minute is ridden
          // out instead of failing the asset.
          await new Promise((r) => setTimeout(r, Math.min(15_000, 400 * 2 ** (a - 1))));
        }
      }
    }
    if (!done) throw new Error(`GET ${url} -> could not fetch bytes ${start}-${end}`);
    start = end + 1;
  }
  writeFileSync(dest, out);
  return out.length;
}

async function upload(key, body, contentType, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await r2.fetch(objectUrl(key), {
        method: "PUT",
        headers: { "Content-Type": contentType, "Content-Length": String(body.byteLength) },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(180_000)
      });
      if (!res.ok) throw new Error(`PUT ${key} -> ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
      return `${CDN}/${key}`;
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        console.warn(`  upload ${key} failed (${err.message}) - retry ${i}/${attempts - 1}`);
        await new Promise((r) => setTimeout(r, 500 * i));
      }
    }
  }
  throw lastErr;
}

/** Confirm the object really landed and is served with the right type + size. */
async function headCdn(key, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetchWithTimeout(`${CDN}/${key}`, { method: "HEAD" });
      return {
        ok: res.ok,
        status: res.status,
        type: res.headers.get("content-type"),
        length: Number(res.headers.get("content-length") ?? 0)
      };
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        console.warn(`  HEAD ${key} failed (${err.message}) - retry ${i}/${attempts - 1}`);
        await new Promise((r) => setTimeout(r, 500 * i));
      }
    }
  }
  throw lastErr;
}

/** Does an object exist on the CDN? */
async function cdnExists(key) {
  try {
    const res = await fetchWithTimeout(`${CDN}/${key}`, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Resolve back to the ORIGINAL object
 *
 * The database may already point at an optimised key. Optimising THAT
 * again would (a) create a `.opt.opt.<ext>` key and (b) work on a clip
 * whose C2PA box was already dropped. The previous manifest maps the
 * optimised URL back to the original; when it is missing we probe the CDN
 * for the original extension next to the stem.
 * ------------------------------------------------------------------ */

let prevManifest = null;

function manifestEntries(m) {
  const out = [];
  if (m?.cover) out.push(m.cover);
  for (const p of m?.pages ?? []) {
    for (const kind of ["video", "audio", "poster"]) if (p[kind]) out.push(p[kind]);
  }
  return out;
}

/**
 * The original (url, key) behind a media URL that may already be optimised.
 * Returns null when the original cannot be determined.
 */
async function originalOf(url) {
  if (!url) return null;
  if (isSkippable(url)) {
    console.warn(`  skipped (not a real media object): ${url.slice(0, 90)}`);
    return null;
  }
  const key = url.replace(`${CDN}/`, "");
  if (!/\.opt\.[a-z0-9]+$/i.test(key)) return { url, key };

  const hit = manifestEntries(prevManifest).find(
    (e) => e.newKey === key || e.newUrl === url
  );
  if (hit?.oldUrl) return { url: hit.oldUrl, key: hit.oldKey };

  // No manifest entry — probe for the original next to the stem.
  const stem = key.replace(/\.opt\.[a-z0-9]+$/i, "");
  for (const ext of ["png", "jpg", "jpeg", "mp4", "mp3", "webp"]) {
    if (await cdnExists(`${stem}.${ext}`)) return { url: `${CDN}/${stem}.${ext}`, key: `${stem}.${ext}` };
  }
  console.warn(`  no original found for ${key} — leaving it alone`);
  return null;
}

/* ------------------------------------------------------------------ */

const book = await db(() =>
  prisma.book.findFirst({
    where: { OR: [{ id: target }, { slug: target }] },
    select: { id: true, slug: true, title: true, coverUrl: true }
  })
);
if (!book) {
  console.error(`No book matches "${target}".`);
  process.exit(1);
}
console.log(`BOOK  ${book.title}  (${book.slug})  id=${book.id}`);

const manifestPath = join(HERE, `optimize-manifest-${book.slug}.json`);
if (existsSync(manifestPath)) {
  try {
    prevManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    console.log(`PREV  previous manifest found (${prevManifest.generatedAt}) - re-optimising from the ORIGINALS`);
  } catch {
    console.warn("PREV  previous manifest is unreadable - continuing");
  }
}

const pages = await db(() =>
  prisma.page.findMany({
    where: { bookId: book.id },
    orderBy: { pageNum: "asc" },
    select: { id: true, pageNum: true, videoUrl: true, audioUrl: true, posterUrl: true, vttUrl: true }
  })
);
console.log(`PAGES ${pages.length}\n`);

const manifest = {
  generatedAt: new Date().toISOString(),
  bookId: book.id,
  bookSlug: book.slug,
  bookTitle: book.title,
  cover: null,
  pages: []
};

const tmp = join(process.env.TEMP || process.env.TMPDIR || "C:\\Temp", `animbook-opt-${Date.now().toString(36)}`);
mkdirSync(tmp, { recursive: true });

/* ---- cover ---- */
if (book.coverUrl) {
  const orig = await originalOf(book.coverUrl);
  if (!orig) {
    console.log("cover  skipped - original could not be resolved");
  } else {
    const key = orig.key;
    const ext = key.split(".").pop()?.toLowerCase() ?? "png";
    const src = join(tmp, `cover.${ext}`);
    await download(orig.url, src);
    const before = readFileSync(src).length;
    const out = join(tmp, "cover.webp");
    const r = runFfmpeg(
      [
        "-vf", `scale='min(${COVER_MAX_WIDTH},iw)':-2:flags=lanczos`,
        "-c:v", "libwebp",
        "-quality", String(WEBP_QUALITY),
        "-compression_level", "6",
        "-f", "webp"
      ],
      src,
      out
    );
    if (r.ok) {
      const body = readFileSync(out);
      const newKey = key.replace(/\.[^.]+$/, "") + ".opt.webp";
      if (!dryRun) {
        await upload(newKey, body, "image/webp");
        const h = await headCdn(newKey);
        if (!h.ok || h.length !== body.length) {
          throw new Error(`cover upload verification failed for ${newKey}: ${JSON.stringify(h)}`);
        }
      }
      console.log(`cover  ${before.toLocaleString()} B -> ${body.length.toLocaleString()} B  ${key} -> ${newKey}`);

      /* ---- cover social twin (JPEG) ---- */
      const socialKey = key.replace(/\.[^.]+$/, "") + ".social.jpg";
      const socialOut = join(tmp, "cover.social.jpg");
      const rs = runFfmpeg(
        [
          "-vf", `scale='min(${COVER_MAX_WIDTH},iw)':-2:flags=lanczos`,
          "-c:v", "mjpeg",
          "-q:v", "3",
          "-f", "mjpeg"
        ],
        src,
        socialOut
      );
      let social = null;
      if (rs.ok) {
        const socialBody = readFileSync(socialOut);
        if (!dryRun) {
          await upload(socialKey, socialBody, "image/jpeg");
          const hs = await headCdn(socialKey);
          if (!hs.ok || hs.length !== socialBody.length) {
            throw new Error(`social upload verification failed for ${socialKey}: ${JSON.stringify(hs)}`);
          }
        }
        console.log(`cover  social twin ${socialKey}  ${socialBody.length.toLocaleString()} B`);
        social = { socialKey, socialUrl: `${CDN}/${socialKey}`, bytesAfter: socialBody.length };
      } else {
        console.log(`cover  social twin FAILED: ${rs.stderr}`);
      }

      manifest.cover = {
        oldUrl: orig.url,
        newUrl: `${CDN}/${newKey}`,
        oldKey: key,
        newKey,
        bytesBefore: before,
        bytesAfter: body.length,
        socialKey: social?.socialKey ?? null,
        socialUrl: social?.socialUrl ?? null
      };
    } else {
      console.log(`cover  FAILED: ${r.stderr}`);
    }
  }
}

/* ---- pages ---- */
for (const p of pages) {
  const entry = { pageId: p.id, pageNum: p.pageNum, video: null, audio: null, poster: null };

  /* ---- poster -> WebP ---- */
  if (p.posterUrl) {
    const orig = await originalOf(p.posterUrl);
    if (!orig) {
      console.log(`p${p.pageNum} poster  skipped - original could not be resolved`);
    } else {
      const key = orig.key;
      const ext = key.split(".").pop()?.toLowerCase() ?? "png";
      const src = join(tmp, `p${p.pageNum}.${ext}`);
      await download(orig.url, src);
      const before = readFileSync(src).length;
      const out = join(tmp, `p${p.pageNum}.webp`);
      const r = runFfmpeg(
        [
          "-vf", `scale='min(${POSTER_MAX_WIDTH},iw)':-2:flags=lanczos`,
          "-c:v", "libwebp",
          "-quality", String(WEBP_QUALITY),
          "-compression_level", "6",
          "-f", "webp"
        ],
        src,
        out
      );
      if (r.ok) {
        const body = readFileSync(out);
        const newKey = key.replace(/\.[^.]+$/, "") + ".opt.webp";
        if (!dryRun) {
          await upload(newKey, body, "image/webp");
          const h = await headCdn(newKey);
          if (!h.ok || h.length !== body.length) {
            throw new Error(`poster upload verification failed for ${newKey}: ${JSON.stringify(h)}`);
          }
        }
        console.log(`p${p.pageNum} poster  ${before.toLocaleString()} B -> ${body.length.toLocaleString()} B`);
        entry.poster = {
          oldUrl: orig.url,
          newUrl: `${CDN}/${newKey}`,
          oldKey: key,
          newKey,
          bytesBefore: before,
          bytesAfter: body.length
        };
      } else {
        console.log(`p${p.pageNum} poster  FAILED: ${r.stderr}`);
      }
    }
  }

  /* ---- video -> faststart remux + C2PA re-injection ---- */
  if (p.videoUrl) {
    const orig = await originalOf(p.videoUrl);
    if (!orig) {
      console.log(`p${p.pageNum} video   skipped - original could not be resolved`);
    } else {
      const key = orig.key;
      const src = join(tmp, `p${p.pageNum}.mp4`);
      await download(orig.url, src);
      const before = readFileSync(src).length;
      const beforeMoov = moovPosition(src);
      const beforeMoovFfprobe = moovPositionViaFfprobe(src);
      const out = join(tmp, `p${p.pageNum}.fast.mp4`);
      const r = runFfmpeg(["-c", "copy", "-movflags", "+faststart", "-f", "mp4"], src, out);
      if (r.ok) {
        /* --- re-inject the C2PA manifest the remux dropped --- */
        const sourceBytes = readFileSync(src);
        const c2pa = extractUuidBox(sourceBytes);
        const remuxed = readFileSync(out);
        const body = c2pa ? injectBox(remuxed, c2pa) : remuxed;

        const afterMoov = moovPosition(out);
        const afterMoovFfprobe = moovPositionViaFfprobe(out);
        const boxesBefore = topLevelBoxes(src).map((b) => `${b.type}:${b.size}`);
        const boxesAfter = topLevelBoxes(out).map((b) => `${b.type}:${b.size}`);
        const newKey = key.replace(/\.mp4$/, "") + ".opt.mp4";
        if (!dryRun) {
          await upload(newKey, body, "video/mp4");
          const h = await headCdn(newKey);
          if (!h.ok || h.length !== body.length) {
            throw new Error(`video upload verification failed for ${newKey}: ${JSON.stringify(h)}`);
          }
        }
        console.log(
          `p${p.pageNum} video   ${before.toLocaleString()} B -> ${body.length.toLocaleString()} B   moov ${beforeMoov} -> ${afterMoov}` +
            (c2pa ? `   C2PA uuid ${c2pa.length.toLocaleString()} B preserved` : "   (no C2PA box in source)")
        );
        entry.video = {
          oldUrl: orig.url,
          newUrl: `${CDN}/${newKey}`,
          oldKey: key,
          newKey,
          bytesBefore: before,
          bytesAfter: body.length,
          moovBefore: beforeMoov,
          moovAfter: afterMoov,
          moovBeforeFfprobe: beforeMoovFfprobe,
          moovAfterFfprobe: afterMoovFfprobe,
          c2paBytes: c2pa ? c2pa.length : 0,
          boxesBefore,
          boxesAfter
        };
      } else {
        console.log(`p${p.pageNum} video   FAILED: ${r.stderr}`);
      }
    }
  }

  /* ---- narration -> mono 48k ---- */
  if (p.audioUrl) {
    const orig = await originalOf(p.audioUrl);
    if (!orig) {
      console.log(`p${p.pageNum} audio   skipped - original could not be resolved`);
    } else {
      const key = orig.key;
      const src = join(tmp, `p${p.pageNum}.mp3`);
      await download(orig.url, src);
      const before = readFileSync(src).length;
      const out = join(tmp, `p${p.pageNum}.opt.mp3`);
      const r = runFfmpeg(["-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k", "-f", "mp3"], src, out);
      // Probe the LOCAL file: the CDN copy does not exist yet during a dry run.
      // A malformed source produces a file ffprobe cannot read - that is a
      // failed ASSET, not a failed book, so it must not throw.
      let probe = null;
      if (r.ok) {
        try {
          probe = ffprobeJson(out);
        } catch (err) {
          console.log(
            `p${p.pageNum} audio   FAILED: ffprobe could not read the converted file (${String(err.message).slice(0, 120)})`
          );
        }
      }
      if (r.ok && probe) {
        const body = readFileSync(out);
        const newKey = key.replace(/\.mp3$/, "") + ".opt.mp3";
        if (!dryRun) {
          await upload(newKey, body, "audio/mpeg");
          const h = await headCdn(newKey);
          if (!h.ok || h.length !== body.length) {
            throw new Error(`audio upload verification failed for ${newKey}: ${JSON.stringify(h)}`);
          }
        }
        const a = probe.streams.find((s) => s.codec_type === "audio");
        console.log(`p${p.pageNum} audio   ${before.toLocaleString()} B -> ${body.length.toLocaleString()} B   ${a?.channels}ch ${a?.sample_rate}Hz`);
        entry.audio = {
          oldUrl: orig.url,
          newUrl: `${CDN}/${newKey}`,
          oldKey: key,
          newKey,
          bytesBefore: before,
          bytesAfter: body.length,
          channels: a?.channels ?? null,
          sampleRate: a?.sample_rate ?? null
        };
      } else if (!r.ok) {
        console.log(`p${p.pageNum} audio   FAILED: ${r.stderr}`);
      }
    }
  }

  manifest.pages.push(entry);
}

/* ---- repoint the database ---- */
if (!dryRun) {
  /* Write the manifest BEFORE the database is repointed. If the process dies
     between the two, the manifest is already on disk, so the book can still be
     rolled back on its own. */
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\nMANIFEST ${manifestPath}`);

  if (manifest.cover) {
    await db(() => prisma.book.update({ where: { id: book.id }, data: { coverUrl: manifest.cover.newUrl } }));
  }
  for (const e of manifest.pages) {
    const data = {};
    if (e.video) data.videoUrl = e.video.newUrl;
    if (e.poster) data.posterUrl = e.poster.newUrl;
    if (e.audio) data.audioUrl = e.audio.newUrl;
    if (Object.keys(data).length) await db(() => prisma.page.update({ where: { id: e.pageId }, data }));
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log("Database URLs repointed. Originals left untouched in R2.");
  console.log(`Roll back with: node apps/api/scripts/rollback-optimized-media.mjs ${book.slug}`);

  /* ---- read the rows back: prove the DB really points at the new keys ---- */
  const after = await db(() =>
    prisma.book.findUnique({
      where: { id: book.id },
      select: { coverUrl: true, pages: { orderBy: { pageNum: "asc" }, select: { pageNum: true, videoUrl: true, posterUrl: true, audioUrl: true } } }
    })
  );
  console.log("\nVERIFY (read back from the database):");
  console.log(`  cover  ${after.coverUrl}`);
  for (const p of after.pages) {
    console.log(`  page ${p.pageNum}`);
    console.log(`    video  ${p.videoUrl}`);
    console.log(`    poster ${p.posterUrl}`);
    console.log(`    audio  ${p.audioUrl}`);
  }
} else {
  console.log("\nDRY RUN -- nothing uploaded, no database rows changed.");
}

await prisma.$disconnect();
