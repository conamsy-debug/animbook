/**
 * Usage / cost tracking.
 *
 * The /api/usage/summary endpoint and the Profile "Spending" section
 * read from the usage_events table. This module owns the write path:
 *
 *   recordUsage({...})         — fire-and-forget insert; never throws.
 *   getUsageSummary({userId})  — aggregate totalUsd by kind / provider /
 *                                 book, with a `since` window.
 *
 * Pricing constants (ELEVENLABS_USD_PER_1K_CHARS, RUNWAY_CREDITS_PER_PAGE,
 * RUNWAY_USD_PER_CREDIT) live here too so the routes that call
 * recordUsage don't each have to know the rates.
 *
 * Cost math is best-effort. We snapshot unitCostUsd at write time so
 * historical reports don't drift when providers change prices. If a
 * call ends in FAILED / STUB we still record the row (units=0 or a
 * negative totalUsd) so the dashboard can show "you attempted X,
 * Y succeeded, Z failed".
 */
import { prisma } from "../db.js";

export const ELEVENLABS_USD_PER_1K_CHARS = 0.18;
export const RUNWAY_CREDITS_PER_IMAGE = 5;
export const RUNWAY_CREDITS_PER_SECOND = 5;
export const RUNWAY_USD_PER_CREDIT = 0.01;

export type UsageKind =
  | "ANIMATE_KICK"
  | "STILL_KICK"
  | "NARRATION_KICK"
  | "AUDIO_REGEN"
  | "TRAILER";

export type UsageProvider = "RUNWAY" | "ELEVENLABS";

export interface RecordUsageInput {
  userId: string;
  bookId: string;
  pageId?: string | null;
  kind: UsageKind;
  provider: UsageProvider;
  units: number;
  unitCostUsd: number;
  status?: "SUCCESS" | "FAILED" | "STUB";
  metadata?: Record<string, unknown>;
}

/**
 * Insert one usage row. Catches + logs errors so callers (request
 * handlers) don't have to wrap their hot path in a try/catch.
 */
export async function recordUsage(input: RecordUsageInput): Promise<void> {
  try {
    const totalUsd = Math.round(input.units * input.unitCostUsd * 100) / 100;
    const data: {
      userId: string;
      bookId: string;
      pageId?: string | null;
      kind: string;
      provider: string;
      units: number;
      unitCostUsd: number;
      totalUsd: number;
      status: string;
      metadata?: Record<string, unknown>;
    } = {
      userId: input.userId,
      bookId: input.bookId,
      kind: input.kind,
      provider: input.provider,
      units: Math.max(0, Math.floor(input.units)),
      unitCostUsd: input.unitCostUsd,
      totalUsd,
      status: input.status ?? "SUCCESS"
    };
    if (input.pageId !== undefined) data.pageId = input.pageId;
    if (input.metadata) data.metadata = input.metadata;
    await prisma.usageEvent.create({ data });
  } catch (err) {
    // Never let tracking failures break the user-facing flow.
    console.warn("[usageTracking] failed to record event:", (err as Error).message);
  }
}

export interface UsageSummary {
  totalUsd: number;
  totalEvents: number;
  byKind: Array<{ kind: UsageKind; totalUsd: number; events: number }>;
  byProvider: Array<{ provider: UsageProvider; totalUsd: number; events: number }>;
  byBook: Array<{ bookId: string; title: string; totalUsd: number; events: number }>;
  /** Per-day totals (UTC date strings like "2026-09-19"), oldest first. */
  byDay: Array<{ date: string; totalUsd: number; events: number }>;
}

