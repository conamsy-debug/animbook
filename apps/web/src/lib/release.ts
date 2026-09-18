import { apiFetch } from "@/lib/api";

export interface ReleaseInfo {
  mode: "IMMEDIATE" | "TIME" | "TASK";
  cadence: "DAILY" | "WEEKLY" | "MONTHLY" | null;
  chunkPercent: number | null;
  startAt: string | null;
  totalChunks: number;
  releasedChunks: number;
  nextChunkAt: string | null;
  myUnlockedChunk: number;
  dailyTaskPrompt: string | null;
  scheduleLocked: boolean;
}

export function getReleaseInfo(bookId: string): Promise<{ release: ReleaseInfo }> {
  return apiFetch<{ release: ReleaseInfo }>(`/api/books/${encodeURIComponent(bookId)}/release-info`);
}

export function submitDailyTask(bookId: string, chunkIndex: number, text: string): Promise<{ ok: true; release: ReleaseInfo }> {
  return apiFetch<{ ok: true; release: ReleaseInfo }>(`/api/books/${encodeURIComponent(bookId)}/submit-task`, {
    method: "POST",
    json: { chunkIndex, text }
  });
}

/** "in 3 days" / "tomorrow" / "now" — small helper for the next-drop banner. */
export function formatRelative(target: Date | string, now: Date = new Date()): string {
  const t = typeof target === "string" ? new Date(target) : target;
  const diffMs = t.getTime() - now.getTime();
  const future = diffMs > 0;
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  let text: string;
  if (abs < hour) text = `${Math.max(1, Math.round(abs / minute))} min`;
  else if (abs < day) text = `${Math.round(abs / hour)} hr`;
  else if (abs < 7 * day) text = `${Math.round(abs / day)} days`;
  else text = t.toLocaleDateString();
  return future ? `in ${text}` : `${text} ago`;
}
