import { apiFetch } from "@/lib/api";

export interface CirclePerson {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
}

export interface CircleBook {
  id: string;
  slug: string;
  title: string;
  coverUrl: string | null;
}

export interface CircleSummary {
  id: string;
  name: string;
  createdAt: string;
  role: string;
  book: CircleBook | null;
  owner: CirclePerson;
  _count: { members: number; posts: number };
}

export interface CirclePost {
  id: string;
  text: string;
  pageNum: number | null;
  createdAt: string;
  mine?: boolean;
  user: CirclePerson;
}

export interface CircleDetail {
  id: string;
  name: string;
  inviteCode: string | null;
  createdAt: string;
  ownerId: string;
  role: string;
  book: CircleBook | null;
  members: { role: string; joinedAt: string; user: CirclePerson }[];
  posts: CirclePost[];
}

export const listCircles = () => apiFetch<{ items: CircleSummary[] }>("/api/circles").then((r) => r.items);

export const createCircle = (name: string, bookId?: string) =>
  apiFetch<{ circle: { id: string; name: string; inviteCode: string } }>("/api/circles", {
    method: "POST",
    json: { name, bookId }
  }).then((r) => r.circle);

export const getCircle = (id: string) => apiFetch<{ circle: CircleDetail }>(`/api/circles/${id}`).then((r) => r.circle);

export const previewInvite = (code: string) =>
  apiFetch<{ circle: { id: string; name: string; book: CircleBook | null; owner: CirclePerson; alreadyMember: boolean; _count: { members: number } } }>(
    `/api/circles/invite/${encodeURIComponent(code)}`
  ).then((r) => r.circle);

export const joinCircle = (code: string) =>
  apiFetch<{ circleId: string }>("/api/circles/join", { method: "POST", json: { code } }).then((r) => r.circleId);

export const postToCircle = (id: string, text: string, pageNum?: number) =>
  apiFetch<{ post: CirclePost; held: boolean }>(`/api/circles/${id}/posts`, { method: "POST", json: { text, pageNum } });

export const deleteCirclePost = (id: string) => apiFetch(`/api/circles/posts/${id}`, { method: "DELETE" });
export const leaveCircle = (id: string) => apiFetch(`/api/circles/${id}/leave`, { method: "POST" });
export const closeCircle = (id: string) => apiFetch(`/api/circles/${id}`, { method: "DELETE" });
