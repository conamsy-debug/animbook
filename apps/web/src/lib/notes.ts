import { apiFetch } from "@/lib/api";

export interface MarginNote {
  id: string;
  text: string;
  createdAt: string;
  mine: boolean;
  pending: boolean;
  removed: boolean;
  author: { id: string; name: string; handle: string | null; avatarUrl: string | null };
}

export const getNotes = (pageId: string) =>
  apiFetch<{ notes: MarginNote[] }>(`/api/notes/pages/${pageId}`).then((r) => r.notes);

export const addNote = (pageId: string, text: string) =>
  apiFetch<{ note: MarginNote; held: boolean }>(`/api/notes/pages/${pageId}`, { method: "POST", json: { text } });

export const deleteNote = (id: string) => apiFetch(`/api/notes/${id}`, { method: "DELETE" });

export const getNoteCounts = (bookId: string) =>
  apiFetch<{ counts: Record<string, number> }>(`/api/notes/books/${bookId}/counts`).then((r) => r.counts);
