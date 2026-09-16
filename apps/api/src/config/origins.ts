import { appEnv } from "./env.js";

/**
 * Single source of truth for which browser origins may talk to the API.
 * Used by CORS (index.ts) and by Clerk token verification (the `azp`
 * claim on a session token is the origin that minted it).
 *
 * WEB_ORIGIN is a comma-separated allowlist; localhost:3000 is always
 * permitted so local smokes still work. When ALLOW_RAILWAY_PREVIEW=true,
 * any *.up.railway.app origin is also accepted.
 */
const ALWAYS_ALLOWED_ORIGINS = ["http://localhost:3000"];
const RAILWAY_PREVIEW_PATTERN = /^https:\/\/[a-z0-9-]+\.up\.railway\.app$/i;

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin, server-to-server, curl, mobile
  const allowList = [...appEnv.WEB_ORIGIN_LIST, ...ALWAYS_ALLOWED_ORIGINS];
  if (allowList.includes(origin)) return true;
  if (appEnv.ALLOW_RAILWAY_PREVIEW && RAILWAY_PREVIEW_PATTERN.test(origin)) return true;
  return false;
}
