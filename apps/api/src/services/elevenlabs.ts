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

/**
 * Thrown by `synthesizeSpeech` when ElevenLabs returns 404 — i.e. the
 * voiceId we asked it to use no longer exists on their side. Callers
 * (runAudioStage, /audio-regenerate) catch this, mark the user-side
 * voice as REMOVED, clear narratorVoiceId, and fall back to a default
 * voice so narration continues without the author seeing broken audio.
 */
export class VoiceOrphanedError extends Error {
  readonly voiceId: string;
  readonly status: number;
  readonly detail: string;
  constructor(voiceId: string, status: number, detail: string) {
    super(`ElevenLabs voice ${voiceId} ${status}: ${detail.slice(0, 200)}`);
    this.name = "VoiceOrphanedError";
    this.voiceId = voiceId;
    this.status = status;
    this.detail = detail;
  }
}

export interface NarrationResult {
  audioUrl: string | null;
  vttUrl: string | null;
  characters: number;
  source: "elevenlabs" | "stub";
  /**
   * Set when synthesizeSpeech threw VoiceOrphanedError. The caller
   * (audio narration worker / route) should update users.voiceStatus to
   * REMOVED and clear narratorVoiceId so subsequent narrations fall
   * back to a curated default. We carry the orphaned id up so the
   * caller can decide — it knows the userId, we don't.
   */
  orphanedVoiceId?: string;
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
      // 404 = voice no longer exists on ElevenLabs. Surface as a typed
      // VoiceOrphanedError so callers can mark the user-side voice as
      // REMOVED and fall back to a default voice. Don't retry — a deleted
      // voice won't come back.
      if (res.status === 404) {
        throw new VoiceOrphanedError(voice, res.status, detail);
      }
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
      }
      lastErr = new Error(`ElevenLabs ${res.status}`);
    } catch (err) {
      // VoiceOrphanedError and other 4xx: don't retry.
      if (err instanceof VoiceOrphanedError) throw err;
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
 *
 * Voice-orphan resilience: if ElevenLabs returns 404 for the requested
 * voice (someone deleted it on their dashboard), we surface the orphaned
 * voice id on the result so the caller can flip the user-side voice
 * record to REMOVED, then retry with ElevenLabs' default voice so the
 * page still gets audio. Silent fallback would mean authors don't notice
 * they lost their clone — surfacing orphanedVoiceId keeps them informed.
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
  const requestedVoice = input.voiceId ?? null;
  try {
    const audio = await synthesizeSpeech(text, input.voiceId);
    const storageKey = input.storageKey ?? `narration/misc/${Date.now().toString(36)}.mp3`;
    const stored = await uploadAsset({ key: storageKey, body: audio, contentType: "audio/mpeg" });
    return { audioUrl: stored.url, vttUrl: null, characters: text.length, source: "elevenlabs" };
  } catch (err) {
    if (err instanceof VoiceOrphanedError) {
      // The voice we tried is gone on ElevenLabs. Surface it to the caller
      // so they can mark users.voiceStatus = REMOVED. Then retry once
      // with the default voice so the page still gets audio. The default
      // voice is ElevenLabs' stock "Rachel" which is unlikely to be
      // missing, so this almost always succeeds.
      const fallback = process.env.ELEVENLABS_NARRATOR_VOICE_ID || DEFAULT_VOICE;
      if (fallback === requestedVoice || fallback === err.voiceId) {
        // Already tried the fallback — give up.
        if (input.strict) throw err;
        console.warn(`[elevenlabs] fallback voice ${fallback} also missing for ${err.voiceId}`);
        return { audioUrl: null, vttUrl: null, characters: 0, source: "stub", orphanedVoiceId: err.voiceId };
      }
      try {
        const audio = await synthesizeSpeech(text, fallback);
        const storageKey = input.storageKey ?? `narration/misc/${Date.now().toString(36)}.mp3`;
        const stored = await uploadAsset({ key: storageKey, body: audio, contentType: "audio/mpeg" });
        console.warn(`[elevenlabs] voice ${err.voiceId} orphaned; used fallback ${fallback}`);
        return {
          audioUrl: stored.url,
          vttUrl: null,
          characters: text.length,
          source: "elevenlabs",
          orphanedVoiceId: err.voiceId
        };
      } catch (fallbackErr) {
        if (input.strict) throw fallbackErr;
        console.warn(`[elevenlabs] fallback ${fallback} also failed: ${(fallbackErr as Error).message}`);
        return {
          audioUrl: null,
          vttUrl: null,
          characters: 0,
          source: "stub",
          orphanedVoiceId: err.voiceId
        };
      }
    }
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

/**
 * Mark a user's cloned voice as REMOVED on our side. Called by the audio
 * narration paths after ElevenLabs 404s on what we thought was a live
 * voice_id (someone deleted it from their ElevenLabs dashboard, or our
 * token was revoked). Clears narratorVoiceId so the voice-precedence
 * chain in runAudioStage / audio-regenerate falls back to a curated
 * default. Idempotent — re-running with the same orphaned id is a no-op.
 */
export async function markVoiceOrphaned(userId: string, orphanedVoiceId: string): Promise<boolean> {
  // Lazy import to avoid pulling Prisma in scripts that only need TTS.
  const { prisma } = await import("../db.js");
  try {
    const r = await prisma.user.updateMany({
      where: { id: userId, narratorVoiceId: orphanedVoiceId, voiceStatus: "CLONED" },
      data: { voiceStatus: "REMOVED", narratorVoiceId: null }
    });
    return r.count > 0;
  } catch (err) {
    console.warn(`[elevenlabs] markVoiceOrphaned ${userId} ${orphanedVoiceId}: ${(err as Error).message}`);
    return false;
  }
}

export const elevenlabsStatus = { live: isFeatureEnabled("ELEVENLABS") };
