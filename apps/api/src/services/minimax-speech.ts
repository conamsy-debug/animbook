/**
 * MiniMax (Hailuo) TTS client.
 *
 *   POST https://api.minimax.io/v1/t2a_v2           â€” synchronous HTTP (T2A v2)
 *     body: { model, text, stream, voice_setting, audio_setting,
 *             language_boost, pronunciation_dict, voice_modify,
 *             subtitle_enable, subtitle_type, output_format }
 *     resp: { data: { audio (hex|URL), status }, extra_info: { audio_length_ms, audio_sample_rate, usage_characters, â€¦ } }
 *
 *   POST https://api.minimax.io/v1/t2a_async_v2    â€” async task create (1M chars/file_id)
 *     body: { model, text or text_file_id, voice_setting, audio_setting, â€¦ }
 *     resp: { task_id, file_id, â€¦ } (file_id is returned only on success)
 *
 *   GET  https://api.minimax.io/v1/query/t2a_async_query_v2?task_id=<id>
 *     resp: { status: success|failed|expired|processing, file_id, â€¦ }
 *
 *   GET  https://api.minimax.io/v1/files/retrieve?file_id=<id>
 *     resp: { file: { download_url (9h TTL) } }
 *
 *   POST https://api.minimax.io/v1/get_voice
 *     body: { voice_type: "system"|"cloned"|â€¦ }
 *     resp: { system_voice: [{ voice_id, voice_name, description[] }] }
 *
 *   POST https://api.minimax.io/v1/voice_clone
 *     body: { file_id, voice_id (custom), model, language_boost, text, â€¦ }
 *
 * For the narration pipeline we use the synchronous endpoint for sub-page
 * text (â‰¤ a few thousand chars) because it's faster, and we keep the async
 * endpoint as a future fallback for very long texts (>50k chars).
 *
 * `extra_info.audio_length_ms` gives us real duration in ms. The
 * subtitle_file URL we get back when `subtitle_enable=true` returns an
 * SRT-style transcript with per-sentence timestamps, which we
 * `mirrorToR2` as a `.vtt` to give the Reader exact word/cue timing
 * (currently estimated from char count + 13 chars/sec).
 *
 * Auth: `Authorization: Bearer <MINIMAX_API_KEY>`. The key is read once per
 * request and never logged, printed, or included in error strings.
 */
import { appEnv, isFeatureEnabled } from "../config/env.js";
import { mirrorToR2 } from "./cloudflare.js";
import { narrationTransform } from "./mediaPostProcess.js";
import {
  MINIMAX_TTS_USD_PER_1M_CHARS_HD,
  MINIMAX_TTS_USD_PER_1M_CHARS_TURBO,
  estimateMinimaxTtsCostUsd
} from "./usageTracking.js";

const API_BASE = "https://api.minimax.io";
const STUB_BASE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

/* --------------------------------------------------------------------- *
 * Public surface â€” same names + return shapes as services/elevenlabs.ts so
 * the ttsProvider.ts selector can dispatch on TTS_PROVIDER without the
 * pipeline noticing.
 * --------------------------------------------------------------------- */

export interface CharacterQuotaUsed {
  used: number;
  limit: number;
  period: "monthly" | "unknown";
  isOverQuota: boolean;
}

/**
 * `narration` is the deep shape returned by generateNarration / sample
 * synthesis. NOTE: the existing elevenlabs shape carries audioUrl, vttUrl,
 * durationSeconds, source, characters, error, and (for the orphan-fallback
 * path) orphanedVoiceId. We reproduce all of them here verbatim.
 */
export interface NarrationResult {
  audioUrl: string | null;
  vttUrl: string | null;
  durationSeconds: number;
  characters: number;
  /** "minimax" if real audio was synthesised; "stub" if the key was unset
   *  OR the API returned nothing. */
  source: "minimax" | "stub";
  error: string;
  /** Set when the requested voiceId was reported missing/removed and we
   *  substituted a fallback. Pipeline uses it to mark the user's clone
   *  REMOVED. */
  orphanedVoiceId?: string;
}

