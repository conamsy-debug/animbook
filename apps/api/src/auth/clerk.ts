import { createClerkClient, verifyToken } from "@clerk/backend";
import { appEnv } from "../config/env.js";
import { isOriginAllowed } from "../config/origins.js";
import { prisma } from "../db.js";

export interface ClerkVerifiedSession {
  clerkUserId: string;
  sessionId?: string;
}

let clerkClient: ReturnType<typeof createClerkClient> | null = null;
function getClerkClient() {
  if (!clerkClient) clerkClient = createClerkClient({ secretKey: appEnv.CLERK_SECRET_KEY });
  return clerkClient;
}

/**
 * Verifies a Clerk session token (the short-lived JWT the browser gets from
 * `session.getToken()`). JWKS is fetched with CLERK_SECRET_KEY and cached by
 * @clerk/backend, so this works for both dev (pk_test) and production
 * instances without hard-coding an issuer.
 *
 * Returns null on any failure so the middleware can answer 401 cleanly.
 */
export async function verifyClerkToken(token: string): Promise<ClerkVerifiedSession | null> {
  if (!appEnv.CLERK_SECRET_KEY) return null;
  try {
    const payload = await verifyToken(token, { secretKey: appEnv.CLERK_SECRET_KEY });
    if (typeof payload.sub !== "string") return null;
    // `azp` = origin that requested the token. Reuse the CORS allowlist so a
    // token minted on some other site can't be replayed against the API.
    const azp = typeof payload.azp === "string" ? payload.azp : undefined;
    if (azp && !isOriginAllowed(azp)) return null;
    const sessionId = typeof payload.sid === "string" ? payload.sid : undefined;
    return { clerkUserId: payload.sub, sessionId };
  } catch {
    return null;
  }
}

/**
 * Finds the `users` row for a Clerk user, creating it on first sign-in
 * (just-in-time provisioning — no webhook required).
 *
 * In-flight provisioning is de-duplicated per Clerk user, because a freshly
 * signed-in page fires several API calls at once.
 */
const inflight = new Map<string, Promise<{ id: string; clerkId: string }>>();

export async function findOrProvisionUser(clerkUserId: string): Promise<{ id: string; clerkId: string }> {
  const existing = await prisma.user.findUnique({
    where: { clerkId: clerkUserId },
    select: { id: true, clerkId: true }
  });
  if (existing) return existing;

  let pending = inflight.get(clerkUserId);
  if (!pending) {
    pending = provision(clerkUserId).finally(() => inflight.delete(clerkUserId));
    inflight.set(clerkUserId, pending);
  }
  return pending;
}

async function provision(clerkUserId: string): Promise<{ id: string; clerkId: string }> {
  const clerkUser = await getClerkClient().users.getUser(clerkUserId);
  const primary = clerkUser.primaryEmailAddress;
  const email = (primary?.emailAddress ?? `${clerkUserId}@users.animbook.com`).toLowerCase();
  const emailVerified = primary?.verification?.status === "verified";
  const avatarUrl = clerkUser.imageUrl || null;
  const name =
    clerkUser.fullName?.trim() ||
    clerkUser.username ||
    email.split("@")[0] ||
    "AnimBook Reader";

  try {
    // If a seeded / pre-Clerk row already owns this email, adopt it — but only
    // when Clerk has verified the reader actually controls that address.
    const byEmail = await prisma.user.findUnique({ where: { email }, select: { id: true, clerkId: true } });
    if (byEmail) {
      if (emailVerified && !byEmail.clerkId.startsWith("user_")) {
        return prisma.user.update({
          where: { id: byEmail.id },
          data: { clerkId: clerkUserId, avatarUrl },
          select: { id: true, clerkId: true }
        });
      }
      // Email belongs to a different Clerk account: create with a unique placeholder.
      return prisma.user.create({
        data: { clerkId: clerkUserId, email: `${clerkUserId}@users.animbook.com`, name, avatarUrl },
        select: { id: true, clerkId: true }
      });
    }
    return await prisma.user.create({
      data: { clerkId: clerkUserId, email, name, avatarUrl },
      select: { id: true, clerkId: true }
    });
  } catch (err) {
    // Lost a race with another instance: the row now exists.
    if ((err as { code?: string }).code === "P2002") {
      const row = await prisma.user.findUnique({
        where: { clerkId: clerkUserId },
        select: { id: true, clerkId: true }
      });
      if (row) return row;
    }
    throw err;
  }
}

/**
 * Remove the reader's Clerk login (used by GDPR erasure). Only real Clerk ids
 * ("user_…") are sent; demo and already-anonymised ids are ignored.
 */
export async function deleteClerkUser(clerkUserId: string): Promise<boolean> {
  if (!appEnv.CLERK_SECRET_KEY || !clerkUserId.startsWith("user_")) return false;
  await getClerkClient().users.deleteUser(clerkUserId);
  return true;
}
