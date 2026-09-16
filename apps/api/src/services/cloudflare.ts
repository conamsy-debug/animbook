/**
 * Cloudflare R2 upload client + CDN URL resolution.
 *
 * R2 speaks the S3 API, so uploads are SigV4-signed PUTs against
 *   https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com/<bucket>/<key>
 * using the R2 Access Key ID + Secret Access Key (aws4fetch does the signing).
 *
 * Public URLs come from CLOUDFLARE_CDN_BASE — the bucket's public hostname,
 * e.g. https://media.animbook.com (custom domain connected to the bucket) or
 * the bucket's https://pub-<hash>.r2.dev development URL.
 *
 * When credentials are missing we return a data: URI stub so the rest of the
 * pipeline can still publish a draft AnimBook.
 */
import { AwsClient } from "aws4fetch";
import { appEnv, isFeatureEnabled } from "../config/env.js";

export interface UploadInput {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType: string;
  cacheControl?: string;
}

export interface UploadResult {
  url: string;
  key: string;
  source: "r2" | "stub";
}

let client: AwsClient | null = null;
function r2(): AwsClient {
  if (!client) {
    client = new AwsClient({
      accessKeyId: appEnv.CLOUDFLARE_R2_ACCESS_KEY_ID!,
      secretAccessKey: appEnv.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
      service: "s3",
      region: "auto"
    });
  }
  return client;
}

function objectUrl(key: string): string {
  const cleanKey = key.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `https://${appEnv.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/${appEnv.CLOUDFLARE_R2_BUCKET}/${cleanKey}`;
}

/**
 * Resolve an R2 object key to its public URL. Absolute URLs and data: URIs
 * pass through unchanged. Returns null when no public base is configured.
 */
export function cdnUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key;
  if (key.startsWith("data:")) return key;
  if (appEnv.CLOUDFLARE_CDN_BASE) {
    const base = appEnv.CLOUDFLARE_CDN_BASE.replace(/\/+$/, "");
    return `${base}/${key.replace(/^\/+/, "")}`;
  }
  return null;
}

export async function uploadAsset(input: UploadInput): Promise<UploadResult> {
  if (!isFeatureEnabled("CLOUDFLARE")) {
    const raw = typeof input.body === "string" ? input.body : Buffer.from(input.body).toString("base64");
    return { url: `data:${input.contentType};base64,${raw.slice(0, 32)}…`, key: input.key, source: "stub" };
  }
  const publicUrl = cdnUrl(input.key);
  if (!publicUrl) {
    throw new Error("CLOUDFLARE_CDN_BASE is not set — R2 objects would have no public URL");
  }
  const body = typeof input.body === "string" ? input.body : new Uint8Array(input.body);
  const response = await r2().fetch(objectUrl(input.key), {
    method: "PUT",
    headers: {
      "Content-Type": input.contentType,
      "Cache-Control": input.cacheControl ?? "public, max-age=31536000, immutable"
    },
    body
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`R2 upload failed (${response.status}) for ${input.key}: ${detail.slice(0, 300)}`);
  }
  return { url: publicUrl, key: input.key, source: "r2" };
}

/** Download a remote file (e.g. a Runway output, which expires) and store it in R2. */
export async function mirrorToR2(sourceUrl: string, key: string, fallbackContentType: string): Promise<UploadResult> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${sourceUrl.slice(0, 80)}`);
  const contentType = res.headers.get("content-type")?.split(";")[0] || fallbackContentType;
  const buf = new Uint8Array(await res.arrayBuffer());
  return uploadAsset({ key, body: buf, contentType });
}

export const cloudflareStatus = {
  live: isFeatureEnabled("CLOUDFLARE"),
  cdnBase: appEnv.CLOUDFLARE_CDN_BASE ?? null
};