export async function getUsageSummary(userId: string, since: Date = new Date(Date.now() - 30 * 86_400_000)): Promise<UsageSummary> {
  // Filter in Prisma — indexes on (userId, createdAt) and (userId, kind, createdAt)
  // keep this cheap as the table grows.
  const rows = await prisma.usageEvent.findMany({
    where: { userId, createdAt: { gte: since } },
    select: {
      kind: true,
      provider: true,
      units: true,
      totalUsd: true,
      createdAt: true,
      bookId: true,
      book: { select: { title: true } }
    },
    orderBy: { createdAt: "desc" }
  });

  const totalUsd = rows.reduce((sum, r) => sum + r.totalUsd, 0);
  const totalEvents = rows.length;

  // Group by kind
  const kindMap = new Map<string, { totalUsd: number; events: number }>();
  for (const r of rows) {
    const cur = kindMap.get(r.kind) ?? { totalUsd: 0, events: 0 };
    cur.totalUsd += r.totalUsd;
    cur.events += 1;
    kindMap.set(r.kind, cur);
  }
  const byKind = Array.from(kindMap.entries()).map(([kind, v]) => ({
    kind: kind as UsageKind,
    totalUsd: Math.round(v.totalUsd * 100) / 100,
    events: v.events
  })).sort((a, b) => b.totalUsd - a.totalUsd);

  // Group by provider
  const providerMap = new Map<string, { totalUsd: number; events: number }>();
  for (const r of rows) {
    const cur = providerMap.get(r.provider) ?? { totalUsd: 0, events: 0 };
    cur.totalUsd += r.totalUsd;
    cur.events += 1;
    providerMap.set(r.provider, cur);
  }
  const byProvider = Array.from(providerMap.entries()).map(([provider, v]) => ({
    provider: provider as UsageProvider,
    totalUsd: Math.round(v.totalUsd * 100) / 100,
    events: v.events
  })).sort((a, b) => b.totalUsd - a.totalUsd);

  // Group by book
  const bookMap = new Map<string, { title: string; totalUsd: number; events: number }>();
  for (const r of rows) {
    const cur = bookMap.get(r.bookId) ?? { title: r.book?.title ?? "(deleted)", totalUsd: 0, events: 0 };
    cur.totalUsd += r.totalUsd;
    cur.events += 1;
    bookMap.set(r.bookId, cur);
  }
  const byBook = Array.from(bookMap.entries()).map(([bookId, v]) => ({
    bookId,
    title: v.title,
    totalUsd: Math.round(v.totalUsd * 100) / 100,
    events: v.events
  })).sort((a, b) => b.totalUsd - a.totalUsd);

  // Per-day totals (UTC)
  const dayMap = new Map<string, { totalUsd: number; events: number }>();
  for (const r of rows) {
    const date = r.createdAt.toISOString().slice(0, 10);
    const cur = dayMap.get(date) ?? { totalUsd: 0, events: 0 };
    cur.totalUsd += r.totalUsd;
    cur.events += 1;
    dayMap.set(date, cur);
  }
  const byDay = Array.from(dayMap.entries()).map(([date, v]) => ({
    date,
    totalUsd: Math.round(v.totalUsd * 100) / 100,
    events: v.events
  })).sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalUsd: Math.round(totalUsd * 100) / 100,
    totalEvents,
    byKind,
    byProvider,
    byBook,
    byDay
  };
}

/* --------------------------------------------------------------------- *
 * Cost helpers — used by routes before they enqueue work, so the
 * estimated number matches what gets recorded.
 * --------------------------------------------------------------------- */

/** Pages × seconds × credits-per-sec × USD-per-credit. */
export function estimateAnimateCostUsd(pages: { motionTier: "HERO" | "STANDARD" }[]): number {
  let seconds = 0;
  for (const p of pages) {
    seconds += p.motionTier === "HERO" ? 10 : 5;
  }
  return estimateClipCostUsd(seconds);
}

/** Seconds × credits-per-sec × USD-per-credit. */
export function estimateClipCostUsd(seconds: number): number {
  return Math.round(seconds * RUNWAY_CREDITS_PER_SECOND * RUNWAY_USD_PER_CREDIT * 100) / 100;
}

/** Chars × USD per 1k chars. */
export function estimateAudioCostUsd(chars: number): number {
  return Math.round((chars / 1000) * ELEVENLABS_USD_PER_1K_CHARS * 100) / 100;
}

/** Pages × credits-per-image × USD-per-credit. */
export function estimateStillCostUsd(pages: number): number {
  return Math.round(pages * RUNWAY_CREDITS_PER_IMAGE * RUNWAY_USD_PER_CREDIT * 100) / 100;
}
