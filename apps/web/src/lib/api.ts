const DEFAULT_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
  const response = await fetch(`${DEFAULT_BASE}${path}`, {
    ...rest,
    headers: finalHeaders,
    body: json === undefined ? (rest.body ?? null) : JSON.stringify(json)
  });
  if (!response.ok) {
    let details: unknown = undefined;
    try {
      details = await response.json();
    } catch {
      details = await response.text();
    }
    throw new ApiError(response.status, `${response.status} ${response.statusText}`, details);
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