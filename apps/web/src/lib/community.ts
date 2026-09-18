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

export const saveMyProfile = (data: { handle?: string; bio?: string; messagesOpen?: boolean; avatarUrl?: string | null }) =>
  apiFetch<{ me: MyProfile }>("/api/community/me", { method: "PUT", json: data }).then((r) => r.me);

/**
 * Read a File (from <input type="file">) into a base64 data URI the API can
 * ingest. The server uploads it to R2 and stores the public URL. We send the
 * data URI through `PUT /me { avatarUrl }` so the route still owns validation
 * and the avatar / handle / bio save stays atomic.
 */
export function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unexpected reader result"));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

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
