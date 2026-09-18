import { apiFetch } from "@/lib/api";

export interface MessagePerson {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
}

export interface ThreadSummary {
  id: string;
  role: "reader" | "author";
  status: "OPEN" | "CLOSED";
  other: MessagePerson;
  book: { id: string; slug: string; title: string; coverUrl: string | null } | null;
  lastMessageAt: string;
  preview: string | null;
  unread: boolean;
}

export interface ChatMessage {
  id: string;
  text: string;
  createdAt: string;
  mine: boolean;
  pending: boolean;
  removed: boolean;
}

export interface ThreadDetail {
  id: string;
  role: "reader" | "author";
  status: "OPEN" | "CLOSED";
  other: MessagePerson;
  book: { id: string; slug: string; title: string; coverUrl: string | null } | null;
}

export const listThreads = () =>
  apiFetch<{ threads: ThreadSummary[]; messagingAvailable: boolean }>("/api/messages");

export const unreadCount = () => apiFetch<{ unread: number }>("/api/messages/unread").then((r) => r.unread);

export const messageAuthor = (authorId: string, text: string, bookId?: string) =>
  apiFetch<{ threadId: string; message: ChatMessage; held: boolean }>(
    `/api/messages/authors/${encodeURIComponent(authorId)}`,
    { method: "POST", json: { text, ...(bookId ? { bookId } : {}) } }
  );

export const getThread = (threadId: string) =>
  apiFetch<{ thread: ThreadDetail; messages: ChatMessage[] }>(`/api/messages/${encodeURIComponent(threadId)}`);

export const replyInThread = (threadId: string, text: string) =>
  apiFetch<{ message: ChatMessage; held: boolean }>(`/api/messages/${encodeURIComponent(threadId)}`, {
    method: "POST",
    json: { text }
  });

export const closeThread = (threadId: string) =>
  apiFetch<{ ok: true }>(`/api/messages/${encodeURIComponent(threadId)}/close`, { method: "POST" });
