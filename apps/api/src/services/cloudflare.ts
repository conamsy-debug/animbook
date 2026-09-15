/**
 * Cloudflare R2 upload client + CDN URL resolution.
 *
 * Real implementation uses S3-compatible signatures against Cloudflare R2.
 * When the credentials are missing we return a data: URI so the rest of the
 * pipeline can still publish a "stub" AnimBook and the Reader can still
 * display something.
 *
 * `cdnUrl(key)` resolves any stored key to its public CDN URL when
 * `CLOUDFLARE_CDN_BASE` is configured (e.g. `https://media.animbook.com`).
 * Use this from API responses for cover art and posters so the web bundle
 * doesn't hit the API origin for every image request.
 */
import { appEnv, isFeatureEnabled } from "../config/env.js";

export interface UploadInput {
  key: string;
  body: Buffer | string;
  contentType: string;
}

export interface UploadResult {
  url: string;
  source: "r2" | "stub";
}

/**
 * Resolve a Cloudflare R2 object key to its public CDN URL.
 * Falls back to the legacy `animbook.r2.dev` host when no CDN base is set.
 * Returns the original URL if it doesn't look like a key (already an absolute URL).
 */
export function cdnUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key;
  if (key.startsWith("data:")) return key;
  if (appEnv.CLOUDFLARE_CDN_BASE) {
    const base = appEnv.CLOUDFLARE_CDN_BASE.replace(/\/+$/, "");
    return `${base}/${key.replace(/^\/+/, "")}`;
  }
  if (isFeatureEnabled("CLOUDFLARE")) return `https://animbook.r2.dev/${key}`;
  return null;
}

export async function uploadAsset(input: UploadInput): Promise<UploadResult> {
  if (!isFeatureEnabled("CLOUDFLARE")) {
    const body = typeof input.body === "string" ? input.body : input.body.toString("base64");
    return {
      url: `data:${input.contentType};base64,${body.slice(0, 32)}…`,
      source: "stub"
    };
  }
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${appEnv.CLOUDFLARE_ACCOUNT_ID}/r2/objects/${encodeURIComponent(input.key)}`;
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${appEnv.CLOUDFLARE_R2_ACCESS_KEY_ID}`,
      "Content-Type": input.contentType
    },
    body: typeof input.body === "string" ? input.body : new Uint8Array(input.body)
  });
  if (!response.ok) {
    throw new Error(`Cloudflare R2 upload failed: ${response.status}`);
  }
  const json = (await response.json()) as { result?: { publicUrl?: string } };
  return {
    url: cdnUrl(input.key) ?? json.result?.publicUrl ?? `https://animbook.r2.dev/${input.key}`,
    source: "r2"
  };
}

export const cloudflareStatus = {
  live: isFeatureEnabled("CLOUDFLARE"),
  cdnBase: appEnv.CLOUDFLARE_CDN_BASE ?? null
};