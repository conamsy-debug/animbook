/**
 * Rendering a book's shots.
 *
 * The shot writer (shotWriter.ts) only PLANS shots. This module renders them:
 * the first-frame still (with the character's reference image attached as
 * subject_reference so she looks the same in every shot), then the clip that
 * starts from that still, then the poster.
 *
 * It is shared by both pipelines so a shot is rendered the same way whichever
 * route reached it:
 *   - pipeline.ts      - the studio "animate page" job
 *   - splitPipeline.ts - the split still/clip job
 *
 * Everything goes through the existing post-processing: faststart remux with
 * the C2PA box kept for clips, WebP posters for stills.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db.js";
import { generateStill as defaultGenerateStill, animateStill as defaultAnimateStill } from "./videoProvider.js";
import { mirrorToR2 as defaultMirrorToR2 } from "./cloudflare.js";
import { posterTransform, videoTransform, optimizeImage, optimizedKey, POSTER_MAX_WIDTH } from "./mediaPostProcess.js";
import { resolveFfmpeg } from "./ffmpegBin.js";
import { spawn } from "node:child_process";
import type { ReferenceImage } from "./runway.js";

/** The video model the shot path renders with. */
export const SHOT_VIDEO_MODEL = "MiniMax-Hailuo-2.3";

/** The resolution the shot path renders at. */
export const SHOT_VIDEO_RESOLUTION = "768P";

/** The aspect every first-frame still is generated at. */
export const SHOT_STILL_RATIO = "1280:720";

export interface ShotRenderDeps {
  prisma: PrismaClient;
  generateStill: (prompt: string, ratio: string, references?: ReferenceImage[]) => Promise<string>;
  animateStill: (
    imageUrl: string,
    motion: string,
    seconds: number,
    resolution: string,
    model?: string
  ) => Promise<string>;
  mirrorToR2: (
    sourceUrl: string,
    key: string,
    fallbackContentType: string,
    attempts?: number,
    transform?: (body: Buffer, contentType: string, key: string) => Promise<{ body: Buffer; contentType: string; key: string } | null>
  ) => Promise<{ url: string }>;
  /**
   * Pull the LAST frame out of a finished clip. Used to chain a continuation
   * shot onto the clip before it. Returns null when the frame cannot be
   * pulled - the shot then falls back to its own first-frame still.
   */
  extractLastFrame?: (videoUrl: string) => Promise<{ body: Buffer; contentType: string } | null>;
  /** Store bytes we already have (a pulled frame) as an object. */
  uploadAsset?: (input: { key: string; body: Buffer; contentType: string }) => Promise<{ url: string }>;
}

export function defaultShotRenderDeps(): ShotRenderDeps {
  return {
    prisma: defaultPrisma,
    generateStill: defaultGenerateStill as ShotRenderDeps["generateStill"],
    animateStill: defaultAnimateStill as unknown as ShotRenderDeps["animateStill"],
    mirrorToR2: defaultMirrorToR2 as unknown as ShotRenderDeps["mirrorToR2"],
    extractLastFrame: defaultExtractLastFrame,
    uploadAsset: defaultUploadAsset
  };
}

/* --------------------------------------------------------------------- *
 * The last frame of a clip
 * --------------------------------------------------------------------- */

/**
 * Download a clip and pull its LAST frame out of it.
 *
 * This is the heart of shot chaining: the frame the previous clip ends on is
 * the frame the next clip starts from, so the costume, the face and the light
 * carry over instead of being re-invented by a new still.
 *
 * It is deliberately forgiving: no ffmpeg, a failed download or an unreadable
 * clip all return null, and the caller falls back to the shot's own
 * first-frame still. A missing frame must never cost the clip.
 */
export async function defaultExtractLastFrame(
  videoUrl: string
): Promise<{ body: Buffer; contentType: string } | null> {
  let clip: Buffer;
  try {
    clip = await downloadClip(videoUrl);
  } catch (err) {
    console.warn(`[shot-renderer] could not download the clip to chain from: ${(err as Error).message}`);
    return null;
  }
  const frame = await lastFrameFromClip(clip);
  if (!frame) return null;
  return { body: frame, contentType: "image/png" };
}

