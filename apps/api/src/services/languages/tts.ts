/**
 * AnimBook Languages — TTS adapter (Patch 12).
 *
 * Spec § 6 mandates a `TtsProvider` interface so ElevenLabs can later be
 * swapped for an open-source model (e.g. XTTS) without touching the
 * pipeline. The audio narration worker + the admin "regenerate audio"
 * route both call through this seam.
 *
 * Today the only adapters are `ElevenLabsTtsProvider` (fallback) and
 * `MinimaxTtsProvider` (default, post-MiniMax-migration). Both are
 * thin wrappers around the existing `generateNarration()` in
 * `services/ttsProvider.ts`, which dispatches to the right provider.
 * The wrappers:
 *
 *   1. Resolve the language's `tts_voice_ids` JSON to pick a voice
 *      (narrator for `speaker === "narrator"`, character voice otherwise
 *      via the line's scene context).
 *   2. Generate the audio bytes + upload to R2.
 *   3. Return the storage URL + character count + a `source` flag so the
 *      caller knows whether real audio was produced or a stub was used.
 *
 * `resolveTtsProvider()` dispatches by `TTS_PROVIDER` env (default `minimax`)
 * and falls back to a noop stub when the keys are absent so tests + dev don't
 * crash.
 */
import { prisma } from "../../db.js";
import { generateNarration as ttsGenerateNarration, currentTtsProvider as _tts } from "../ttsProvider.js";

/* --------------------------------------------------------------------- *
 * Provider interface
 * --------------------------------------------------------------------- */

export interface TtsSynthesizeInput {
  text: string;
  voiceId?: string | null;
  /** Storage key inside R2 (e.g. `lang-audio/es/<lineId>.mp3`). */
  storageKey: string;
  /** When true, throw on failure instead of returning a stub. */
  strict?: boolean;
  /** Pass-through sent to MiniMax TTS (no-op for ElevenLabs). */
  languageBoost?: string;
}

export interface TtsSynthesizeResult {
  audioUrl: string | null;
  /** Word timings aligned to tokens (future — Patch 12 ships null). */
  wordTimings: Array<{ token: string; startMs: number; endMs: number }> | null;
  characters: number;
  source: "minimax" | "elevenlabs" | "stub";
  /**
   * When `source === "stub"`, a short reason ("TTS provider not configured",
   * "401: ...", "TTS provider or R2 is not configured", ...).
   * Empty string on the success path. Carried up so admin callers can
   * show the real failure instead of guessing.
   */
  error: string;
}

export interface TtsProvider {
  readonly name: string;
  isConfigured(): boolean;
  synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult>;
}

/* --------------------------------------------------------------------- *
 * ElevenLabs adapter (fallback — TTS_PROVIDER=elevenlabs)
 * --------------------------------------------------------------------- */

class ElevenLabsTtsProvider implements TtsProvider {
  readonly name = "elevenlabs";

  isConfigured(): boolean {
    return Boolean(process.env.ELEVENLABS_API_KEY);
  }

  async synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult> {
    if (!this.isConfigured()) {
      if (input.strict) throw new Error("ElevenLabs is not configured (set ELEVENLABS_API_KEY).");
      return {
        audioUrl: null,
        wordTimings: null,
        characters: 0,
        source: "stub",
        error: "ElevenLabs is not configured (set ELEVENLABS_API_KEY)"
      };
    }
    const result = await ttsGenerateNarration({
      text: input.text,
      voiceId: input.voiceId ?? null,
      storageKey: input.storageKey,
      strict: input.strict ?? false
    });
    return {
      audioUrl: result.audioUrl,
      wordTimings: null,
      characters: result.characters,
      source: result.source === "elevenlabs" ? "elevenlabs" : "stub",
      error: result.error
    };
  }
}

/* --------------------------------------------------------------------- *
 * MiniMax (Hailuo) adapter (default — TTS_PROVIDER=minimax)
 * --------------------------------------------------------------------- */

class MinimaxTtsProvider implements TtsProvider {
  readonly name = "minimax";

  isConfigured(): boolean {
    // MiniMax TTS shares the MINIMAX_API_KEY with the video path.
    return Boolean(process.env.MINIMAX_API_KEY);
  }

  async synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult> {
    if (!this.isConfigured()) {
      if (input.strict) throw new Error("TTS provider is not configured (set MINIMAX_API_KEY or TTS_PROVIDER=elevenlabs).");
      return {
        audioUrl: null,
        wordTimings: null,
        characters: 0,
        source: "stub",
        error: "TTS provider is not configured (set MINIMAX_API_KEY)"
      };
    }
    const result = await ttsGenerateNarration({
      text: input.text,
      voiceId: input.voiceId ?? null,
      storageKey: input.storageKey,
      languageBoost: input.languageBoost,
      strict: input.strict ?? false
    });
    return {
      audioUrl: result.audioUrl,
      wordTimings: null,
      characters: result.characters,
      source: result.source === "minimax" ? "minimax" : "stub",
      error: result.error
    };
  }
}

/* --------------------------------------------------------------------- *
 * resolveTtsProvider
 * --------------------------------------------------------------------- */

/**
 * Pick a provider by `TTS_PROVIDER`. MiniMax (Hailuo) is the new default.
 * The "noop" fallback handles the case where neither provider is configured.
 */
export function resolveTtsProvider(): TtsProvider {
  if (_tts() === "minimax") return new MinimaxTtsProvider();
  if (process.env.ELEVENLABS_API_KEY) return new ElevenLabsTtsProvider();
  // Last-ditch: try the minimax fallback too. Minimax wins if both keys
  // are set, since that's the env default.
  if (process.env.MINIMAX_API_KEY) return new MinimaxTtsProvider();
  return {
    name: "noop",
    isConfigured: () => false,
    synthesize: async () => ({
      audioUrl: null,
      wordTimings: null,
      characters: 0,
      source: "stub",
      error: "TTS provider is not configured (set MINIMAX_API_KEY and/or ELEVENLABS_API_KEY)"
    })
  };
}

/* --------------------------------------------------------------------- *
 * Voice lookup helper
 * --------------------------------------------------------------------- */

/**
 * Read `language.tts_voice_ids` for a target language and pick the right
 * voice id for the line's speaker. JSON shape:
 *
 *   {
 *     "narrator": "<voice_id>",
 *     "characters": { "<speaker_key>": "<voice_id>" }
 *   }
 *
 * Falls back to the narrator voice if no character-specific voice is
 * configured. Returns null when the language has no voices configured
 * (Patch 12 dev path — ElevenLabs picks its default).
 */
export async function pickVoiceForSpeaker(
  targetLang: string,
  speaker: string
): Promise<string | null> {
  const row = await prisma.language.findUnique({
    where: { code: targetLang },
    select: { ttsVoiceIds: true }
  });
  if (!row) return null;
  const voices = (row.ttsVoiceIds ?? {}) as {
    narrator?: string;
    characters?: Record<string, string>;
  };
  if (speaker === "narrator") return voices.narrator ?? null;
  return voices.characters?.[speaker] ?? voices.narrator ?? null;
}
