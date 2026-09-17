import { ApiError, apiFetch } from "@/lib/api";

/** The book's own pre-recorded narrator (page.audioUrl). */
export const BOOK_VOICE = "book";
export const VOICE_KEY = "animbook:voice";

export interface VoiceOption {
  id: string;
  label: string;
  description: string;
}

let catalog: Promise<{ voices: VoiceOption[]; available: boolean }> | null = null;

export function loadVoices(): Promise<{ voices: VoiceOption[]; available: boolean }> {
  if (!catalog) {
    catalog = apiFetch<{ voices: VoiceOption[]; available: boolean }>("/api/narration/voices").catch((err) => {
      catalog = null;
      throw err;
    });
  }
  return catalog;
}

const urls = new Map<string, Promise<string | null>>();

/** Narration URL for a page in a chosen voice (recorded on first request, then cached). */
export function narrationUrl(pageId: string, voiceId: string): Promise<string | null> {
  const key = `${pageId}:${voiceId}`;
  let pending = urls.get(key);
  if (!pending) {
    pending = apiFetch<{ audioUrl: string | null }>(
      `/api/narration/pages/${encodeURIComponent(pageId)}?voice=${encodeURIComponent(voiceId)}`
    ).then((r) => r.audioUrl);
    urls.set(key, pending);
    pending.catch(() => urls.delete(key));
  }
  return pending;
}

const samples = new Map<string, Promise<string>>();

export function voiceSample(voiceId: string): Promise<string> {
  let pending = samples.get(voiceId);
  if (!pending) {
    pending = apiFetch<{ audioUrl: string }>(`/api/narration/voices/${encodeURIComponent(voiceId)}/sample`).then((r) => r.audioUrl);
    samples.set(voiceId, pending);
    pending.catch(() => samples.delete(voiceId));
  }
  return pending;
}

/** Human message for a failed voice request. */
export function voiceErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Sign in to choose a narrator.";
    const detail = (err.details as { error?: string } | undefined)?.error;
    if (detail) return detail;
  }
  return "That voice isn't available right now — using the book's narrator.";
}
