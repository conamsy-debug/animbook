/**
 * AnimBook mobile API client.
 *
 * Talks to the existing backend (apps/api) at `EXPO_PUBLIC_API_URL`.
 * Every method falls back gracefully when an integration key is missing —
 * the stubs the backend already serves are enough to drive the shell.
 */
import Constants from "expo-constants";

const FALLBACK_BASE = "http://localhost:4000";

function baseUrl(): string {
  const fromExtra = Constants.expoConfig?.extra?.apiBase;
  if (typeof fromExtra === "string" && fromExtra.length > 0) return fromExtra;
  // EXPO_PUBLIC_* env vars are inlined into the bundle at build time.
  // Use a string lookup that TypeScript treats as a string constant.
  const fromEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EXPO_PUBLIC_API_URL;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return FALLBACK_BASE;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const headers = new Headers(init.headers ?? {});
  headers.set("Accept", "application/json");
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let body: unknown = undefined;
    try { body = await res.json(); } catch { body = await res.text(); }
    throw new ApiError(res.status, `${res.status} ${res.statusText}`, body);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export interface BookSummary {
  id: string;
  slug: string;
  title: string;
  author: string;
  synopsis: string;
  vertical: string;
  genreTags: string[];
  moodTags: string[];
  ageRating: string | null;
  language: string;
  coverUrl: string | null;
  totalPages: number;
  styleId: string | null;
}

export interface PageRecord {
  id: string;
  pageNum: number;
  chapter: string | null;
  textExcerpt: string;
  videoUrl: string | null;
  posterUrl: string | null;
  audioUrl: string | null;
  vttUrl: string | null;
  sceneType: string | null;
  emotionalRegister: string | null;
  cameraAngle: string | null;
  qualityScore: number | null;
  status: string;
  speakerName: string | null;
}

export interface MemoryProfile {
  palette: string;
  pacing: string;
  cameraStyle: string;
  narrationSpeed: number;
  fontSize: number;
  motionLevel: number;
  lensEnabled: boolean;
  echoEnabled: boolean;
}

export interface DreamProfile {
  palette: string;
  pacing: string;
  cameraStyle: string;
  narrationSpeed: number;
  fontSize: number;
  motionLevel: number;
  flipDurationMs: number;
  dimScreen: boolean;
  ambientTrack: string;
  caption: string;
}

export interface DreamSession {
  id: string;
  bookId: string;
  ambientTrack: string;
  pagesRead: number;
  startedAt: string;
  endedAt: string | null;
  fellAsleepAt: string | null;
  exitReason: string | null;
}

export interface CompanionLink {
  id: string;
  bookId: string;
  markerHash: string;
  nfcTagId: string;
  experienceMode: string;
  anchorPage: number;
  title: string | null;
  companionLabel: string | null;
}

export const api = {
  baseUrl,
  health: () => call<{ service: string; status: string }>("/api/health"),
  listBooks: () => call<{ items: BookSummary[] }>("/api/books?status=PUBLISHED&limit=40"),
  getBook: (slug: string) => call<BookSummary>(`/api/books/${encodeURIComponent(slug)}`),
  getBookPages: (slug: string) => call<{ pages: PageRecord[] }>(`/api/books/${encodeURIComponent(slug)}/pages`),
  listWorlds: () => call<{ items: { id: string; slug: string; name: string; synopsis: string; accentColor: string }[] }>("/api/worlds"),
  memory: {
    get: () => call<{ profile: MemoryProfile }>("/api/memory/settings"),
    update: (patch: Partial<MemoryProfile>) =>
      call<{ profile: MemoryProfile }>("/api/memory/settings", { method: "PUT", body: JSON.stringify(patch) })
  },
  dream: {
    profile: (slug: string) => call<{ active: boolean; profile: DreamProfile }>(`/api/dream/profile/${encodeURIComponent(slug)}`),
    listSessions: () => call<{ items: DreamSession[] }>("/api/dream/sessions"),
    open: (slug: string, ambientTrack?: string) =>
      call<{ session: DreamSession }>("/api/dream/sessions", {
        method: "POST",
        body: JSON.stringify({ bookId: slug, ambientTrack })
      }),
    end: (sessionId: string, reason: string, fellAsleep: boolean) =>
      call<{ ok: boolean }>(`/api/dream/sessions/${sessionId}/end`, {
        method: "POST",
        body: JSON.stringify({ reason, fellAsleep })
      })
  },
  companion: {
    forBook: (slug: string) => call<{ book: BookSummary; link: CompanionLink | null }>(`/api/studio-pro/companion/${encodeURIComponent(slug)}`),
    mint: (slug: string, anchorPage: number, experienceMode: string) =>
      call<{ book: BookSummary; link: CompanionLink }>(`/api/studio-pro/companion/${encodeURIComponent(slug)}`, {
        method: "POST",
        body: JSON.stringify({ anchorPage, experienceMode })
      }),
    pin: (slug: string, anchorPage: number) =>
      call<{ link: CompanionLink }>(`/api/studio-pro/companion/${encodeURIComponent(slug)}/page`, {
        method: "POST",
        body: JSON.stringify({ anchorPage })
      }),
    openSession: (linkId: string, triggerMode: "AR_OVERLAY" | "NFC_ANCHOR" | "MANUAL", pageReached: number) =>
      call<{ session: { id: string } }>("/api/studio-pro/sessions", {
        method: "POST",
        body: JSON.stringify({ linkId, triggerMode, pageReached })
      })
  }
};