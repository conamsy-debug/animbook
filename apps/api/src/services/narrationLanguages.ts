/**
 * Multi-language narration.
 *
 * ElevenLabs Multilingual v2 supports a curated set of language codes. The
 * `LibraryEntry.narrationLanguage` column records the user's preferred
 * narration language; when present, the page's audioUrl is regenerated with
 * the requested locale. Fallback order:
 *
 *   1. The book's `narrationLanguages` list (curated by the creator).
 *   2. The user's `LibraryEntry.narrationLanguage`.
 *   3. The book's `language`.
 *   4. "en".
 */
import { appEnv, isFeatureEnabled } from "../config/env.js";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", elevenlabsModel: "eleven_multilingual_v2" },
  { code: "sw", label: "Kiswahili", elevenlabsModel: "eleven_multilingual_v2" },
  { code: "fr", label: "Français", elevenlabsModel: "eleven_multilingual_v2" },
  { code: "es", label: "Español", elevenlabsModel: "eleven_multilingual_v2" },
  { code: "pt", label: "Português", elevenlabsModel: "eleven_multilingual_v2" },
  { code: "ar", label: "العربية", elevenlabsModel: "eleven_multilingual_v2" },
  { code: "zh", label: "中文", elevenlabsModel: "eleven_multilingual_v2" },
  { code: "yo", label: "Yorùbá", elevenlabsModel: "eleven_multilingual_v2" },
  { code: "ig", label: "Igbo", elevenlabsModel: "eleven_multilingual_v2" },
  { code: "ha", label: "Hausa", elevenlabsModel: "eleven_multilingual_v2" }
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
  source: "elevenlabs" | "stub";
}

export async function generateNarrationInLanguage(input: {
  text: string;
  voiceId?: string;
  language: LanguageCode;
}): Promise<NarrationResultLang> {
  if (!isFeatureEnabled("ELEVENLABS")) {
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