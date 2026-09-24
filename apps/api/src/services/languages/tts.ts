/**
 * AnimBook Languages — TTS adapter (Patch 12).
 *
 * Spec § 6 mandates a `TtsProvider` interface so ElevenLabs can later be
 * swapped for an open-source model (e.g. XTTS) without touching the
 * pipeline. The audio narration worker + the admin "regenerate audio"
 * route both call through this seam.
 *
 * Today the only adapter is `ElevenLabsTtsProvider`, a thin wrapper
 * around the existing `generateNarration()` in `services/elevenlabs.ts`.
 * The wrapper:
 *
 *   1. Resolves the language's `tts_voice_ids` JSON to pick a voice
 *      (narrator for `speaker === "narrator"`, character voice otherwise
 *      via the line's scene context).
 *   2. Generates the audio bytes via ElevenLabs + uploads to R2.
 *   3. Returns the storage URL + character count + a `source` flag so the
 *      caller knows whether real audio was produced or a stub was used.
 *
 * `resolveTtsProvider()` returns a noop stub when the keys are absent so
 * tests + dev don't crash.
 */
import { prisma } from "../../db.js";
import { generateNarration } from "../elevenlabs.js";

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
}

export interface TtsSynthesizeResult {
  audioUrl: string | null;
  /** Word timings aligned to tokens (future — Patch 12 ships null). */
  wordTimings: Array<{ token: string; startMs: number; endMs: number }> | null;
  characters: number;
  source: "elevenlabs" | "stub";
}

export interface TtsProvider {
  readonly name: string;
  isConfigured(): boolean;
  synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult>;
}

/* --------------------------------------------------------------------- *
 * ElevenLabs adapter
 * --------------------------------------------------------------------- */

class ElevenLabsTtsProvider implements TtsProvider {
  readonly name = "elevenlabs";

  isConfigured(): boolean {
    return Boolean(process.env.ELEVENLABS_API_KEY);
  }

  async synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult> {
    if (!this.isConfigured()) {
      if (input.strict) throw new Error("ElevenLabs is not configured (set ELEVENLABS_API_KEY).");
      return { audioUrl: null, wordTimings: null, characters: 0, source: "stub" };
    }
    const result = await generateNarration({
      text: input.text,
      voiceId: input.voiceId ?? null,
      storageKey: input.storageKey,
      strict: input.strict ?? false
    });
    return {
      audioUrl: result.audioUrl,
      wordTimings: null,
      characters: result.characters,
      source: result.source === "elevenlabs" ? "elevenlabs" : "stub"
    };
  }
}

/* --------------------------------------------------------------------- *
 * resolveTtsProvider
 * --------------------------------------------------------------------- */

/**
 * Pick a provider. Today there's only ElevenLabs. The seam exists so a
 * future XTTS / Azure / open-source swap is one factory line.
 */
export function resolveTtsProvider(): TtsProvider {
  if (process.env.ELEVENLABS_API_KEY) return new ElevenLabsTtsProvider();
  return {
    name: "noop",
    isConfigured: () => false,
    synthesize: async () => ({
      audioUrl: null,
      wordTimings: null,
      characters: 0,
      source: "stub"
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
