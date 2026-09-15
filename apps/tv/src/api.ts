/**
 * AnimBook TV API client.
 *
 * Talks to the AnimBook API at `VITE_ANIMBOOK_API_URL` (or
 * `http://localhost:4000` by default). The TV shell is read-only on the
 * catalogue and library — DREAM sessions, Companion links, and Memory
 * settings exist for parity but are surfaced as overview cards rather
 * than editable forms.
 */
const BASE: string =
  (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_ANIMBOOK_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function call<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    let body: unknown = undefined;
    try { body = await res.json(); } catch { body = await res.text(); }
    throw new ApiError(res.status, `${res.status} ${res.statusText}`, body);
  }
  return (await res.json()) as T;
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
  coverUrl: string | null;
  totalPages: number;
}

export interface PageRecord {
  id: string;
  pageNum: number;
  chapter: string | null;
  textExcerpt: string;
  videoUrl: string | null;
  posterUrl: string | null;
}

export const api = {
  base: BASE,
  listBooks: () => call<{ items: BookSummary[] }>("/api/books?status=PUBLISHED&limit=24"),
  getBook: (slug: string) => call<BookSummary>(`/api/books/${encodeURIComponent(slug)}`),
  getPages: (slug: string) => call<{ pages: PageRecord[] }>(`/api/books/${encodeURIComponent(slug)}/pages`),
  listWorlds: () => call<{ items: { id: string; slug: string; name: string; synopsis: string; accentColor: string }[] }>("/api/worlds"),
  verticals: () => call<{ verticals: { id: string; label: string }[] }>("/api/books/verticals"),
  dreamSessions: () => call<{ items: { id: string; bookId: string; startedAt: string; ambientTrack: string; pagesRead: number; fellAsleepAt: string | null }[] }>("/api/dream/sessions?limit=10"),
  companionForBook: (slug: string) => call<{ book: BookSummary; link: { id: string; nfcTagId: string; markerHash: string; anchorPage: number } | null }>(`/api/studio-pro/companion/${encodeURIComponent(slug)}`)
};