import { Request, Response, NextFunction } from 'express';
import { appEnv, isFeatureEnabled } from "../config/env.js";
import { prisma } from "../db.js";
import { findOrProvisionUser, verifyClerkToken } from "./clerk.js";

/**
 * Identity resolution:
 *   1. If Clerk is configured (CLERK_SECRET_KEY set), the request must carry a
 *      Clerk session token — `Authorization: Bearer <jwt>`, or `?token=<jwt>`
 *      on GET requests (EventSource can't set headers). The token is verified
 *      and the matching `users` row is created on first sight.
 *   2. In demo mode (Clerk missing), accept either `x-demo-user-id` (E2E) or
 *      fall back to the seeded `demo@animbook.com` reader.
 *
 * `x-demo-user-id` is ignored whenever Clerk is on, unless
 * ALLOW_DEMO_HEADER=true is set explicitly — otherwise anyone who learned a
 * user's id could act as them in production.
 *
 * The selected identity is materialised as a row in `users` so downstream
 * code can use Prisma relations without an extra join.
 *
 * `AuthedRequest` extends `express.Request` so handlers inherit
 * `req.body` / `req.params` / `req.query` / `req.headers` automatically.
 * `userId` + `clerkId` are typed as required post-auth (set by this
 * middleware before `next()` is called); `sessionId` is optional.
 */
export interface AuthedRequest extends Request {
  userId: string;
  clerkId: string;
  sessionId?: string;
}

export type AuthedHandler = (
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

const DEMO_EMAIL = "demo@animbook.com";
const DEMO_NAME = "AnimBook Reader";

let demoUserPromise: Promise<string> | null = null;

async function resolveDemoUserId(): Promise<string> {
  if (!demoUserPromise) {
    demoUserPromise = (async () => {
      const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
      if (existing) return existing.id;
      const created = await prisma.user.create({
        data: {
          clerkId: `demo:${DEMO_EMAIL}`,
          email: DEMO_EMAIL,
          name: DEMO_NAME
        }
      });
      return created.id;
    })();
  }
  return demoUserPromise;
}

function extractToken(req: Request): string | undefined {
  const header = req.header("authorization");
  if (header && header.toLowerCase().startsWith("bearer ")) {
    const value = header.slice(7).trim();
    if (value) return value;
  }
  if (req.method === "GET" && typeof req.query.token === "string" && req.query.token) {
    return req.query.token;
  }
  return undefined;
}

const clerkOn = () => isFeatureEnabled("CLERK");
const demoHeaderAllowed = () =>
  !clerkOn() || (process.env.ALLOW_DEMO_HEADER ?? "false").toLowerCase() === "true";

export async function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const headerUser = req.header("x-demo-user-id");
    if (headerUser && demoHeaderAllowed()) {
      const user = await prisma.user.findUnique({ where: { id: headerUser } });
      if (!user) {
        res.status(401).json({ error: "Unknown demo user" });
        return;
      }
      req.userId = user.id;
      req.clerkId = user.clerkId;
      next();
      return;
    }

    if (clerkOn()) {
      const token = extractToken(req);
      if (!token) {
        res.status(401).json({ error: "Authentication required", code: "signed_out" });
        return;
      }
      const session = await verifyClerkToken(token);
      if (!session) {
        res.status(401).json({ error: "Invalid or expired session", code: "invalid_token" });
        return;
      }
      const user = await findOrProvisionUser(session.clerkUserId);
      req.userId = user.id;
      req.clerkId = user.clerkId;
      req.sessionId = session.sessionId;
      next();
      return;
    }

    if (!appEnv.ALLOW_DEMO_AUTH) {
      res.status(401).json({ error: "Authentication required", code: "signed_out" });
      return;
    }

    const userId = await resolveDemoUserId();
    req.userId = userId;
    req.clerkId = `demo:${DEMO_EMAIL}`;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUserId(req: AuthedRequest): string {
  if (!req.userId) {
    throw new Error("authMiddleware must run before this handler");
  }
  return req.userId;
}