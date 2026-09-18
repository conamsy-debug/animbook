/**
 * ElevenLabs narration client.
 *
 * Narration is saved to Cloudflare R2 as an MP3 and the page stores its
 * public URL (the Reader plays it with the page's video). When ElevenLabs or
 * R2 isn't configured we return an empty result and the Reader falls back to
 * the browser's built-in voice.
 *
 * Voice: pass voiceId, or set ELEVENLABS_NARRATOR_VOICE_ID, else ElevenLabs'
 * stock "Rachel" voice is used.
 */
import { appEnv, isFeatureEnabled } from "../config/env.js";
import { uploadAsset } from "./cloudflare.js";

const API = "https://api.elevenlabs.io/v1";
const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";
const MODEL = "eleven_multilingual_v2";

export interface NarrationResult {
  audioUrl: string | null;
  vttUrl: string | null;
  characters: number;
  source: "elevenlabs" | "stub";
}

export interface ElevenVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
}

function key(): string {
  return String(appEnv.ELEVENLABS_API_KEY);
}

export function narratorVoiceId(explicit?: string | null): string {
  return explicit || process.env.ELEVENLABS_NARRATOR_VOICE_ID || DEFAULT_VOICE;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Text → MP3 bytes. Retries rate limits, server errors and network drops. */
export async function synthesizeSpeech(text: string, voiceId?: string | null): Promise<Buffer> {
  const voice = narratorVoiceId(voiceId);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${API}/text-to-speech/${voice}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": key(), "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
          text,
          model_id: MODEL,
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true }
        })
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      const detail = await res.text().catch(() => "");
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
      }
      lastErr = new Error(`ElevenLabs ${res.status}`);
    } catch (err) {
      if ((err as Error).message.startsWith("ElevenLabs 4")) throw err;
      lastErr = err;
    }
    await sleep(Math.min(30_000, 3_000 * 2 ** attempt));
  }
  throw lastErr;
}

/** Voices available to this ElevenLabs account (including library voices added to "My Voices"). */
export async function listVoices(): Promise<ElevenVoice[]> {
  const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": key() } });
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}`);
  return ((await res.json()) as { voices: ElevenVoice[] }).voices;
}

/** Remaining character quota, when the key is allowed to read it. */
export async function characterQuota(): Promise<{ used: number; limit: number } | null> {
  try {
    const res = await fetch(`${API}/user/subscription`, { headers: { "xi-api-key": key() } });
    if (!res.ok) return null;
    const json = (await res.json()) as { character_count: number; character_limit: number };
    return { used: json.character_count, limit: json.character_limit };
  } catch {
    return null;
  }
}

/**
 * Narrate one page and store it in R2 under `storageKey` (an .mp3 path).
 * `strict` throws instead of returning an empty stub.
 */
export async function generateNarration(input: {
  text: string;
  voiceId?: string | null;
  storageKey?: string;
  strict?: boolean;
}): Promise<NarrationResult> {
  const text = input.text.trim();
  if (!isFeatureEnabled("ELEVENLABS") || !isFeatureEnabled("CLOUDFLARE") || !text) {
    if (input.strict) throw new Error("ElevenLabs or R2 is not configured");
    return { audioUrl: null, vttUrl: null, characters: 0, source: "stub" };
  }
  try {
    const audio = await synthesizeSpeech(text, input.voiceId);
    const storageKey = input.storageKey ?? `narration/misc/${Date.now().toString(36)}.mp3`;
    const stored = await uploadAsset({ key: storageKey, body: audio, contentType: "audio/mpeg" });
    return { audioUrl: stored.url, vttUrl: null, characters: text.length, source: "elevenlabs" };
  } catch (err) {
    if (input.strict) throw err;
    console.warn(`[elevenlabs] ${(err as Error).message}, no narration stored`);
    return { audioUrl: null, vttUrl: null, characters: 0, source: "stub" };
  }
}

/**
 * Clone an author voice from one or more audio samples.
 * Posts multipart/form-data to /v1/voices/add (ElevenLabs Instant Voice Cloning).
 * Returns the new voice_id. Caller is responsible for storing it on users.narrator_voice_id.
 *
 * ElevenLabs limits: up to ~25 samples per voice, each up to ~10MB. We
 * accept any audio/* mime and concat before sending if more than one.
 */
export interface VoiceCloneInput {
  name: string;
  description?: string;
  labels?: Record<string, string>;
  /**
   * One or more audio files. Caller is responsible for validating that the
   * speaker has consented to cloning (see users.voice_consent_at).
   */
  samples: { buffer: Buffer; filename: string; contentType: string }[];
}

export async function cloneVoiceFromSamples(input: VoiceCloneInput): Promise<{ voiceId: string }> {
  if (!isFeatureEnabled("ELEVENLABS")) throw new Error("ElevenLabs not configured");
  if (!input.samples.length) throw new Error("At least one audio sample is required");
  for (const s of input.samples) {
    if (s.buffer.byteLength === 0) throw new Error("An audio sample is empty");
    if (s.buffer.byteLength > 12 * 1024 * 1024) throw new Error("Each audio sample must be ≤12MB");
  }
  const form = new FormData();
  form.set("name", input.name.slice(0, 100));
  if (input.description) form.set("description", input.description.slice(0, 500));
  for (const s of input.samples) {
    // Buffer extends Uint8Array so cast is safe; the DOM lib's BlobPart type
    // is stricter than what Node provides at the moment.
    form.append("files", new Blob([s.buffer as unknown as ArrayBuffer], { type: s.contentType }), s.filename);
  }
  if (input.labels) {
    for (const [k, v] of Object.entries(input.labels)) form.set(`labels[${k}]`, v);
  }
  const res = await fetch(`${API}/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": key() },
    body: form
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs voice clone ${res.status}: ${detail.slice(0, 400)}`);
  }
  const json = (await res.json()) as { voice_id?: string };
  if (!json.voice_id) throw new Error("ElevenLabs did not return a voice_id");
  return { voiceId: json.voice_id };
}

/**
 * Delete a previously cloned voice. Safe to call on a non-existent id —
 * ElevenLabs returns 404 which we swallow so DELETE is idempotent.
 */
export async function deleteClonedVoice(voiceId: string): Promise<void> {
  if (!isFeatureEnabled("ELEVENLABS")) return;
  try {
    const res = await fetch(`${API}/voices/${encodeURIComponent(voiceId)}`, {
      method: "DELETE",
      headers: { "xi-api-key": key() }
    });
    if (!res.ok && res.status !== 404) {
      console.warn(`[elevenlabs] voice delete ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    }
  } catch (err) {
    console.warn(`[elevenlabs] voice delete threw: ${(err as Error).message}`);
  }
}

export const elevenlabsStatus = { live: isFeatureEnabled("ELEVENLABS") };
