/**
 * Multi-language narration.
 *
 * Routes every language through the apps/api/src/services/ttsProvider.ts
 * selector. When `TTS_PROVIDER=minimax` (the new default), we send the
 * book text to MiniMax (Hailuo) `t2a_v2` with `language_boost` matching
 * the language code (so the right language model kicks in). When the env
 * falls back to `elevenlabs`, we keep the existing ElevenLabs Multilingual
 * v2 path.
 *
 * The page's `audioUrl` is regenerated with the requested locale.
 * Fallback order:
 *
 *   1. The book's `narrationLanguages` list (curated by the creator).
 *   2. The user's `LibraryEntry.narrationLanguage`.
 *   3. The book's `language`.
 *   4. "en".
 */
import { appEnv, currentTtsProvider } from "./ttsProvider.js";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "sw", label: "Kiswahili" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "ar", label: "العربية" },
  { code: "zh", label: "中文" },
  { code: "yo", label: "Yorùbá" },
  { code: "ig", label: "Igbo" },
  { code: "ha", label: "Hausa" }
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export function isLanguageSupported(code: string): code is LanguageCode {
  return SUPPORTED_LANGUAGES.some((lang) => lang.code === code);
}

export function resolveNarrationLanguage(opts: {
  bookLanguages: string[];
  userPreference?: string | null;
  fallback?: string;
}): LanguageCode {
  const candidates = [opts.userPreference, ...opts.bookLanguages, opts.fallback, "en"];
  for (const candidate of candidates) {
    if (candidate && isLanguageSupported(candidate)) return candidate;
  }
  return "en";
}

export interface NarrationResultLang {
  audioUrl: string;
  vttUrl: string;
  durationSeconds: number;
  language: LanguageCode;
  source: "minimax" | "elevenlabs" | "stub";
}

export async function generateNarrationInLanguage(input: {
  text: string;
  voiceId?: string;
  language: LanguageCode;
}): Promise<NarrationResultLang> {
  const tts = currentTtsProvider();
  if (tts === "minimax") {
    // MiniMax path: use the t2a_v2 endpoint through the selector.
    const { generateNarration } = await import("./ttsProvider.js");
    const result = await generateNarration({
      text: input.text,
      voiceId: input.voiceId ?? "English_expressive_narrator",
      languageBoost: input.language === "en" ? "English" : input.language,
      strict: false
    });
    if (result.audioUrl) {
      return {
        audioUrl: result.audioUrl,
        vttUrl: result.vttUrl ?? `data:text/vtt;base64,${Buffer.from("WEBVTT\n\n").toString("base64")}`,
        durationSeconds: result.durationSeconds,
        language: input.language,
        source: result.source === "minimax" ? "minimax" : "stub"
      };
    }
    return {
      audioUrl: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=",
      vttUrl: "data:text/vtt;base64,VkVCRVQK",
      durationSeconds: Math.max(1, Math.round(input.text.length / 16)),
      language: input.language,
      source: "stub"
    };
  }
  // ElevenLabs path — preserved from the pre-migration code.
  if (!appEnv.ELEVENLABS_API_KEY) {
    return {
      audioUrl: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=",
      vttUrl: "data:text/vtt;base64,VkVCRVQK",
      durationSeconds: Math.max(1, Math.round(input.text.length / 16)),
      language: input.language,
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
        voice_settings: { stability: 0.45, similarity_boost: 0.7 },
        language_code: input.language
      })
    });
    if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      audioUrl: `data:audio/mpeg;base64,${buffer.toString("base64")}`,
      vttUrl: "data:text/vtt;base64,VkVCRVQK",
      durationSeconds: Math.max(1, Math.round(buffer.length / 32000)),
      language: input.language,
      source: "elevenlabs"
    };
  } catch (err) {
    console.warn(`[narration] ${(err as Error).message}, returning stub`);
    return {
      audioUrl: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=",
      vttUrl: "data:text/vtt;base64,VkVCRVQK",
      durationSeconds: Math.max(1, Math.round(input.text.length / 16)),
      language: input.language,
      source: "stub"
    };
  }
}
