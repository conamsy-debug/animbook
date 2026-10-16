/**
 * TTS_PROVIDER selector.
 *
 *   `TTS_PROVIDER = minimax` (default) → routes to apps/api/src/services/minimax-speech.ts
 *   `TTS_PROVIDER = elevenlabs`         → routes to apps/api/src/services/elevenlabs.ts
 *
 * Selection is read fresh each call so flipping the env var on the live
 * host swaps the active TTS path with no restart. Each function below
 * dispatches at call-site through the matching module.
 *
 * The clone flow (`account-voice/routes.ts`) is intentionally NOT routed
 * through this selector — author voice cloning stays on ElevenLabs until
 * MiniMax parity lands (see Migration brief § 2 — "leave the author
 * voice-clone feature on ElevenLabs for now; it's a later step").
 */
import * as elevenlabs from "./elevenlabs.js";
import * as minimax from "./minimax-speech.js";
import { appEnv, isFeatureEnabled } from "../config/env.js";

// Re-export `appEnv` so legacy modules (narrationLanguages) that previously
// imported it from `./ttsProvider.js` keep compiling without an import-path
// rewrite. New code should pull `appEnv` from `../config/env.js` directly.
export { appEnv };

export type TtsProviderId = "minimax" | "elevenlabs";

function readProvider(): TtsProviderId {
  const raw = (process.env.TTS_PROVIDER ?? "minimax").toLowerCase().trim();
  if (raw === "elevenlabs") return "elevenlabs";
  return "minimax";
}

export function currentTtsProvider(): TtsProviderId {
  return readProvider();
}

export function activeTtsProviderLive(): boolean {
  if (readProvider() === "elevenlabs") return isFeatureEnabled("ELEVENLABS");
  return isFeatureEnabled("MINIMAX_TTS");
}

/* The shared result shape — both modules produce the same field set. */
export type { NarrationResult, SynthesisOptions } from "./elevenlabs.js";
export { VoiceOrphanedError } from "./minimax-speech.js";

export async function synthesizeSpeech(text: string, voiceId: string): Promise<Buffer> {
  if (readProvider() === "elevenlabs") {
    return elevenlabs.synthesizeSpeech(text, voiceId);
  }
  return minimax.synthesizeSpeech(text, voiceId, { text, voiceId });
}

export async function generateNarration(input: elevenlabs.SynthesisOptions): Promise<elevenlabs.NarrationResult> {
  if (readProvider() === "elevenlabs") {
    return elevenlabs.generateNarration(input);
  }
  // Both modules return the same NarrationResult shape (post-widening of the
  // `source` union to include "minimax"); cast through `unknown` only to keep
  // the call signature tied to elevenlabs.SynthesisOptions.
  return (await minimax.generateNarration({
    voiceId: input.voiceId ?? "",
    text: input.text,
    storageKey: input.storageKey,
    strict: input.strict
  })) as unknown as elevenlabs.NarrationResult;
}

export async function listVoices() {
  if (readProvider() === "elevenlabs") {
    return elevenlabs.listVoices();
  }
  return minimax.listVoices();
}

export async function characterQuota() {
  if (readProvider() === "elevenlabs") {
    return elevenlabs.characterQuota();
  }
  return minimax.characterQuota();
}

export async function markVoiceOrphaned(userId: string, voiceId: string) {
  if (readProvider() === "elevenlabs") {
    return elevenlabs.markVoiceOrphaned(userId, voiceId);
  }
  return minimax.markVoiceOrphaned(userId, voiceId);
}

/* Re-export error classes so callers can `catch` without import-knowledge. */
export const MinimaxSpeechError = minimax.MinimaxSpeechError;

export const ttsProviderStatus = {
  provider: readProvider(),
  live: activeTtsProviderLive(),
  elevenlabs: isFeatureEnabled("ELEVENLABS"),
  minimax: isFeatureEnabled("MINIMAX_TTS"),
  defaultModel: appEnv.MINIMAX_TTS_MODEL
} as const;