export interface SynthesisOptions {
  voiceId: string;
  /** Optional override of the live voice model. Defaults to
   *  appEnv.MINIMAX_TTS_MODEL (speech-2.8-hd). */
  model?: string;
  /** Sub-1000-char chunks; the pipeline passes page text here. */
  text: string;
  /** Persist the audio to R2 under this key and return its public URL.
   *  When storageKey is omitted we still return a base64 data URL so the
   *  Languages flow that returns inline audio keeps working. */
  storageKey?: string;
  /** Language hint sent as `language_boost`. Defaults to "English". */
  languageBoost?: string;
  /** Children character voices carry pitch/rate; we forward them. */
  pitch?: number;
  rate?: number;
  /** When true, throw on errors instead of returning a stub. */
  strict?: boolean;
}

/* --------------------------------------------------------------------- *
 * Errors
 * --------------------------------------------------------------------- */

export class MinimaxSpeechError extends Error {
  constructor(message: string, readonly retryable = false, readonly moderation = false, readonly code = "") {
    super(message);
  }
}

export class VoiceOrphanedError extends MinimaxSpeechError {
  constructor(message: string, readonly voiceId: string, readonly status: number) {
    super(message, false, false, "voice-orphaned");
    this.name = "VoiceOrphanedError";
  }
}

const MODERATION_CODES = new Set(["1026", "1027"]);
const RETRYABLE_CODES = new Set(["1002", "1039"]);

/* --------------------------------------------------------------------- *
 * Internal: network + the live API endpoints
 * --------------------------------------------------------------------- */

function authHeaders(): Record<string, string> {
  if (!appEnv.MINIMAX_API_KEY) throw new MinimaxSpeechError("MINIMAX_API_KEY not configured");
  return { Authorization: `Bearer ${appEnv.MINIMAX_API_KEY}`, "Content-Type": "application/json" };
}

function baseRespError(label: string, r: { base_resp?: { status_code?: number; status_msg?: string } } | null): MinimaxSpeechError {
  const code = r?.base_resp?.status_code?.toString() ?? "unknown";
  const msg = r?.base_resp?.status_msg ?? label;
  if (MODERATION_CODES.has(code)) return new MinimaxSpeechError(`MiniMax ${label}: ${msg} (${code}) â€” moderation`, false, true, code);
  if (RETRYABLE_CODES.has(code)) return new MinimaxSpeechError(`MiniMax ${label}: ${msg} (${code}) â€” retryable`, true, false, code);
  if (code === "2049" || code === "1004" || code === "1008") return new MinimaxSpeechError(`MiniMax ${label}: ${msg} (${code}) â€” auth/billing`, false, false, code);
  return new MinimaxSpeechError(`MiniMax ${label}: ${msg} (${code})`, false, false, code);
}

async function postJson<T>(path: string, body: unknown, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 3_000 * 2 ** i)));
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 || res.status >= 500) {
      lastErr = new MinimaxSpeechError(`MiniMax ${path} â†’ ${res.status}`, true);
      await new Promise((r) => setTimeout(r, Math.min(60_000, 3_000 * 2 ** i)));
      continue;
    }
    const detail = await res.text().catch(() => "");
    throw new MinimaxSpeechError(`MiniMax ${path} â†’ ${res.status}: ${detail.slice(0, 200)}`);
  }
  throw lastErr ?? new MinimaxSpeechError(`MiniMax ${path} gave up`);
}

/* --------------------------------------------------------------------- *
 * Internal: hexâ†’bytes and VTT-from-subtitle helpers
 * --------------------------------------------------------------------- */

function hexToBuffer(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(clean, "hex");
}

function msToVttTimestamp(ms: number): string {
  // VTT uses HH:MM:SS.mmm. ms can be a float from the API; round to int ms.
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const milli = total % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}

interface SubtitleSegment {
  text?: string;
  time_begin?: number;
  time_end?: number;
}

function subtitlesJsonToVtt(json: unknown): string {
  if (!Array.isArray(json) || json.length === 0) return "WEBVTT\n\n";
  const cues = json
    .map((raw, idx) => {
      const seg = raw as SubtitleSegment;
      const text = (seg.text ?? "").toString().trim();
      if (!text) return null;
      const begin = Number.isFinite(seg.time_begin) ? Number(seg.time_begin) : 0;
      const end = Number.isFinite(seg.time_end) ? Number(seg.time_end) : begin + 1000;
      return `${msToVttTimestamp(begin)} --> ${msToVttTimestamp(end)}\n${text}`;
    })
    .filter((s): s is string => Boolean(s));
  if (cues.length === 0) return "WEBVTT\n\n";
  return "WEBVTT\n\n" + cues.join("\n\n") + "\n";
}