/** Download a clip, with a couple of retries. */
async function downloadClip(videoUrl: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      return Buffer.from(new Uint8Array(await res.arrayBuffer()));
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
    }
  }
  throw lastErr ?? new Error("the clip could not be downloaded");
}

/**
 * The last frame of an MP4, as a PNG.
 *
 * `-sseof` seeks from the end of the file, so this is the frame the clip
 * actually finishes on - not the last keyframe.
 */
async function lastFrameFromClip(clip: Buffer): Promise<Buffer | null> {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) return null;
  const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "animbook-chain-"));
    const input = join(dir, "clip.mp4");
    const output = join(dir, "last.png");
    await writeFile(input, clip);
    const ok = await runFfmpeg(ffmpeg, [
      "-y",
      "-sseof",
      "-0.08",
      "-i",
      input,
      "-frames:v",
      "1",
      "-update",
      "1",
      output
    ]);
    if (!ok) return null;
    return await readFile(output);
  } catch (err) {
    console.warn(`[shot-renderer] the last frame could not be pulled: ${(err as Error).message}`);
    return null;
  } finally {
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** Run ffmpeg and report whether it produced the file. */
function runFfmpeg(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
}

/** Store bytes we already have as an R2 object. */
export async function defaultUploadAsset(input: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<{ url: string }> {
  const { uploadAsset } = await import("./cloudflare.js");
  const result = await uploadAsset(input);
  return { url: result.url };
}

/* --------------------------------------------------------------------- *
 * The character reference image
 * --------------------------------------------------------------------- */

/**
 * The prompt for a character's ONE reference image.
 *
 * A plain, evenly lit photograph of the WHOLE BODY gives the model the least
 * to reinterpret, and the same image is then attached to every first-frame
 * still the character appears in, so she is the same person - in the SAME
 * COSTUME - in shot 1 and shot 40.
 *
 * The image has to run from the headwear to the footwear: a portrait that
 * stops at the waist leaves the skirt, the wrapper and the shoes to the
 * model's imagination, and the imagination changes between shots.
 */
export function characterReferencePrompt(look: string): string {
  return [
    `Exactly one person in frame. ${look.trim()}`,
    "A full-length reference photograph of this person, head to toe: the top of the headwear and the soles of the feet are both inside the frame.",
    "The whole body is visible, standing upright, facing the camera straight on, arms relaxed at the sides, standing still.",
    "The COMPLETE costume is shown and readable: the headwear, every garment, its colour, its pattern, its fabric, how it is tied, and the footwear.",
    "Even soft light, plain neutral background, sharp focus, no shadow on the background.",
    "No text, no lettering, no logos."
  ].join(" ");
}

/**
 * Make sure every character in the book has ONE reference image.
 *
 * The image is generated once, mirrored to R2 so it never expires, and stored
 * on the ShotCharacter row. Later calls reuse it.
 */
export async function ensureCharacterReferences(
  bookId: string,
  deps: ShotRenderDeps = defaultShotRenderDeps(),
  prefix = `books/${bookId}/shot-characters`
): Promise<Map<string, string>> {
  const characters = await deps.prisma.shotCharacter.findMany({
    where: { bookId },
    orderBy: { order: "asc" }
  });
  const map = new Map<string, string>();
  for (const character of characters) {
    if (character.referenceImageUrl) {
      map.set(character.roleLabel, character.referenceImageUrl);
      continue;
    }
    // A portrait reference: the face is what subject_reference locks on to.
    const rawUrl = await deps.generateStill(characterReferencePrompt(character.look), "9:16", []);
    const stamp = Date.now().toString(36);
    const slug = character.roleLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const stored = await deps.mirrorToR2(
      rawUrl,
      `${prefix}/${slug}-${stamp}.png`,
      "image/png",
      5,
      posterTransform()
    );
    await deps.prisma.shotCharacter.update({
      where: { id: character.id },
      data: { referenceImageUrl: stored.url }
    });
    map.set(character.roleLabel, stored.url);
  }
  return map;
}

/** The reference images for the characters listed on a shot. */
export function referencesFor(
  charactersInFrame: string[],
  references: Map<string, string>
): ReferenceImage[] {
  const out: ReferenceImage[] = [];
  for (const roleLabel of charactersInFrame) {
    const uri = references.get(roleLabel);
    if (!uri) continue;
    out.push({ uri, tag: "ref1" });
  }
  // MiniMax image-01 only accepts ONE subject reference.
  return out.slice(0, 1);
}

/* --------------------------------------------------------------------- *
 * Rendering one shot
 * --------------------------------------------------------------------- */

export interface RenderedShot {
  shotId: string;
  order: number;
  videoUrl: string;
  posterUrl: string;
  /** The last frame of the previous clip, when this shot was chained onto it. */
  chainedFrameUrl?: string | null;
}

/**
 * Render one shot: the first frame, then the clip that starts from it.
 *
 * A NEW SETUP generates its own first-frame still, with the character's
 * reference image attached, so the clip opens on the same person the bible
 * describes.
 *
 * A CONTINUATION does not. It is filmed from the LAST FRAME of the clip
 * before it, so the costume, the face and the light carry over from shot to
 * shot instead of being re-invented. That is the whole point of the chain.
 */
export async function renderShot(input: {
  shot: {
    id: string;
    order: number;
    shotPrompt: string;
    stillPrompt: string;
    durationSeconds: number;
    charactersInFrame: string[];
    /** True when this shot continues the shot before it on the same page. */
    continuesPrevious?: boolean;
  };
  pageNum: number;
  prefix: string;
  references: Map<string, string>;
  /** The finished clip of the shot before this one on the same page. */
  previousClipUrl?: string | null;
  /** Avoid-list appended to the first-frame prompt. Ignored for a chained
   *  continuation, which has no new still. */
  negativePrompt?: string | null;
  deps?: ShotRenderDeps;
}): Promise<RenderedShot> {
  const deps = input.deps ?? defaultShotRenderDeps();
  const stamp = Date.now().toString(36);
  const base = `${input.prefix}/shots/p${input.pageNum}-s${input.shot.order}`;

  const references = referencesFor(input.shot.charactersInFrame, input.references);

  // THE CHAIN. A continuation opens on the last frame of the previous clip,
  // so no new still is generated for it at all.
  let firstFrameUrl: string;
  let posterUrl: string;
  let chainedFrameUrl: string | null = null;

  if (input.shot.continuesPrevious && input.previousClipUrl) {
    const extract = deps.extractLastFrame ?? defaultExtractLastFrame;
    const frame = await extract(input.previousClipUrl);
    if (frame) {
      const upload = deps.uploadAsset ?? defaultUploadAsset;
      const stored = await upload({
        key: `${base}-chain-${stamp}.png`,
        body: frame.body,
        contentType: frame.contentType || "image/png"
      });
      chainedFrameUrl = stored.url;
      firstFrameUrl = stored.url;
      // The poster is the same frame, but a lighter one - the reader puts it
      // on a phone.
      const optimized = await optimizeImage(frame.body, { maxWidth: POSTER_MAX_WIDTH });
      const posterStored = await upload({
        key: optimizedKey(`${base}-chain-${stamp}.png`, optimized.extension),
        body: optimized.body,
        contentType: optimized.contentType
      });
      posterUrl = posterStored.url;
      console.log(`[shot-renderer] p${input.pageNum} s${input.shot.order}: chained onto the previous clip's last frame`);
    } else {
      console.warn(
        `[shot-renderer] p${input.pageNum} s${input.shot.order}: the previous clip's last frame could not be pulled; falling back to a new still`
      );
    }
  }

  if (!chainedFrameUrl) {
    const stillPrompt = input.negativePrompt
      ? `${input.shot.stillPrompt} Avoid: ${input.negativePrompt}.`
      : input.shot.stillPrompt;
    const rawStill = await deps.generateStill(stillPrompt, SHOT_STILL_RATIO, references);
    // The MiniMax still URL expires, so the poster has to be our own copy.
    const poster = await deps.mirrorToR2(
      rawStill,
      `${base}-${stamp}.png`,
      "image/png",
      5,
      posterTransform()
    );
    firstFrameUrl = rawStill;
    posterUrl = poster.url;
  }

  const rawClip = await deps.animateStill(
    firstFrameUrl,
    input.shot.shotPrompt,
    input.shot.durationSeconds,
    SHOT_VIDEO_RESOLUTION,
    SHOT_VIDEO_MODEL
  );

  const clip = await deps.mirrorToR2(
    rawClip,
    `${base}-${stamp}.mp4`,
    "video/mp4",
    5,
    videoTransform()
  );

  return {
    shotId: input.shot.id,
    order: input.shot.order,
    videoUrl: clip.url,
    posterUrl,
    chainedFrameUrl
  };
}

/* --------------------------------------------------------------------- *
 * A page of shots, in order
 * --------------------------------------------------------------------- */

export interface PageShotsResult {
  rendered: number;
  failed: number;
  skipped: number;
}

/**
 * Render a page's shots IN ORDER.
 *
 * Order matters for two reasons. A continuation is filmed from the last frame
 * of the clip before it, so that clip has to exist first - and it has to be
 * the clip that was just rendered, not the one that was there before. And a
 * shot that is skipped still has to hand its clip to the shot after it, or
 * the chain breaks in the middle of the page.
 *
 * `onlyShotIds` renders just the shots named and leaves the rest of the page
 * exactly as it is - which is how one clip can be regenerated without paying
 * for the whole page again.
 */
export async function renderPageShots(input: {
  pageId: string;
  pageNum: number;
  prefix: string;
  /** The character's reference images, by role label. */
  references: Map<string, string>;
  /** Render shots that already have a clip as well. */
  force?: boolean;
  /** Render only these shot ids. Everything else keeps the clip it has. */
  onlyShotIds?: string[] | null;
  deps?: ShotRenderDeps;
}): Promise<PageShotsResult> {
  const deps = input.deps ?? defaultShotRenderDeps();
  const shots = await deps.prisma.shot.findMany({
    where: { pageId: input.pageId },
    orderBy: { order: "asc" }
  });

  const only = input.onlyShotIds ? new Set(input.onlyShotIds) : null;
  let rendered = 0;
  let failed = 0;
  let skipped = 0;
  // The clip of the shot before this one, as it is NOW - the freshly rendered
  // one when it was just rendered, the stored one when it was skipped.
  let previousVideoUrl: string | null = null;

  for (const shot of shots) {
    const wanted = !only || only.has(shot.id);
    const hasClip = Boolean(shot.videoUrl) && shot.status === "READY";
    // A shot that failed is not retried by a page job - it would be paid for
    // again without anyone asking. It can still be retried on purpose, by
    // naming it.
    const failedShot = shot.status === "FAILED" && !input.force;
    if (!wanted || failedShot || (!input.force && hasClip)) {
      skipped++;
      // A shot that is skipped still hands its clip to the shot after it, or
      // the chain breaks in the middle of the page.
      if (shot.videoUrl) previousVideoUrl = shot.videoUrl;
      continue;
    }

    try {
      const result = await renderShot({
        shot: {
          id: shot.id,
          order: shot.order,
          shotPrompt: shot.shotPrompt,
          stillPrompt: shot.stillPrompt,
          durationSeconds: shot.durationSeconds,
          charactersInFrame: shot.charactersInFrame,
          continuesPrevious: shot.continuesPrevious
        },
        pageNum: input.pageNum,
        prefix: input.prefix,
        references: input.references,
        previousClipUrl: shot.continuesPrevious ? previousVideoUrl : null,
        deps
      });
      await deps.prisma.shot.update({
        where: { id: shot.id },
        data: {
          videoUrl: result.videoUrl,
          posterUrl: result.posterUrl,
          chainedFrameUrl: result.chainedFrameUrl ?? null,
          provider: "minimax",
          status: "READY"
        }
      });
      previousVideoUrl = result.videoUrl;
      rendered++;
    } catch (err) {
      failed++;
      console.warn(`[shot-renderer] p${input.pageNum} s${shot.order}: ${(err as Error).message}`);
      await deps.prisma.shot.update({
        where: { id: shot.id },
        data: { status: "FAILED", errorMessage: (err as Error).message.slice(0, 400) }
      });
    }
  }

  return { rendered, failed, skipped };
}
