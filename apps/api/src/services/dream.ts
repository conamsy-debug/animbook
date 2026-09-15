/**
 * AnimBook DREAM — runtime auto-pacing for the WELLNESS vertical.
 *
 * When a reader opens a WELLNESS AnimBook, the runtime applies a profile
 * that nudges the visual layer to "sleep-mode": slower pacing, dimmer
 * palette, larger body text, slower narration, and a soft ambient track.
 *
 * The profile is purely a *translation* of the book metadata (vertical,
 * moodTags, genreTags) — there is no AI call and no LLM dependency. The
 * reader can override any of these per-book without touching the global
 * MemoryProfile.
 */
import { prisma } from "../db.js";

export type DreamAmbientTrack = "ocean_waves" | "rainforest" | "fireplace" | "river" | "white_noise";

export interface DreamProfile {
  /** CSS palette hint that the Reader honors. */
  palette: "cool" | "graphite" | "default";
  /** Slow / leisurely pacing preset. */
  pacing: "leisurely" | "default";
  /** Birds-eye or fixed framing — never handheld swinging. */
  cameraStyle: "fixed" | "wide" | "default";
  /** Narration rate scaled into the Reader's SpeechSynthesis. */
  narrationSpeed: number;
  /** Larger body text for low-light reading. */
  fontSize: number;
  /** Dampened motion so the page does not jolt attention. */
  motionLevel: number;
  /** Duration of the page-flip spring (ms). */
  flipDurationMs: number;
  /** Trigger dim-screen overlay. */
  dimScreen: boolean;
  /** Soft ambient track looped during the session. */
  ambientTrack: DreamAmbientTrack;
  /** Display caption shown to the reader. */
  caption: string;
}

export const DREAM_AMBIENT_LIBRARY: Record<DreamAmbientTrack, { label: string; description: string; syllable: string }> = {
  ocean_waves: { label: "Ocean waves", description: "Soft waves on a quiet shore", syllable: "shhhhh" },
  rainforest: { label: "Rainforest", description: "Distant rain and rustling leaves", syllable: "shhhhh" },
  fireplace: { label: "Fireplace", description: "Wood crackling low", syllable: "hmmm" },
  river: { label: "River", description: "Slow water over a pebbled bed", syllable: "shhhhh" },
  white_noise: { label: "White noise", description: "Even soft hiss for deep focus", syllable: "hmmm" }
};

/**
 * 20 minutes of no progress events = we assume the reader fell asleep.
 * This is the threshold used by the runtime to mark a session as successful.
 */
export const DREAM_SLEEP_THRESHOLD_MS = 20 * 60 * 1000;

/**
 * Translate book metadata into a DREAM profile. Pure function: no DB.
 *
 * The mood tags hint at the ambient track:
 *   - "calm" / "soft" → ocean_waves or river
 *   - "grounded" / "warm" → fireplace
 *   - "sleepy" → white_noise
 *   - default → ocean_waves
 */
export function dreamProfileForBook(book: {
  vertical: string;
  moodTags?: string[];
  genreTags?: string[];
  title: string;
  author?: string | null;
}): DreamProfile {
  const mood = (book.moodTags ?? []).map((t) => t.toLowerCase());
  let ambientTrack: DreamAmbientTrack = "ocean_waves";
  if (mood.includes("sleepy")) ambientTrack = "white_noise";
  else if (mood.includes("grounded") || mood.includes("warm")) ambientTrack = "fireplace";
  else if (mood.includes("calm") || mood.includes("soft")) ambientTrack = "ocean_waves";
  if (ambientTrack === "ocean_waves" && mood.includes("water")) ambientTrack = "river";

  const isWellness = book.vertical === "WELLNESS";
  if (!isWellness) {
    // Non-WELLNESS books never auto-dream. Caller is responsible.
    return {
      palette: "default",
      pacing: "default",
      cameraStyle: "default",
      narrationSpeed: 1,
      fontSize: 18,
      motionLevel: 1,
      flipDurationMs: 540,
      dimScreen: false,
      ambientTrack,
      caption: ""
    };
  }

  return {
    palette: "cool",
    pacing: "leisurely",
    cameraStyle: "fixed",
    narrationSpeed: 0.7,
    fontSize: 22,
    motionLevel: 0.4,
    flipDurationMs: 880,
    dimScreen: true,
    ambientTrack,
    caption: `${book.title} · DREAM mode`
  };
}

export async function ensureDreamSession(userId: string, bookId: string): Promise<{ id: string; startedAt: Date }> {
  const open = await prisma.dreamSession.findFirst({
    where: { userId, bookId, endedAt: null },
    orderBy: { startedAt: "desc" }
  });
  if (open) return { id: open.id, startedAt: open.startedAt };
  const created = await prisma.dreamSession.create({
    data: { userId, bookId, ambientTrack: "ocean_waves" }
  });
  return { id: created.id, startedAt: created.startedAt };
}

export async function recordDreamProgress(sessionId: string, pagesRead: number): Promise<void> {
  await prisma.dreamSession.update({
    where: { id: sessionId },
    data: { pagesRead: Math.max(0, Math.floor(pagesRead)) }
  });
}

export async function endDreamSession(sessionId: string, reason: string, fellAsleep: boolean): Promise<void> {
  await prisma.dreamSession.update({
    where: { id: sessionId },
    data: {
      endedAt: new Date(),
      fellAsleepAt: fellAsleep ? new Date() : null,
      exitReason: reason.slice(0, 500)
    }
  });
}

export async function recentDreamSessions(userId: string, limit = 10) {
  return prisma.dreamSession.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: Math.min(50, Math.max(1, limit))
  });
}
