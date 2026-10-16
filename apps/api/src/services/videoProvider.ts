/**
 * VIDEO_PROVIDER selector.
 *
 *   `VIDEO_PROVIDER = minimax` (default) → routes to apps/api/src/services/minimax-video.ts
 *   `VIDEO_PROVIDER = runway`            → routes to apps/api/src/services/runway.ts
 *
 * Keeping Runway in the tree as a fallback lets us flip back in seconds if
 * MiniMax's reliability dips, without redeploying code. The selector is
 * pure read-only: it does not import model-side modules twice (we import
 * both, then call the matching one at call-site based on the env).
 *
 * Pipeline callers import `generateClip`, `generateStill`, `animateStill`
 * and `generateStillWithFaces` from this file, exactly the same way they
 * previously imported them from `./runway.js`. The selector keeps the
 * identical return shapes so callers can stay byte-identical.
 *
 * `currentProvider()` is the single source of truth for "which provider am
 * I on right now?" — used by apps/api/src/modules/books/routes.ts to expose
 * the live state to the Studio UI and by tests to assert routing.
 */
import * as runway from "./runway.js";
import * as minimax from "./minimax-video.js";
import { appEnv, isFeatureEnabled } from "../config/env.js";

export type VideoProviderId = "minimax" | "runway";

export interface ClipDescriptor {
  /** What resolution + duration + model would a default clip use right now,
   *  so the UI doesn't have to special-case the provider. */
  resolution: string;
  durationSeconds: number;
  isFast: boolean;
  costUsd: number;
}

function readProvider(): VideoProviderId {
  const raw = (process.env.VIDEO_PROVIDER ?? "minimax").toLowerCase().trim();
  if (raw === "runway") return "runway";
  return "minimax";
}

/** Public-facing runtime selector. Defaults to "minimax". Honors the env
 *  immediately on next read — no cache, so flipping VIDEO_PROVIDER on a
 *  live host picks the new provider on the next job. */
export function currentProvider(): VideoProviderId {
  return readProvider();
}

/** True if the active provider is configured (has its key). We still
 *  respect VIDEO_PROVIDER even if the chosen provider is unconfigured —
 *  the underlying service then returns the stub shape, matching the
 *  pre-migration behaviour. */
export function activeProviderLive(): boolean {
  if (readProvider() === "runway") return isFeatureEnabled("RUNWAY");
  return isFeatureEnabled("MINIMAX_VIDEO");
}

/** Accepts either a Runway ratio ("1280:720", "720:1280", "960:960") OR a
 *  MiniMax resolution ("768P", "1080P"). Pipeline callers keep their
 *  pre-migration string; we translate per provider. */
export type AnyResolution = runway.RunwayRatio | "768P" | "1080P";

/* --------------------------------------------------------------------- *
 * Re-exports — identical surface, same names, dispatched at call time.
 * --------------------------------------------------------------------- */

export async function generateStill(
  prompt: string,
  ratio: string = "16:9",
  references: runway.ReferenceImage[] = [],
  options: { attempts?: number } = {}
): Promise<string> {
  if (readProvider() === "runway") {
    return await runway.generateStill(prompt, ratio, references, options);
  }
  return await minimax.generateStill(prompt, ratio, references as unknown as minimax.ReferenceImage[], options);
}

export async function animateStill(
  imageUrl: string,
  motionPrompt: string,
  durationSeconds = 6,
  resolution: AnyResolution = "768P"
): Promise<string> {
  if (readProvider() === "runway") {
    return await runway.animateStill(imageUrl, motionPrompt, durationSeconds, resolution as runway.RunwayRatio);
  }
  const minimaxRes: minimax.MinimaxResolution = resolution === "1080P" ? "1080P" : "768P";
  return await minimax.animateStill(imageUrl, motionPrompt, durationSeconds, minimaxRes);
}

export async function generateStillWithFaces(
  prompt: string,
  fallbackPrompt: string,
  shape: "wide" | "tall",
  references: runway.ReferenceImage[]
): Promise<{ url: string; facesLocked: boolean }> {
  if (readProvider() === "runway") {
    return await runway.generateStillWithFaces(prompt, fallbackPrompt, shape, references);
  }
  return await minimax.generateStillWithFaces(prompt, fallbackPrompt, shape, references as unknown as minimax.ReferenceImage[]);
}

export async function generateClip(
  input: runway.RunwayJobInput
): Promise<runway.RunwayJobResult> {
  if (readProvider() === "runway") {
    return await runway.generateClip(input);
  }
  // Provider-aware alias — Runway passes the same RunwayJobInput shape;
  // MiniMax's input adds a `resolution` field that defaults to "768P".
  return (await minimax.generateClip(input as unknown as minimax.MinimaxJobInput)) as unknown as runway.RunwayJobResult;
}

export function estimateClipCredits(durationSeconds = 6): number {
  if (readProvider() === "runway") return runway.estimateClipCredits(durationSeconds);
  return minimax.estimateClipCredits(durationSeconds);
}

export function clipDescriptor(durationSeconds: number = 6): ClipDescriptor {
  if (readProvider() === "runway") {
    return {
      resolution: "1280:720",
      durationSeconds,
      isFast: false,
      costUsd: runway.estimateClipCredits(durationSeconds)
    };
  }
  return {
    resolution: minimax.minimaxStatus.defaultResolution,
    durationSeconds: minimax.minimaxStatus.defaultDurationSeconds,
    isFast: minimax.minimaxStatus.isFast,
    costUsd: minimax.minimaxStatus.estimatedPerClipUsd
  };
}

/* --------------------------------------------------------------------- *
 * Errors re-exported so callers can `catch MinimaxError` OR `RunwayError`
 * regardless of the active provider, plus a unified discriminated-union
 * marker for app-level routing errors.
 * --------------------------------------------------------------------- */

export const MinimaxError = minimax.MinimaxError;
export const RunwayError = runway.RunwayError;

export const videoProviderStatus = {
  provider: readProvider(),
  live: activeProviderLive(),
  runway: isFeatureEnabled("RUNWAY"),
  minimax: isFeatureEnabled("MINIMAX_VIDEO"),
  // Mirror the env so the API never has to query the env directly when
  // surfacing provider-specific knobs.
  defaultVideoModel: appEnv.MINIMAX_VIDEO_MODEL,
  defaultImageModel: appEnv.MINIMAX_IMAGE_MODEL
} as const;