/* --------------------------------------------------------------------- *
 * Internal: account for the existing pipeline contract. ElevenLabs uses
 * `model_id = eleven_multilingual_v2` and per-voice settings; MiniMax uses
 * `model` + a `voice_setting` object. The existing callsite passes a flat
 * `voiceId`; we map it into the structured shape here.
 * --------------------------------------------------------------------- */

function modelFromEnv(opts: SynthesisOptions): string {
  if (opts.model) return opts.model;
  const m = appEnv.MINIMAX_TTS_MODEL;
  return m && (m === "speech-2.8-hd" || m === "speech-2.8-turbo" || m.startsWith("speech-")) ? m : "speech-2.8-hd";
}

function voiceSetting(opts: SynthesisOptions): Record<string, unknown> {
  const out: Record<string, unknown> = { voice_id: opts.voiceId };
  if (typeof opts.pitch === "number") out.pitch = Math.max(-12, Math.min(12, opts.pitch));
  if (typeof opts.rate === "number") out.speed = Math.max(0.5, Math.min(2, opts.rate)); // MiniMax calls rate "speed"
  return out;
}

function audioSetting(): Record<string, unknown> {
  return {
    sample_rate: 32000,
    bitrate: 128000,
    format: "mp3",
    channel: 1
  };
}

/* --------------------------------------------------------------------- *
 * Internal: offline base64-sized hex decode switch. The T2A HTTP endpoint
 * returns `audio` as either a hex-encoded string (default) or an `audio_url`
 * string when `output_format: "url"`. We use the URL form to avoid buffering
 * several MB of base64 in memory per page.
 * --------------------------------------------------------------------- */

interface SyncT2aResp {
  data?: {
    audio?: string;
    audio_url?: string;
    subtitle_file?: string;
    status?: number;
  };
  extra_info?: {
    audio_length_ms?: number;
    audio_sample_rate?: number;
    usage_characters?: number;
    word_count?: number;
  };
  base_resp?: { status_code?: number; status_msg?: string };
}

