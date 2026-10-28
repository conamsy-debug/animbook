/**
 * ONE-TIME optimiser for EXISTING media.
 *
 * Re-encodes the already-published assets of a book so the reader stops
 * downloading megabytes of PNG and non-faststart MP4:
 *
 *   - MP4   -> remuxed with `-movflags +faststart` (streams COPIED, no
 *              re-encode, no quality loss) so the moov index is at the FRONT.
 *   - PNG/JPG -> WebP (q80) at the size the asset is displayed at.
 *   - MP3  -> mono 48 kbps.
 *
 * The originals are NEVER deleted or overwritten. Every optimised file is
 * written under a NEW key (`<name>.opt.<ext>`) and the database is
 * repointed at it. `rollback-optimized-media.mjs` restores the old URLs
 * using the manifest this script writes.
 *
 * Usage:
 *   node apps/api/scripts/optimize-existing-media.mjs <book-slug-or-id>
 *   node apps/api/scripts/optimize-existing-media.mjs --dry-run <slug>
 *
 * Safety: it only touches the ONE book you name. It refuses to run
 * without an explicit target.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, openSync, readSync, closeSync, statSync } from "node:fs";
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
const MANIFEST_DIR = join(HERE, "..", "..", "..", "apps", "api", "scripts");
const CDN = "https://media.animbook.com";

const POSTER_MAX_WIDTH = 1280;
const COVER_MAX_WIDTH = 800;
const WEBP_QUALITY = 80;

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

const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

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

/** Download a CDN object to a local path. Retries transient network errors. */
async function download(url, dest, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error(`GET ${url} -> empty body`);
      writeFileSync(dest, buf);
      return buf.length;
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        const wait = 500 * i;
        console.warn(`  download ${url} failed (${err.message}) - retry ${i}/${attempts - 1} in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

async function upload(key, body, contentType) {
  const res = await r2.fetch(objectUrl(key), {
    method: "PUT",
    headers: { "Content-Type": contentType, "Content-Length": String(body.byteLength) },
    body: new Uint8Array(body)
  });
  if (!res.ok) throw new Error(`PUT ${key} -> ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return `${CDN}/${key}`;
}

/** Confirm the object really landed and is served with the right type + size. */
async function headCdn(key) {
  const res = await fetch(`${CDN}/${key}`, { method: "HEAD" });
  return {
    ok: res.ok,
    status: res.status,
    type: res.headers.get("content-type"),
    length: Number(res.headers.get("content-length") ?? 0)
  };
}

/* ------------------------------------------------------------------ */

const book = await prisma.book.findFirst({
  where: { OR: [{ id: target }, { slug: target }] },
  select: { id: true, slug: true, title: true, coverUrl: true }
});
if (!book) {
  console.error(`No book matches "${target}".`);
  process.exit(1);
}
console.log(`BOOK  ${book.title}  (${book.slug})  id=${book.id}`);

const pages = await prisma.page.findMany({
  where: { bookId: book.id },
  orderBy: { pageNum: "asc" },
  select: { id: true, pageNum: true, videoUrl: true, audioUrl: true, posterUrl: true, vttUrl: true }
});
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
  const key = book.coverUrl.replace(`${CDN}/`, "");
  const ext = key.split(".").pop()?.toLowerCase() ?? "png";
  if (ext === "webp") {
    console.log(`cover  already webp -- skipped`);
  } else {
    const src = join(tmp, `cover.${ext}`);
    await download(book.coverUrl, src);
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
      manifest.cover = { oldUrl: book.coverUrl, newUrl: `${CDN}/${newKey}`, oldKey: key, newKey, bytesBefore: before, bytesAfter: body.length };
    } else {
      console.log(`cover  FAILED: ${r.stderr}`);
    }
  }
}

