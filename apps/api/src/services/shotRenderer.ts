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
import { posterTransform, videoTransform } from "./mediaPostProcess.js";
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
}

export function defaultShotRenderDeps(): ShotRenderDeps {
  return {
    prisma: defaultPrisma,
    generateStill: defaultGenerateStill as ShotRenderDeps["generateStill"],
    animateStill: defaultAnimateStill as unknown as ShotRenderDeps["animateStill"],
    mirrorToR2: defaultMirrorToR2 as unknown as ShotRenderDeps["mirrorToR2"]
  };
}

/* --------------------------------------------------------------------- *
 * The character reference image
 * --------------------------------------------------------------------- */

/**
 * The prompt for a character's ONE reference image.
 *
 * A plain, evenly lit portrait gives the model the least to reinterpret, and
 * the same image is then attached to every first-frame still the character
 * appears in, so she is the same person in shot 1 and shot 40.
 */
export function characterReferencePrompt(look: string): string {
  return [
    `Exactly one person in frame. ${look.trim()}`,
    "A plain reference portrait of this person, waist up, facing the camera, neutral expression, standing still.",
    "Even soft light, plain neutral background, sharp focus on the face.",
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
}

/**
 * Render one shot: the first-frame still, then the clip that starts from it.
 *
 * The still is generated with the character's reference image attached, so the
 * clip's opening frame is the same person the bible describes. The still is
 * mirrored to R2 and kept as the shot's poster; the clip is mirrored with the
 * faststart/C2PA transform.
 */
export async function renderShot(input: {
  shot: {
    id: string;
    order: number;
    shotPrompt: string;
    stillPrompt: string;
    durationSeconds: number;
    charactersInFrame: string[];
  };
  pageNum: number;
  prefix: string;
  references: Map<string, string>;
  deps?: ShotRenderDeps;
}): Promise<RenderedShot> {
  const deps = input.deps ?? defaultShotRenderDeps();
  const stamp = Date.now().toString(36);
  const base = `${input.prefix}/shots/p${input.pageNum}-s${input.shot.order}`;

  const references = referencesFor(input.shot.charactersInFrame, input.references);
  const rawStill = await deps.generateStill(input.shot.stillPrompt, SHOT_STILL_RATIO, references);

  // The MiniMax still URL expires, so the poster has to be our own copy.
  const poster = await deps.mirrorToR2(
    rawStill,
    `${base}-${stamp}.png`,
    "image/png",
    5,
    posterTransform()
  );

  const rawClip = await deps.animateStill(
    rawStill,
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
    posterUrl: poster.url
  };
}
