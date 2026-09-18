import { apiFetch, type BookSummary } from "@/lib/api";

export interface AuthorProfile {
  id: string;
  name: string;
  handle: string;
  bio: string | null;
  avatarUrl: string | null;
  memberSince: string;
  acceptsMessages: boolean;
  followers: number;
  books: BookSummary[];
}

export interface MyProfile {
  id: string;
  name: string;
  handle: string | null;
  bio: string | null;
  avatarUrl?: string | null;
  messagesOpen: boolean;
  communityDisabled: boolean;
  /// False for school and child accounts — no private messaging at all.
  messagingAvailable: boolean;
  _count: { followers: number; following: number; booksCreated: number };
}

export const getAuthor = (handle: string) =>
  apiFetch<{ author: AuthorProfile }>(`/api/community/authors/${encodeURIComponent(handle)}`).then((r) => r.author);

export const getMyProfile = () => apiFetch<{ me: MyProfile | null }>("/api/community/me").then((r) => r.me);

export const saveMyProfile = (data: { handle?: string; bio?: string; messagesOpen?: boolean }) =>
  apiFetch<{ me: MyProfile }>("/api/community/me", { method: "PUT", json: data }).then((r) => r.me);

export const toggleFollow = (authorId: string) =>
  apiFetch<{ following: boolean }>(`/api/community/authors/${authorId}/follow`, { method: "POST" }).then((r) => r.following);

export const getFollowing = () =>
  apiFetch<{ items: { createdAt: string; author: { id: string; name: string; handle: string; bio: string | null; booksCreated: BookSummary[] } }[] }>(
    "/api/community/following"
  ).then((r) => r.items);

export const reportContent = (data: {
  targetType: "NOTE" | "CIRCLE_POST" | "MESSAGE" | "USER" | "BOOK";
  targetId: string;
  reason: "spam" | "harassment" | "hate" | "sexual" | "child-safety" | "violence" | "other";
  detail?: string;
}) => apiFetch("/api/community/reports", { method: "POST", json: data });