/* ---- pages ---- */
for (const p of pages) {
  const entry = { pageId: p.id, pageNum: p.pageNum, video: null, audio: null, poster: null };

  // Poster -> WebP
  if (p.posterUrl && !/\.webp(\?|$)/i.test(p.posterUrl)) {
    const key = p.posterUrl.replace(`${CDN}/`, "");
    const ext = key.split(".").pop()?.toLowerCase() ?? "png";
    const src = join(tmp, `p${p.pageNum}.${ext}`);
    await download(p.posterUrl, src);
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
      entry.poster = { oldUrl: p.posterUrl, newUrl: `${CDN}/${newKey}`, oldKey: key, newKey, bytesBefore: before, bytesAfter: body.length };
    } else {
      console.log(`p${p.pageNum} poster  FAILED: ${r.stderr}`);
    }
  }

  // Video -> faststart remux
  if (p.videoUrl && /\.mp4(\?|$)/i.test(p.videoUrl)) {
    const key = p.videoUrl.replace(`${CDN}/`, "");
    const src = join(tmp, `p${p.pageNum}.mp4`);
    await download(p.videoUrl, src);
    const before = readFileSync(src).length;
    const beforeMoov = moovPosition(src);
    const beforeMoovFfprobe = moovPositionViaFfprobe(src);
    const out = join(tmp, `p${p.pageNum}.fast.mp4`);
    const r = runFfmpeg(["-c", "copy", "-movflags", "+faststart", "-f", "mp4"], src, out);
    if (r.ok) {
      const body = readFileSync(out);
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
      console.log(`p${p.pageNum} video   ${before.toLocaleString()} B -> ${body.length.toLocaleString()} B   moov ${beforeMoov} -> ${afterMoov}`);
      entry.video = {
        oldUrl: p.videoUrl,
        newUrl: `${CDN}/${newKey}`,
        oldKey: key,
        newKey,
        bytesBefore: before,
        bytesAfter: body.length,
        moovBefore: beforeMoov,
        moovAfter: afterMoov,
        moovBeforeFfprobe: beforeMoovFfprobe,
        moovAfterFfprobe: afterMoovFfprobe,
        boxesBefore,
        boxesAfter
      };
    } else {
      console.log(`p${p.pageNum} video   FAILED: ${r.stderr}`);
    }
  }

  // Narration -> mono 48k
  if (p.audioUrl && /\.mp3(\?|$)/i.test(p.audioUrl)) {
    const key = p.audioUrl.replace(`${CDN}/`, "");
    const src = join(tmp, `p${p.pageNum}.mp3`);
    await download(p.audioUrl, src);
    const before = readFileSync(src).length;
    const out = join(tmp, `p${p.pageNum}.opt.mp3`);
    const r = runFfmpeg(["-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k", "-f", "mp3"], src, out);
    if (r.ok) {
      const body = readFileSync(out);
      const newKey = key.replace(/\.mp3$/, "") + ".opt.mp3";
      // Probe the LOCAL file: the CDN copy does not exist yet during a dry run.
      const probe = ffprobeJson(out);
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
        oldUrl: p.audioUrl,
        newUrl: `${CDN}/${newKey}`,
        oldKey: key,
        newKey,
        bytesBefore: before,
        bytesAfter: body.length,
        channels: a?.channels ?? null,
        sampleRate: a?.sample_rate ?? null
      };
    } else {
      console.log(`p${p.audioUrl} audio   FAILED: ${r.stderr}`);
    }
  }

  manifest.pages.push(entry);
}

/* ---- repoint the database ---- */
if (!dryRun) {
  if (manifest.cover) {
    await prisma.book.update({ where: { id: book.id }, data: { coverUrl: manifest.cover.newUrl } });
  }
  for (const e of manifest.pages) {
    const data = {};
    if (e.video) data.videoUrl = e.video.newUrl;
    if (e.poster) data.posterUrl = e.poster.newUrl;
    if (e.audio) data.audioUrl = e.audio.newUrl;
    if (Object.keys(data).length) await prisma.page.update({ where: { id: e.pageId }, data });
  }
  const manifestPath = join(MANIFEST_DIR, `optimize-manifest-${book.slug}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\nMANIFEST ${manifestPath}`);
  console.log("Database URLs repointed. Originals left untouched in R2.");
  console.log(`Roll back with: node apps/api/scripts/rollback-optimized-media.mjs ${book.slug}`);

  /* ---- read the rows back: prove the DB really points at the new keys ---- */
  const after = await prisma.book.findUnique({
    where: { id: book.id },
    select: { coverUrl: true, pages: { orderBy: { pageNum: "asc" }, select: { pageNum: true, videoUrl: true, posterUrl: true, audioUrl: true } } }
  });
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