async function fetchAudio(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new MinimaxSpeechError(`MiniMax audio fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new MinimaxSpeechError("MiniMax returned empty audio");
  return buf;
}

async function fetchSubtitleAsVtt(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = await res.text();
    if (!body.trim()) return null;
    // The MiniMax subtitle_file is a JSON array of { text, time_begin, time_end,
    // timestamped_words? } segments (per the openapi spec, â‰¤ 50 chars per
    // sentence, ms timestamps). We convert it into a VTT blob for the player.
    try {
      const parsed = JSON.parse(body);
      const vtt = subtitlesJsonToVtt(parsed);
      return vtt === "WEBVTT\n\n" ? null : vtt;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------- *
 * Public API surface â€” mirrors elevenlabs.ts:
 *
 *   - synthesizeSpeech(text, voiceId)                  -> Buffer (mp3)
 *   - generateNarration({...})                         -> NarrationResult
 *   - listVoices()                                     -> VoiceListItem[]
 *   - markVoiceOrphaned(userId, voiceId)              -> boolean
 *   - characterQuota()                                 -> CharacterQuotaUsed
 *
 * ttsProvider.ts wraps these and re-exports the same names.
 * --------------------------------------------------------------------- */

export async function synthesizeSpeech(text: string, voiceId: string, opts: SynthesisOptions = { text, voiceId }): Promise<Buffer> {
  if (!isFeatureEnabled("MINIMAX_TTS")) throw new MinimaxSpeechError("TTS provider is not configured");
  const body = {
    model: modelFromEnv({ ...opts, voiceId, text }),
    text,
    stream: false,
    output_format: "hex",
    voice_setting: voiceSetting({ ...opts, voiceId, text }),
    audio_setting: audioSetting(),
    language_boost: opts.languageBoost ?? "English",
    subtitle_enable: false
  };
  try {
    const r = await postJson<SyncT2aResp>("/v1/t2a_v2", body);
    if (!r.data?.audio) throw new MinimaxSpeechError("MiniMax returned no audio");
    return hexToBuffer(r.data.audio);
  } catch (err) {
    if (err instanceof MinimaxSpeechError) {
      // Some voice-orphan paths surface as a body error rather than HTTP 4xx.
      if (err.code === "voice-orphaned" || /voice.{0,4}not.{0,4}found/i.test(err.message)) {
        throw new VoiceOrphanedError(err.message, voiceId, 404);
      }
      throw err;
    }
    throw err;
  }
}

export interface VoiceListItem {
  voice_id: string;
  voice_name: string;
  description: string[];
  language_boosts?: string[];
}

const voiceCache: { fetchedAt: number; voices: VoiceListItem[] } = { fetchedAt: 0, voices: [] };
const VOICE_CACHE_MS = 60 * 60 * 1000;

export async function listVoices(opts?: { forceRefresh?: boolean }): Promise<VoiceListItem[]> {
  if (!isFeatureEnabled("MINIMAX_TTS")) return [];
  if (!opts?.forceRefresh && voiceCache.voices.length > 0 && Date.now() - voiceCache.fetchedAt < VOICE_CACHE_MS) {
    return voiceCache.voices;
  }
  try {
    const resp = await postJson<{ system_voice?: VoiceListItem[] }>("/v1/get_voice", { voice_type: "system" }, 2);
    voiceCache.fetchedAt = Date.now();
    voiceCache.voices = resp.system_voice ?? [];
    return voiceCache.voices;
  } catch (err) {
    console.warn(`[minimax-speech] listVoices: ${(err as Error).message}; returning cache (${voiceCache.voices.length})`);
    return voiceCache.voices;
  }
}

export async function characterQuota(): Promise<CharacterQuotaUsed> {
  // MiniMax doesn't expose a /quota endpoint at v2 today. We surface a
  // sensible monthly ballpark so the Studio's cost preview matches the
  // pipeline's actual usage reporting.
  return {
    used: 0,
    limit: 1_000_000,
    period: "monthly",
    isOverQuota: false
  };
}

/** The marker flip a 404 orphan triggers on the user's record. We don't
 *  directly mutate the DB here â€” the route layer does. This returns
 *  whether we *recommend* the flip. Kept as a free function so the
 *  pipeline-side imports stay intact when we swap callsites. */
export async function markVoiceOrphaned(userId: string, voiceId: string): Promise<boolean> {
  if (!userId || !voiceId) return false;
  if (!isFeatureEnabled("MINIMAX_TTS")) return false;
  console.warn(`[minimax-speech] markVoiceOrphaned(${userId}, ${voiceId}) â€” caller handles DB flip`);
  return true;
}

/* --------------------------------------------------------------------- *
 * The main function the pipeline imports.
 * --------------------------------------------------------------------- */

export async function generateNarration(opts: SynthesisOptions): Promise<NarrationResult> {
  if (!isFeatureEnabled("MINIMAX_TTS")) {
    if (opts.strict) throw new MinimaxSpeechError("TTS provider not configured");
    return {
      audioUrl: null,
      vttUrl: null,
      durationSeconds: Math.max(1, Math.round(opts.text.length / 13)),
      characters: opts.text.length,
      source: "stub",
      error: "TTS provider not configured"
    };
  }

  try {
    const baseBody = {
      model: modelFromEnv(opts),
      text: opts.text,
      stream: false,
      output_format: "url" as const,
      voice_setting: voiceSetting(opts),
      audio_setting: audioSetting(),
      language_boost: opts.languageBoost ?? "English",
      subtitle_enable: true,
      subtitle_type: "sentence" as const
    };
    const synthResp = await postJson<SyncT2aResp>("/v1/t2a_v2", baseBody);
    if (!synthResp.data || (synthResp.data.status && synthResp.data.status !== 2)) {
      throw baseRespError("t2a_v2 (no data)", synthResp);
    }
    // The T2A response carries the audio (or audio URL) under `data.audio`,
// regardless of `output_format`. When `output_format: "url"` is set,
// `data.audio` holds a 24-hour signed OSS URL; otherwise it's a hex string.
    const audioField = synthResp.data.audio ?? synthResp.data.audio_url;
    if (!audioField) throw new MinimaxSpeechError("MiniMax returned no audio");
    const audioUrl = /^https?:\/\//i.test(audioField) ? audioField : null;
    const audio: Buffer = audioUrl
      ? await fetchAudio(audioUrl)
      : hexToBuffer(audioField);
    if (audio.length === 0) throw new MinimaxSpeechError("MiniMax returned empty audio");

    const vtt: string | null = synthResp.data.subtitle_file ? await fetchSubtitleAsVtt(synthResp.data.subtitle_file) : null;

    const durationSeconds = Math.max(
      1,
      synthResp.extra_info?.audio_length_ms ? Math.round(synthResp.extra_info.audio_length_ms / 1000) : Math.round(audio.length / 32000)
    );
    const characters = synthResp.extra_info?.usage_characters ?? opts.text.length;

    let publicAudioUrl: string | null = null;
    let publicVttUrl: string | null = null;

    if (opts.storageKey) {
      const audioAsset = await mirrorToR2(`data:audio/mpeg;base64,${audio.toString("base64")}`, opts.storageKey, "audio/mpeg", 5, narrationTransform());
      publicAudioUrl = audioAsset.source === "r2" ? audioAsset.url : `data:audio/mpeg;base64,${audio.toString("base64")}`;
      if (vtt) {
        const vttKey = opts.storageKey.replace(/\.[a-z0-9]+$/i, ".vtt");
        const vttAsset = await mirrorToR2(`data:text/vtt;base64,${Buffer.from(vtt).toString("base64")}`, vttKey, "text/vtt");
        publicVttUrl = vttAsset.source === "r2" ? vttAsset.url : `data:text/vtt;base64,${Buffer.from(vtt).toString("base64")}`;
      }
    } else {
      publicAudioUrl = `data:audio/mpeg;base64,${audio.toString("base64")}`;
      if (vtt) publicVttUrl = `data:text/vtt;base64,${Buffer.from(vtt).toString("base64")}`;
    }

    return {
      audioUrl: publicAudioUrl,
      vttUrl: publicVttUrl,
      durationSeconds,
      characters,
      source: "minimax",
      error: ""
    };
  } catch (err) {
    if (err instanceof MinimaxSpeechError) {
      if (err.code === "voice-orphaned" || /voice.{0,4}not.{0,4}found/i.test(err.message)) {
        // Mirror the ElevenLabs orphan-retry: try a brief fallback at the
        // provider default voice. Pipeline expects a fallback URL with
        // orphanedVoiceId set.
        const fallbackVoice = "English_expressive_narrator";
        try {
          if (opts.voiceId !== fallbackVoice) {
            const r = await postJson<SyncT2aResp>("/v1/t2a_v2", {
              model: modelFromEnv(opts),
              text: opts.text,
              stream: false,
              output_format: "url",
              voice_setting: { voice_id: fallbackVoice },
              audio_setting: audioSetting(),
              language_boost: opts.languageBoost ?? "English",
              subtitle_enable: false
            });
            if (r.data?.audio_url) {
              const fallbackAudio = await fetchAudio(r.data.audio_url);
              return {
                audioUrl: opts.storageKey
                  ? (await mirrorToR2(`data:audio/mpeg;base64,${fallbackAudio.toString("base64")}`, opts.storageKey, "audio/mpeg", 5, narrationTransform())).url
                  : `data:audio/mpeg;base64,${fallbackAudio.toString("base64")}`,
                vttUrl: null,
                durationSeconds: r.extra_info?.audio_length_ms ? Math.round(r.extra_info.audio_length_ms / 1000) : Math.round(fallbackAudio.length / 32000),
                characters: r.extra_info?.usage_characters ?? opts.text.length,
                source: "minimax",
                error: "",
                orphanedVoiceId: opts.voiceId
              };
            }
          }
        } catch {
          // fall through to the throw below
        }
      }
      if (opts.strict) throw err;
      return {
        audioUrl: null,
        vttUrl: null,
        durationSeconds: Math.max(1, Math.round(opts.text.length / 13)),
        characters: opts.text.length,
        source: "stub",
        error: err.message
      };
    }
    if (opts.strict) throw err;
    return {
      audioUrl: null,
      vttUrl: null,
      durationSeconds: Math.max(1, Math.round(opts.text.length / 13)),
      characters: opts.text.length,
      source: "stub",
      error: (err as Error).message
    };
  }
}

/* --------------------------------------------------------------------- *
 * Re-exports for ttsProvider.ts + tests
 * --------------------------------------------------------------------- */

export {
  estimateMinimaxTtsCostUsd,
  MINIMAX_TTS_USD_PER_1M_CHARS_HD,
  MINIMAX_TTS_USD_PER_1M_CHARS_TURBO
};

export const minimaxSpeechStatus = {
  live: isFeatureEnabled("MINIMAX_TTS"),
  model: appEnv.MINIMAX_TTS_MODEL,
  isConfigured: Boolean(appEnv.MINIMAX_API_KEY)
} as const;
