import { announceAuthRequired, getAuthToken } from "@/lib/auth";

const DEFAULT_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Absolute API URL for a path. */
export function apiUrl(path: string): string {
  return `${DEFAULT_BASE}${path}`;
}

/**
 * URL for an EventSource stream. EventSource can't send headers, so the
 * session token rides along as `?token=` (the API accepts this on GET only).
 */
export async function apiStreamUrl(path: string): Promise<string> {
  const token = await getAuthToken();
  if (!token) return apiUrl(path);
  const sep = path.includes("?") ? "&" : "?";
  return apiUrl(`${path}${sep}token=${encodeURIComponent(token)}`);
}

export interface FetchOptions extends RequestInit {
  json?: unknown;
  demoUserId?: string;
}

export class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { json, demoUserId, headers, ...rest } = options;
  const finalHeaders = new Headers(headers ?? {});
  finalHeaders.set("Accept", "application/json");
  if (json !== undefined) {
    finalHeaders.set("Content-Type", "application/json");
  }
  if (demoUserId) {
    finalHeaders.set("x-demo-user-id", demoUserId);
  }
  if (!finalHeaders.has("Authorization")) {
    const token = await getAuthToken();
    if (token) finalHeaders.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(apiUrl(path), {
    ...rest,
    headers: finalHeaders,
    body: json === undefined ? (rest.body ?? null) : JSON.stringify(json)
  });
  if (!response.ok) {
    // Read the body exactly once. Calling response.json() consumes the stream,
    // so a fallback response.text() after a JSON parse failure throws
    // "body stream already read". Read as text, then attempt JSON.parse locally.
    let details: unknown = undefined;
    const raw = await response.text();
    if (raw) {
      try {
        details = JSON.parse(raw);
      } catch {
        details = raw;
      }
    }
    if (response.status === 401) announceAuthRequired();
    throw new ApiError(
      response.status,
      response.status === 401 ? "Please sign in to continue" : `${response.status} ${response.statusText}`,
      details
    );
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return (await response.text()) as unknown as T;
}

export interface BookSummary {
  id: string;
  slug: string;
  title: string;
  subtitle?: string | null;
  subcategory?: string | null;
  author: string;
  /** The AnimBook account that made this book, when it came from Studio. */
  creator?: { id: string; name: string; handle: string | null } | null;
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
  directionNote?: string | null;
  speakerName: string | null;
}

export interface LibraryEntry {
  id: string;
  bookId: string;
  progressPage: number;
  lastRead: string;
  mode: "WATCH" | "BOTH" | "READ";
  completed: boolean;
  narrationLanguage?: string;
  downloadedAt?: string | null;
  book: BookSummary;
}

export interface StudioProjectSummary {
  id: string;
  name: string;
  vertical: string;
  status: string;
  currentStage: string;
  expertReviewRequired: boolean;
}

export interface BookBrainJson {
  title: string;
  genre: string[];
  cultural_origin: string;
  target_audience: string;
  style_recommendation: string;
  characters: { name: string; description: string; role: string }[];
  settings: { name: string; description: string; atmosphere: string }[];
  page_manifest: {
    page_num: number;
    text_excerpt: string;
    setting: string;
    characters_present: string[];
    primary_action: string;
    emotion: string;
    camera_angle: string;
    animation_prompt_draft: string;
  }[];
}

export interface PipelineEvent {
  stage: string;
  status: "queued" | "running" | "succeeded" | "failed" | "retrying";
  progress: number;
  message?: string;
  at: string;
}