import { Request, Response, NextFunction } from 'express';
import { appEnv, isFeatureEnabled } from "../config/env.js";
import { prisma } from "../db.js";

/**
 * Identity resolution:
 *   1. If Clerk is configured, the Clerk JWT middleware injects `auth.userId`.
 *   2. In demo mode (Clerk missing), accept either `x-demo-user-id` (E2E) or
 *      fall back to the seeded `demo@animbook.com` reader.
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

export async function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const headerUser = req.header("x-demo-user-id");
    if (headerUser) {
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

    if (isFeatureEnabled("CLERK")) {
      // Real Clerk JWT verification would attach `req.auth.userId`. In this
      // foundation slice we rely on the upstream Clerk middleware on the
      // Express app; this block is the placeholder that future production
      // wiring will populate.
      const clerkUserId = (req as AuthedRequest & { auth?: { userId?: string } }).auth?.userId;
      if (!clerkUserId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      const user = await prisma.user.findUnique({ where: { clerkId: clerkUserId } });
      if (!user) {
        res.status(401).json({ error: "Unknown authenticated user" });
        return;
      }
      req.userId = user.id;
      req.clerkId = user.clerkId;
      next();
      return;
    }

    if (!appEnv.ALLOW_DEMO_AUTH) {
      res.status(401).json({ error: "Authentication required" });
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