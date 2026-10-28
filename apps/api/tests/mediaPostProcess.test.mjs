/**
 * Unit tests for the media post-processing step.
 *
 * Covers the three optimisers the pipeline now runs on every NEW asset:
 *
 *   video      - remuxed with `-movflags +faststart`, streams COPIED
 *   image      - WebP at the size the asset is displayed at
 *   narration  - mono MP3 at 48 kbps
 *
 * and the two properties that actually matter for safety:
 *
 *   1. the ORIGINAL bytes are never mutated (the caller stores the optimised
 *      copy under a NEW key), and
 *   2. a broken / missing ffmpeg degrades to "keep the original" instead of
 *      failing the pipeline job.
 *
 * Fixtures are generated with the same ffmpeg the API resolves at runtime,
 * so the test exercises the real binary, not a mock. When no ffmpeg is
 * available the ffmpeg-dependent tests are skipped rather than failed.
 */
import "./_guard.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { resolveFfmpeg, resolveFfprobe } = await import("../dist/services/ffmpegBin.js");
const {
  optimizeVideo,
  optimizeImage,
  optimizeNarration,
  optimizeMedia,
  optimizeSocialImage,
  optimizedKey,
  socialImageKey,
  socialImageUrl,
  extractC2paBox,
  injectMp4Box,
  posterTransform,
  coverTransform,
  videoTransform,
  narrationTransform,
  lastTransform,
  POSTER_MAX_WIDTH,
  COVER_MAX_WIDTH,
  WEBP_QUALITY
} = await import("../dist/services/mediaPostProcess.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "..", "dist", "services");
const FFMPEG = resolveFfmpeg();
const FFPROBE = resolveFfprobe();

const skip = FFMPEG ? false : "ffmpeg is not available on this machine";

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

let fixtures = null;

function makeFixtures() {
  const dir = mkdtempSync(join(tmpdir(), "animbook-mpp-test-"));
  const png = join(dir, "still.png");
  const mp4 = join(dir, "clip.mp4");
  const mp3 = join(dir, "voice.mp3");

  const run = (args) => {
    const r = spawnSync(FFMPEG, ["-v", "error", "-y", ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`fixture generation failed: ${r.stderr}`);
  };

  // A wide still - 2000px, so the 1280 / 800 clamps have something to do.
  run(["-f", "lavfi", "-i", "color=c=teal:s=2000x1000", "-frames:v", "1", png]);
  // A short H.264 clip. ffmpeg writes the moov atom at the END by default,
  // which is exactly the problem the faststart remux has to fix.
  run(["-f", "lavfi", "-i", "testsrc2=s=320x180:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4]);
  // A stereo 128 kbps MP3 - the source the narration optimiser has to halve.
  run(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", mp3]);

  fixtures = {
    dir,
    png: readFileSync(png),
    mp4: readFileSync(mp4),
    mp3: readFileSync(mp3)
  };
  return fixtures;
}

/** ffprobe a file and return the parsed json. */
function probe(file) {
  const r = spawnSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], {
    encoding: "utf8",
    maxBuffer: 32e6
  });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

/** "front" | "back" - where the moov atom sits relative to mdat. */
function moovPosition(file) {
  const r = spawnSync(FFPROBE, ["-v", "trace", "-i", file], { encoding: "utf8", maxBuffer: 32e6 });
  const text = `${r.stdout || ""}${r.stderr || ""}`;
  const mdat = text.search(/type:'mdat'/);
  const moov = text.search(/type:'moov'/);
  if (moov === -1) return "unknown";
  if (mdat === -1) return "front";
  return moov < mdat ? "front" : "back";
}

/* ------------------------------------------------------------------ */
/* pure helpers - no ffmpeg needed                                     */
/* ------------------------------------------------------------------ */

test("optimizedKey swaps the extension for .opt.<ext>", () => {
  assert.equal(optimizedKey("books/lagoon/p1-abc.mp4", "mp4"), "books/lagoon/p1-abc.opt.mp4");
  assert.equal(optimizedKey("books/lagoon/cover-xyz.png", "webp"), "books/lagoon/cover-xyz.opt.webp");
  assert.equal(optimizedKey("books/lagoon/voice.mp3", "mp3"), "books/lagoon/voice.opt.mp3");
  // A key with no extension still gets one.
  assert.equal(optimizedKey("books/lagoon/cover", "webp"), "books/lagoon/cover.opt.webp");
  // The original key is never part of the result as-is.
  assert.ok(!optimizedKey("books/lagoon/p1-abc.mp4", "mp4").endsWith("/p1-abc.mp4"));
});

/* ------------------------------------------------------------------ */
/* the optimisers themselves                                           */
/* ------------------------------------------------------------------ */

test("optimizeVideo remuxes with faststart and puts the moov atom at the front", { skip }, async () => {
  const f = fixtures ?? makeFixtures();
  const src = join(f.dir, "clip.mp4");
  const out = join(f.dir, "clip.fast.mp4");
  writeFileSync(src, f.mp4);

  assert.equal(moovPosition(src), "back", "the fixture must have moov at the back to be a meaningful test");

  const res = await optimizeVideo(f.mp4);
  assert.equal(res.applied, true, res.note ?? "optimise should have applied");
  assert.equal(res.contentType, "video/mp4");
  assert.equal(res.extension, "mp4");
  assert.ok(res.bytesAfter > 0);
  assert.equal(res.bytesBefore, f.mp4.length);

  writeFileSync(out, res.body);
  assert.equal(moovPosition(out), "front", "moov must be at the front after the remux");

  // Streams are COPIED, so the video parameters must be identical.
  const before = probe(src).streams.find((s) => s.codec_type === "video");
  const after = probe(out).streams.find((s) => s.codec_type === "video");
  assert.equal(after.codec_name, before.codec_name);
  assert.equal(after.width, before.width);
  assert.equal(after.height, before.height);
  assert.equal(after.pix_fmt, before.pix_fmt);
});

test("optimizeImage re-encodes a still as WebP at the requested width", { skip }, async () => {
  const f = fixtures ?? makeFixtures();
  const res = await optimizeImage(f.png, { maxWidth: POSTER_MAX_WIDTH });
  assert.equal(res.applied, true, res.note ?? "optimise should have applied");
  assert.equal(res.contentType, "image/webp");
  assert.equal(res.extension, "webp");
  assert.ok(res.bytesAfter < res.bytesBefore, "WebP q80 must be smaller than the PNG source");

  const out = join(f.dir, "still.webp");
  writeFileSync(out, res.body);
  const stream = probe(out).streams.find((s) => s.codec_type === "video");
  assert.equal(stream.codec_name, "webp");
  assert.equal(stream.width, POSTER_MAX_WIDTH, "the 2000px source must be clamped to the poster width");
  // The fixture is 2000x1000 (2:1), so 1280 wide means 640 tall.
  assert.equal(stream.height, 640, "height follows the source aspect ratio");
});

test("optimizeImage never inflates a still that is already smaller than the target", { skip }, async () => {
  const f = fixtures ?? makeFixtures();
  const res = await optimizeImage(f.png, { maxWidth: 4000 });
  assert.equal(res.applied, true);
  const out = join(f.dir, "still.nowide.webp");
  writeFileSync(out, res.body);
  const stream = probe(out).streams.find((s) => s.codec_type === "video");
  assert.equal(stream.width, 2000, "a source narrower than the cap must not be upscaled");
});

test("optimizeNarration writes a mono MP3 at 48 kbps", { skip }, async () => {
  const f = fixtures ?? makeFixtures();
  const res = await optimizeNarration(f.mp3);
  assert.equal(res.applied, true, res.note ?? "optimise should have applied");
  assert.equal(res.contentType, "audio/mpeg");
  assert.equal(res.extension, "mp3");
  assert.ok(res.bytesAfter < res.bytesBefore, "48 kbps must be smaller than the 128 kbps source");

  const out = join(f.dir, "voice.opt.mp3");
  writeFileSync(out, res.body);
  const stream = probe(out).streams.find((s) => s.codec_type === "audio");
  assert.equal(stream.codec_name, "mp3");
  assert.equal(stream.channels, 1, "narration must be mono");
  assert.ok(
    Math.abs(Number(stream.bit_rate) - 48000) < 8000,
    `expected roughly 48 kbps, got ${stream.bit_rate}`
  );
});

test("optimizeMedia dispatches to the right optimiser", { skip }, async () => {
  const f = fixtures ?? makeFixtures();
  const video = await optimizeMedia("video", f.mp4);
  const image = await optimizeMedia("image", f.png);
  const narration = await optimizeMedia("narration", f.mp3);
  assert.equal(video.contentType, "video/mp4");
  assert.equal(image.contentType, "image/webp");
  assert.equal(narration.contentType, "audio/mpeg");
});

/* ------------------------------------------------------------------ */
/* the transform hooks used by mirrorToR2 / uploadAsset                */
/* ------------------------------------------------------------------ */

test("posterTransform rewrites the key and returns the optimised bytes", { skip }, async () => {
  const f = fixtures ?? makeFixtures();
  const t = posterTransform();
  const res = await t(f.png, "image/png", "books/lagoon/p1-abc.png");
  assert.ok(res, "the transform must return a result when the optimisation applied");
  assert.equal(res.key, "books/lagoon/p1-abc.opt.webp");
  assert.equal(res.contentType, "image/webp");
  assert.ok(res.body.length < f.png.length);
  assert.equal(lastTransform.outcome.applied, true);
  assert.equal(lastTransform.outcome.bytesBefore, f.png.length);
  assert.equal(lastTransform.outcome.bytesAfter, res.body.length);
});

test("coverTransform uses the narrower cover width", { skip }, async () => {
  const f = fixtures ?? makeFixtures();
  const t = coverTransform();
  const res = await t(f.png, "image/png", "books/lagoon/cover-abc.png");
  assert.equal(res.key, "books/lagoon/cover-abc.opt.webp");
  const out = join(f.dir, "cover.webp");
  writeFileSync(out, res.body);
  const stream = probe(out).streams.find((s) => s.codec_type === "video");
  assert.equal(stream.width, COVER_MAX_WIDTH, "a cover must be clamped to the cover width");
});

test("videoTransform and narrationTransform rewrite their keys", { skip }, async () => {
  const f = fixtures ?? makeFixtures();
  const v = await videoTransform()(f.mp4, "video/mp4", "books/lagoon/p1-abc.mp4");
  assert.equal(v.key, "books/lagoon/p1-abc.opt.mp4");
  assert.equal(v.contentType, "video/mp4");

  const a = await narrationTransform()(f.mp3, "audio/mpeg", "books/lagoon/p1-voice.mp3");
  assert.equal(a.key, "books/lagoon/p1-voice.opt.mp3");
  assert.equal(a.contentType, "audio/mpeg");
});

test("a transform returns null (keep the original) when the optimiser cannot run", { skip }, async () => {
  const t = videoTransform();
  const res = await t(Buffer.from("this is not an mp4 at all"), "video/mp4", "books/lagoon/broken.mp4");
  assert.equal(res, null, "a failed optimisation must not replace the original");
  assert.equal(lastTransform.outcome.applied, false);
  assert.ok(lastTransform.outcome.note, "the reason must be recorded");
});

/* ------------------------------------------------------------------ */
/* degradation                                                         */
/* ------------------------------------------------------------------ */

test("optimizeVideo keeps the original bytes when ffmpeg fails", { skip }, async () => {
  const junk = Buffer.from("this is not an mp4 at all");
  const res = await optimizeVideo(junk);
  assert.equal(res.applied, false);
  assert.equal(res.contentType, "video/mp4");
  assert.equal(res.bytesBefore, junk.length);
  assert.equal(res.bytesAfter, junk.length, "the byte count must not change on failure");
  assert.deepEqual(res.body, junk, "the original bytes must come back untouched");
  assert.ok(res.note);
});

test("optimizeImage keeps the original bytes when ffmpeg fails", { skip }, async () => {
  const junk = Buffer.from("this is not a png at all");
  const res = await optimizeImage(junk);
  assert.equal(res.applied, false);
  assert.equal(res.contentType, "image/png", "the original content type is kept");
  assert.equal(res.extension, "png");
  assert.deepEqual(res.body, junk);
});

test("optimizeNarration keeps the original bytes when ffmpeg fails", { skip }, async () => {
  const junk = Buffer.from("this is not an mp3 at all");
  const res = await optimizeNarration(junk);
  assert.equal(res.applied, false);
  assert.equal(res.contentType, "audio/mpeg");
  assert.deepEqual(res.body, junk);
});

test("a missing ffmpeg binary degrades gracefully (child process)", () => {
  // The resolver caches its answer, so this has to run in its own process
  // with FFMPEG_PATH pointing at a file that is not an executable.
  const dir = mkdtempSync(join(tmpdir(), "animbook-mpp-nobin-"));
  const fake = join(dir, "not-ffmpeg.txt");
  writeFileSync(fake, "not a binary");

  const script = `
    import { optimizeVideo, optimizeImage } from ${JSON.stringify(pathToFileURL(join(DIST, "mediaPostProcess.js")).href)};
    const junk = Buffer.from("nope");
    const v = await optimizeVideo(junk);
    const i = await optimizeImage(junk);
    console.log(JSON.stringify({
      video: { applied: v.applied, same: v.body.equals(junk), before: v.bytesBefore, after: v.bytesAfter, note: v.note },
      image: { applied: i.applied, same: i.body.equals(junk) }
    }));
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, FFMPEG_PATH: fake },
    timeout: 60000
  });
  assert.equal(r.status, 0, `child failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(out.video.applied, false, "a broken binary must not report success");
  assert.equal(out.video.same, true, "the original bytes must come back untouched");
  assert.equal(out.video.before, out.video.after);
  assert.ok(out.video.note, "the failure must be explained");
  assert.equal(out.image.applied, false);
  assert.equal(out.image.same, true);
});

test("the display widths and quality are the documented ones", () => {
  assert.equal(POSTER_MAX_WIDTH, 1280);
  assert.equal(COVER_MAX_WIDTH, 800);
  assert.equal(WEBP_QUALITY, 80);
});

/* ------------------------------------------------------------------ */
/* C2PA (Content Credentials)                                          */
/* ------------------------------------------------------------------ */

/**
 * Build a synthetic top-level `uuid` box, the way a C2PA/JUMBF manifest is
 * stored in an MP4: size(4) + "uuid"(4) + user type(16) + payload.
 */
function makeUuidBox(payload) {
  const userType = Buffer.from("c2pa-test-manifest", "latin1");
  const body = Buffer.concat([userType, payload]);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write("uuid", 4, "latin1");
  return Buffer.concat([head, body]);
}

test("extractC2paBox finds the uuid box and injectMp4Box splices it back after ftyp", () => {
  const f = fixtures ?? makeFixtures();
  const box = makeUuidBox(Buffer.alloc(2048, 0x5a));
  const withBox = injectMp4Box(f.mp4, box);

  const found = extractC2paBox(withBox);
  assert.ok(found, "the uuid box must be found");
  assert.deepEqual(found, box, "the extracted box must be byte-identical");

  // The box must sit right after ftyp. The ftyp box header is 8 bytes
  // (size + type) and its size covers the whole box, so the next box
  // starts AT ftypSize and its type is the 4 bytes after that.
  const ftypSize = withBox.readUInt32BE(0);
  assert.equal(withBox.toString("latin1", 4, 8), "ftyp");
  assert.equal(withBox.toString("latin1", ftypSize + 4, ftypSize + 8), "uuid");

  // A clip without a uuid box has none to extract.
  assert.equal(extractC2paBox(f.mp4), null);
});

test("optimizeVideo re-injects the C2PA box the remux drops", { skip }, async () => {
  const f = fixtures ?? makeFixtures();
  const box = makeUuidBox(Buffer.alloc(4096, 0x33));
  const source = injectMp4Box(f.mp4, box);

  const res = await optimizeVideo(source);
  assert.equal(res.applied, true, res.note ?? "optimise should have applied");

  const found = extractC2paBox(res.body);
  assert.ok(found, "the optimised clip must still carry its C2PA manifest");
  assert.deepEqual(found, box, "the manifest must be preserved byte-for-byte");
  assert.match(res.note ?? "", /c2pa/i, "the outcome must say the manifest was preserved");

  // The faststart property must survive the injection.
  const out = join(f.dir, "clip.c2pa.mp4");
  writeFileSync(out, res.body);
  assert.equal(moovPosition(out), "front", "moov must still be at the front");
});

/* ------------------------------------------------------------------ */
/* social previews                                                     */
/* ------------------------------------------------------------------ */

test("socialImageKey derives the same twin from the original or the optimised key", () => {
  assert.equal(socialImageKey("books/lagoon/cover-abc.png"), "books/lagoon/cover-abc.social.jpg");
  assert.equal(
    socialImageKey("books/lagoon/cover-abc.opt.webp"),
    socialImageKey("books/lagoon/cover-abc.png"),
    "the twin key must not depend on whether the cover was already optimised"
  );
});

test("socialImageUrl only ever points at a non-WebP image", () => {
  assert.equal(
    socialImageUrl("https://media.animbook.com/books/lagoon/cover-abc.opt.webp"),
    "https://media.animbook.com/books/lagoon/cover-abc.social.jpg"
  );
  assert.equal(
    socialImageUrl("https://media.animbook.com/books/lagoon/cover-abc.webp"),
    "https://media.animbook.com/books/lagoon/cover-abc.social.jpg",
    "a plain WebP cover must map to the twin too"
  );
  // A cover that is not a WebP is already a valid og:image -> no twin.
  assert.equal(socialImageUrl("https://media.animbook.com/books/lagoon/cover-abc.png"), null);
  assert.equal(socialImageUrl(null), null);
  assert.equal(socialImageUrl(""), null);
});

test("optimizeSocialImage produces a JPEG", { skip }, async () => {
  const f = fixtures ?? makeFixtures();
  const res = await optimizeSocialImage(f.png);
  assert.equal(res.applied, true, res.note ?? "optimise should have applied");
  assert.equal(res.contentType, "image/jpeg");
  assert.equal(res.extension, "jpg");
  const out = join(f.dir, "cover.social.jpg");
  writeFileSync(out, res.body);
  const stream = probe(out).streams.find((s) => s.codec_type === "video");
  assert.equal(stream.codec_name, "mjpeg");
  assert.equal(stream.width, COVER_MAX_WIDTH);
});
