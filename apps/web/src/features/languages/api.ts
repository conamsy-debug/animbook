/**
 * AnimBook Languages (Phase 1) — API client.
 *
 * Thin wrapper around fetch() that talks to `/api/lang/*`. The
 * server returns 404 when the Languages feature flag is off, so
 * a missing route = feature disabled, which the caller can branch
 * on without an extra health check.
 */
import type { PlayerPayload } from "./types";

/** Phase 1 base languages the player supports. Spec § 3. */
export type BaseLang = "en" | "fr";

/**
 * Fetch the player payload for a story. `base` selects which
 * translation language to surface (defaults to en). On a 404 the
 * function returns `null` — the page treats that as "feature off
 * or story not published" and shows a friendly fallback.
 *
 * Patch 04 placeholder: the server uses a synthetic ID for the
 * storyId (`story:<masterSlug>:<targetLang>`). The page maps the
 * URL `:storyId` from this same shape.
 */
export async function fetchStoryPlayer(
  storyId: string,
  base: BaseLang = "en",
  signal?: AbortSignal
): Promise<PlayerPayload | null> {
  const res = await fetch(
    `/api/lang/stories/${encodeURIComponent(storyId)}?base=${base}`,
    {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal
    }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      `fetchStoryPlayer: ${res.status} ${res.statusText}${
        body?.error ? ` — ${body.error}` : ""
      }`
    );
  }
  return (await res.json()) as PlayerPayload;
}

/**
 * Build the synthetic storyId the server expects from a masterSlug
 * + targetLang pair. Kept here so the page route doesn't need to
 * know the wire format.
 */
export function storyIdFromParts(masterSlug: string, targetLang: string): string {
  return `story:${masterSlug}:${targetLang}`;
}
