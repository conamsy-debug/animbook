/**
 * AnimBook MEMORY — personalised visual adaptation.
 *
 * The reader's `MemoryProfile` captures palette, pacing, camera, narration
 * speed, font size, motion level, and the two flag-toggles (Lens, Echo).
 * The Reader frontend reads the profile on each page flip and adjusts:
 *
 *   - palette overrides the CSS accent on the page-flip border.
 *   - pacing scales the spring duration (0.4×–1.6×).
 *   - camera style hints at the Reader's framing (overhead/eye-level/POV).
 *   - narration speed scales the SpeechSynthesis utterance rate.
 *   - font size scales the rendered body text.
 *   - motion level scales the Framer Motion spring distance.
 *
 * The profile is seeded on first read with the conservative defaults above.
 * It can be updated via PUT /api/memory/settings.
 */
import { PrismaClient } from "@prisma/client";
import { isFeatureEnabled } from "../config/env.js";

const prisma = new PrismaClient();

export interface MemoryDefaults {
  palette: string;
  pacing: string;
  cameraStyle: string;
  narrationSpeed: number;
  fontSize: number;
  motionLevel: number;
  lensEnabled: boolean;
  echoEnabled: boolean;
}

export const PROFILE_PRESETS: Record<string, Partial<MemoryDefaults>> = {
  default: {},
  calm: { pacing: "leisurely", narrationSpeed: 0.85, motionLevel: 0.7, palette: "cool" },
  playful: { pacing: "brisk", narrationSpeed: 1.1, motionLevel: 1.3, palette: "warm" },
  study: { pacing: "focused", narrationSpeed: 1.0, fontSize: 20, palette: "graphite" },
  immersive: { pacing: "leisurely", narrationSpeed: 0.95, motionLevel: 1.0, palette: "neon" }
};

export async function getOrCreateMemoryProfile(userId: string) {
  const existing = await prisma.memoryProfile.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.memoryProfile.create({ data: { userId } });
}

export async function updateMemoryProfile(userId: string, patch: Partial<MemoryDefaults>) {
  const safe = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  return prisma.memoryProfile.upsert({
    where: { userId },
    create: { userId, ...safe },
    update: safe
  });
}

/**
 * Adaptive preference engine.
 *
 * When the LLM key is present, we ask Claude to look at the last 20 read
 * events and propose a personalised profile. When it is not, we fall back
 * to a deterministic heuristic: books with emotionalRegister "tense" push
 * pacing slower; EDU/KIDS verticals push narration slower; low page
 * durations push pacing faster.
 */
export async function adaptMemoryProfile(userId: string, signal: { vertical: string; emotionalRegister: string | null; timePerPageMs: number }[]): Promise<MemoryDefaults> {
  const baseline = await getOrCreateMemoryProfile(userId);
  if (!isFeatureEnabled("BOOK_BRAIN") || signal.length === 0) {
    return heuristicAdapt(baseline, signal);
  }
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": String(process.env.ANTHROPIC_API_KEY),
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 512,
        system: "Return a JSON object with keys: palette, pacing, cameraStyle, narrationSpeed, fontSize, motionLevel, lensEnabled, echoEnabled. Make the reader feel at home.",
        messages: [
          {
            role: "user",
            content: JSON.stringify({ currentProfile: baseline, recentSignal: signal.slice(-20) })
          }
        ]
      })
    });
    if (!response.ok) throw new Error(`Anthropic returned ${response.status}`);
    const json = (await response.json()) as { content?: { text?: string }[] };
    const parsed = JSON.parse(json.content?.[0]?.text ?? "{}") as Partial<MemoryDefaults>;
    return updateMemoryProfile(userId, parsed);
  } catch {
    return heuristicAdapt(baseline, signal);
  }
}

function heuristicAdapt(baseline: { userId: string; palette: string; pacing: string; cameraStyle: string; narrationSpeed: number; fontSize: number; motionLevel: number; lensEnabled: boolean; echoEnabled: boolean }, signal: { vertical: string; emotionalRegister: string | null; timePerPageMs: number }[]) {
  const patch: Partial<MemoryDefaults> = {};
  const avgTime = signal.reduce((sum, s) => sum + s.timePerPageMs, 0) / signal.length;
  if (avgTime > 30000) patch.pacing = "leisurely";
  if (avgTime < 8000) patch.pacing = "brisk";
  const tenseShare = signal.filter((s) => s.emotionalRegister === "tense" || s.emotionalRegister === "scared").length / signal.length;
  if (tenseShare > 0.4) patch.narrationSpeed = Math.min(baseline.narrationSpeed, 0.95);
  if (signal.some((s) => s.vertical === "EDU" || s.vertical === "KIDS")) {
    patch.narrationSpeed = Math.min(baseline.narrationSpeed, 0.95);
  }
  return updateMemoryProfile(baseline.userId, patch);
}