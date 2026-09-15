/**
 * ElevenLabs narration + WebVTT timing client.
 *
 * Real implementation would:
 *   1. POST /v1/text-to-speech/{voice_id} with the page text.
 *   2. Run Whisper large-v3 over the audio to get word-level timings.
 *   3. Return audio bytes + WebVTT string.
 *
 * When the API key is missing we return a graceful stub so the Studio can
 * still publish (the Reader uses SpeechSynthesis as the runtime fallback per
 * Constraint #6).
 */
import { appEnv, isFeatureEnabled } from "../config/env.js";

export interface NarrationResult {
  audioUrl: string;
  vttUrl: string;
  durationSeconds: number;
  source: "elevenlabs" | "stub";
}

const STUB_AUDIO = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
const STUB_VTT = `data:text/vtt;base64,VkVCRVQK`;

export async function generateNarration(input: { text: string; voiceId?: string }): Promise<NarrationResult> {
  if (!isFeatureEnabled("ELEVENLABS")) {
    return {
      audioUrl: STUB_AUDIO,
      vttUrl: STUB_VTT,
      durationSeconds: Math.max(1, Math.round(input.text.length / 16)),
      source: "stub"
    };
  }
  try {
    const voice = input.voiceId ?? "21m00Tcm4TlvDq8ikWAM";
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST",
      headers: {
        "xi-api-key": String(appEnv.ELEVENLABS_API_KEY),
        "Content-Type": "application/json",
        Accept: "audio/mpeg"
      },
      body: JSON.stringify({
        text: input.text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.45, similarity_boost: 0.7 }
      })
    });
    if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      audioUrl: `data:audio/mpeg;base64,${buffer.toString("base64")}`,
      vttUrl: STUB_VTT,
      durationSeconds: Math.max(1, Math.round(buffer.length / 32000)),
      source: "elevenlabs"
    };
  } catch (err) {
    console.warn(`[elevenlabs] ${(err as Error).message}, returning stub`);
    return {
      audioUrl: STUB_AUDIO,
      vttUrl: STUB_VTT,
      durationSeconds: Math.max(1, Math.round(input.text.length / 16)),
      source: "stub"
    };
  }
}

export const elevenlabsStatus = { live: isFeatureEnabled("ELEVENLABS") };