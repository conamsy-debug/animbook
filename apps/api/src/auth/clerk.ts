import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { appEnv } from "../config/env.js";

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (cachedJwks) return cachedJwks;
  cachedJwks = createRemoteJWKSet(new URL("https://api.clerk.com/v1/jwks"));
  return cachedJwks;
}

export interface ClerkVerifiedSession {
  userId: string;
  email?: string;
  name?: string;
}

/**
 * Verifies a Clerk session token using JWKS. Returns null on failure so the
 * Express middleware can fall through to demo auth when appropriate.
 */
export async function verifyClerkToken(token: string): Promise<ClerkVerifiedSession | null> {
  if (!appEnv.CLERK_SECRET_KEY) return null;
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: "https://clerk.animbook.com",
      audience: "animbook-api"
    });
    return mapClerkPayload(payload);
  } catch {
    return null;
  }
}

function mapClerkPayload(payload: JWTPayload): ClerkVerifiedSession | null {
  if (typeof payload.sub !== "string") return null;
  const email = typeof payload.email === "string" ? payload.email : undefined;
  const name = typeof payload.name === "string" ? payload.name : undefined;
  return { userId: payload.sub, email, name };
}