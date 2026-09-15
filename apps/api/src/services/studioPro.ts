/**
 * AnimBook STUDIO PRO — AR/NFC companion links.
 *
 * Every published AnimBook can mint a CompanionLink that:
 *   - encodes a QR marker (deterministic 64-char hash derived from bookId)
 *   - mints a 14-char NFC tag id (looks like an NDEF URI fragment)
 *   - records an anchor page and an experience mode (AR overlay, NFC anchor, or both)
 *
 * The link is what the web companion reads. AR uses WebXR; NFC uses Web NFC
 * when the browser exposes it (Chrome on Android today). On every other
 * surface, the reader can enter the tag id manually or paste the marker URL.
 *
 * No AI calls. No third-party SDKs. Pure metadata + deterministic IDs.
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";

export const COMPANION_MODES = ["AR_OVERLAY", "NFC_ANCHOR", "AR_AND_NFC"] as const;
export type CompanionMode = (typeof COMPANION_MODES)[number];

export function generateMarkerHash(bookId: string): string {
  // 64-char hex hash from bookId + a non-secret namespace. Deterministic so
  // re-running the seed produces the same marker.
  const ns = "animbook.studio.pro.v1";
  return createHash("sha256").update(`${ns}:${bookId}`).digest("hex");
}

export function generateNfcTagId(bookId: string): string {
  // 14-char colon-grouped hex: looks like an NDEF URI fragment.
  const h = createHash("sha256").update(`animbook-nfc-v1:${bookId}`).digest("hex").slice(0, 14);
  return `AB-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}-${h.slice(12, 14)}`;
}

export interface CompanionLinkShape {
  id: string;
  bookId: string;
  markerHash: string;
  nfcTagId: string;
  experienceMode: CompanionMode | string;
  anchorPage: number;
  title: string | null;
  companionLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Idempotent: re-running for the same book returns the same link.
 */
export async function ensureCompanionLink(
  bookId: string,
  options: { experienceMode?: CompanionMode; anchorPage?: number; title?: string; companionLabel?: string } = {}
): Promise<CompanionLinkShape> {
  const existing = await prisma.companionLink.findFirst({ where: { bookId } });
  if (existing) return existing;

  const markerHash = generateMarkerHash(bookId);
  const nfcTagId = generateNfcTagId(bookId);
  try {
    return await prisma.companionLink.create({
      data: {
        bookId,
        markerHash,
        nfcTagId,
        experienceMode: options.experienceMode ?? "AR_OVERLAY",
        anchorPage: options.anchorPage ?? 1,
        title: options.title ?? null,
        companionLabel: options.companionLabel ?? null
      }
    });
  } catch (err) {
    // Race: another writer just created the row. Read it back.
    const reread = await prisma.companionLink.findFirst({ where: { bookId } });
    if (reread) return reread;
    throw err;
  }
}

export async function findCompanionLinkByMarker(markerHash: string) {
  return prisma.companionLink.findUnique({ where: { markerHash } });
}

export async function findCompanionLinkByNfc(nfcTagId: string) {
  return prisma.companionLink.findUnique({ where: { nfcTagId } });
}

export async function logCompanionSession(linkId: string, userId: string, triggerMode: CompanionMode | "MANUAL", pageReached: number) {
  return prisma.companionSession.create({
    data: {
      linkId,
      userId,
      triggerMode,
      pageReached: Math.max(1, Math.floor(pageReached))
    }
  });
}

export async function listCompanionSessions(linkId: string, limit = 20) {
  return prisma.companionSession.findMany({
    where: { linkId },
    orderBy: { startedAt: "desc" },
    take: Math.min(100, Math.max(1, limit))
  });
}

export async function summariseCompanion(linkId: string) {
  const sessions = await prisma.companionSession.groupBy({
    by: ["triggerMode"],
    where: { linkId },
    _count: true,
    _avg: { pageReached: true }
  });
  const total = sessions.reduce((sum, s) => sum + s._count, 0);
  return {
    total,
    byTrigger: sessions.map((s) => ({ triggerMode: s.triggerMode, count: s._count, avgPageReached: s._avg.pageReached ?? 0 }))
  };
}

export function mintEphemeralScanToken(): string {
  return randomBytes(12).toString("hex");
}
