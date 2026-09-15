/**
 * KIDS vertical services.
 *
 * - Character voice mapping: per-character ElevenLabs voice IDs.
 * - Bedtime pacing: slower narration rate, dim palette, no emotional peaks.
 * - Achievement catalogue: read first page, finish a book, three books in 7 days,
 *   bedtime streak.
 */

export interface CharacterVoiceMap {
  character: string;
  voiceId: string;
  pitch: number;
  rate: number;
}

export const KIDS_VOICES: CharacterVoiceMap[] = [
  { character: "narrator", voiceId: "21m00Tcm4TlvDq8ikWAM", pitch: 0, rate: 0.95 },
  { character: "rabbit", voiceId: "AZnzlk1XvdvUeBnXmlld", pitch: 1.2, rate: 1.05 },
  { character: "fox", voiceId: "VR6AewLTigWG4xSOukaG", pitch: -2, rate: 0.9 },
  { character: "bear", voiceId: "N2lVS1w4EtoT3dr5eRW0", pitch: -4, rate: 0.85 },
  { character: "child", voiceId: "TxGEqnHWrfWFTfGW9XjX", pitch: 2, rate: 1.1 },
  { character: "mother", voiceId: "ThT5KcBeYPX3keUQ32H3", pitch: -1, rate: 0.95 },
  { character: "father", voiceId: "cjVigY5qzO86Huf0Swal", pitch: -3, rate: 0.95 },
  { character: "wizard", voiceId: "iP95p4aoKVQ53ZUTDULc", pitch: -1, rate: 0.9 },
  { character: "queen", voiceId: "jBpfuIE2acCOa6b74Tz7", pitch: 0, rate: 1.0 }
];

/**
 * Look up the voice by character name. Falls back to the narrator voice.
 */
export function voiceForCharacter(name: string | null): CharacterVoiceMap {
  if (!name) return KIDS_VOICES[0]!;
  const lower = name.toLowerCase().trim();
  const match = KIDS_VOICES.find((v) => v.character === lower);
  if (match) return match;
  const fuzzy = KIDS_VOICES.find((v) => lower.includes(v.character));
  return fuzzy ?? KIDS_VOICES[0]!;
}

/**
 * Bedtime pacing profile.
 *
 * Slows narration, lowers scene energy, and selects gentler animation loops.
 */
export interface BedtimeProfile {
  narrationRate: number;
  fadeInSeconds: number;
  maxEmotionIntensity: number;
  palette: { background: string; surface: string; text: string };
}

export function bedtimeProfile(): BedtimeProfile {
  return {
    narrationRate: 0.78,
    fadeInSeconds: 1.2,
    maxEmotionIntensity: 4,
    palette: {
      background: "#0A0710",
      surface: "#1A1322",
      text: "#C9A8C6"
    }
  };
}

export interface AchievementTemplate {
  code: string;
  title: string;
  description: string;
}

export const ACHIEVEMENT_CATALOG: AchievementTemplate[] = [
  {
    code: "first_flip",
    title: "First flip",
    description: "You flipped your first AnimPage. The world is awake."
  },
  {
    code: "book_completed",
    title: "Storyteller",
    description: "You read an AnimBook all the way to the end."
  },
  {
    code: "three_in_seven",
    title: "Reading streak",
    description: "Three AnimBooks in seven days. The medium loves you back."
  },
  {
    code: "bedtime_streak",
    title: "Bedtime ritual",
    description: "Five bedtime-mode sessions. Sweet dreams, official."
  },
  {
    code: "edu_first_checkpoint",
    title: "Scholar",
    description: "You answered your first EDU checkpoint."
  }
];

export function defaultAchievementDescription(code: string): string {
  return ACHIEVEMENT_CATALOG.find((a) => a.code === code)?.description ?? "";
}

export function defaultAchievementTitle(code: string): string {
  return ACHIEVEMENT_CATALOG.find((a) => a.code === code)?.title ?? code;
}