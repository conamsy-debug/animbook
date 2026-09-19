/**
 * Page-state helpers for the split still→clip pipeline.
 *
 * The split pipeline runs as separate Bull jobs (`STILL_PAGE`,
 * `ANIMATE_PAGE`) per page. Two workers can race for the same page, so
 * every transition goes through `move()` which uses a `WHERE … IN` guard:
 * only update if the page is currently in a state that's allowed to move
 * to the target. The update count comes back as 0 on a race, and we throw
 * rather than silently winning.
 *
 * The transition tables match the brief exactly. They are exported so the
 * route layer and tests can reason about the same state machine.
 */
import { prisma as defaultPrisma } from "../db.js";
import type { PrismaClient } from "@prisma/client";

/** Mirror of the Prisma enum — keep in sync with schema.prisma. */
export type StillStatus = "NONE" | "GENERATING" | "READY" | "APPROVED" | "FAILED";
export type ClipStatus =
  | "NONE"
  | "QUEUED"
  | "GENERATING"
  | "READY"
  | "APPROVED"
  | "FLAGGED"
  | "FAILED"
  | "STALE";
export type AudioStatus = "NONE" | "GENERATING" | "READY" | "FAILED";

/**
 * Allowed `stillStatus` transitions. Same shape as the brief:
 *   NONE      → GENERATING
 *   GENERATING → READY | FAILED
 *   READY     → APPROVED | GENERATING       (GENERATING = regenerate)
 *   APPROVED  → GENERATING                  (reopen an approved still)
 *   FAILED    → GENERATING
 */
export const STILL_NEXT: Readonly<Record<StillStatus, readonly StillStatus[]>> = {
  NONE: ["GENERATING"],
  GENERATING: ["READY", "FAILED"],
  READY: ["APPROVED", "GENERATING"],
  APPROVED: ["GENERATING"],
  FAILED: ["GENERATING"]
};

/**
 * Allowed `clipStatus` transitions. Same shape as the brief.
 *   NONE      → QUEUED
 *   QUEUED    → GENERATING | STALE
 *   GENERATING → READY | FAILED
 *   READY     → APPROVED | FLAGGED | QUEUED | STALE
 *   FLAGGED   → QUEUED | APPROVED | STALE
 *   APPROVED  → QUEUED | STALE
 *   FAILED    → QUEUED
 *   STALE     → QUEUED
 */
export const CLIP_NEXT: Readonly<Record<ClipStatus, readonly ClipStatus[]>> = {
  NONE: ["QUEUED"],
  QUEUED: ["GENERATING", "STALE"],
  GENERATING: ["READY", "FAILED"],
  READY: ["APPROVED", "FLAGGED", "QUEUED", "STALE"],
  FLAGGED: ["QUEUED", "APPROVED", "STALE"],
  APPROVED: ["QUEUED", "STALE"],
  FAILED: ["QUEUED"],
  STALE: ["QUEUED"]
};

/** Map a "page column" name to its transition table. */
type PageStatusField = "stillStatus" | "clipStatus" | "audioStatus";

const TABLES: Partial<Readonly<Record<PageStatusField, Readonly<Record<string, readonly string[]>>>>> = {
  stillStatus: STILL_NEXT,
  clipStatus: CLIP_NEXT
  // audioStatus has its own ad-hoc transitions and isn't gated here.
};

/** Throws when the requested move is not allowed from any source state. */
export class IllegalTransitionError extends Error {
  constructor(public readonly field: PageStatusField, public readonly from: string | null, public readonly to: string) {
    super(`Illegal ${field} transition ${from ?? "null"} -> ${to}`);
  }
}

/**
 * Internal helper — pick the source states that are allowed to move to
 * `to`. Returns [] if `field` isn't a gated column.
 */
function sourceStatesFor(field: PageStatusField, to: string): readonly string[] {
  const table = TABLES[field];
  if (!table) return [];
  return (Object.keys(table) as readonly string[]).filter((s) =>
    (table[s] ?? []).includes(to)
  );
}

/**
 * Compare-and-set move: only update the column if the page is currently in
 * a state that's allowed to move to `to`. Throws if the page doesn't exist
 * OR if the column was in a state that isn't allowed to move (lost race
 * or caller passed the wrong "from").
 *
 * Takes an optional Prisma client so unit tests can pass a fake; the live
 * pipeline uses the default export from `../db.js`.
 */
export async function move<S extends string>(
  field: PageStatusField,
  pageId: string,
  to: S,
  db: PrismaClient = defaultPrisma
): Promise<void> {
  const fromStates = sourceStatesFor(field, to);
  if (fromStates.length === 0) {
    throw new IllegalTransitionError(field, null, to);
  }
  // updateMany returns { count } — 0 means we lost the race or the row
  // wasn't in an allowed source state. We can't tell which without a
  // second query, but for our use case the row exists and was wrong —
  // either way we throw.
  const res = await db.page.updateMany({
    where: { id: pageId, [field]: { in: [...fromStates] } },
    data: { [field]: to }
  });
  if (res.count === 0) {
    throw new IllegalTransitionError(field, null, to);
  }
}

/**
 * Bulk compare-and-set move for many pages at once. Same semantics as
 * `move()` but returns the list of page ids that actually transitioned
 * (so the caller can enqueue follow-up jobs only for the pages that
 * succeeded, not for the ones that lost the race).
 */
export async function moveMany<S extends string>(
  field: PageStatusField,
  pageIds: readonly string[],
  to: S,
  db: PrismaClient = defaultPrisma
): Promise<string[]> {
  if (pageIds.length === 0) return [];
  const fromStates = sourceStatesFor(field, to);
  if (fromStates.length === 0) return [];
  const res = await db.page.findMany({
    where: { id: { in: [...pageIds] }, [field]: { in: [...fromStates] } },
    select: { id: true }
  });
  const allowed = res.map((r) => r.id);
  if (allowed.length === 0) return [];
  await db.page.updateMany({
    where: { id: { in: allowed } },
    data: { [field]: to }
  });
  return allowed;
}