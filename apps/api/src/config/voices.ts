/**
 * Narrator voices readers can choose from.
 *
 * Each entry maps a stable AnimBook id to BOTH provider voice ids:
 *   - `elevenVoiceId`     — ElevenLabs voice (fallback / clone target)
 *   - `minimaxVoiceId`    — MiniMax (Hailuo) system voice (default after TTS migration)
 *
 * `minimaxVoiceId` is sourced from the live MiniMax catalogue at
 * https://api.minimax.io/v1/get_voice (POST with `voice_type=system`).
 * The two-candidate suggestions per role are recorded in
 * docs/minimax-voice-candidates.md (2026-10-16 proposal).
 *
 * Extra voices can be added without a code change by setting
 * NARRATION_VOICES to a JSON array of { id, label, description,
 * elevenVoiceId, minimaxVoiceId }.
 */
export interface NarratorVoice {
  /** Stable id used in URLs and R2 keys: lowercase letters, digits, dashes. */
  id: string;
  label: string;
  description: string;
  elevenVoiceId: string;
  /**
   * Optional MiniMax (Hailuo) system voice id. Treat as advisory — when
   * `TTS_PROVIDER=minimax` (the new default), this is the voice that fires.
   * The pipeline falls back to `elevenVoiceId` when no `minimaxVoiceId`
   * is configured.
   */
  minimaxVoiceId?: string;
}

const BUILT_IN: NarratorVoice[] = [
  {
    id: "nigerian-storyteller",
    label: "Nigerian storyteller",
    description:
      "Warm West African narrator. MiniMax has no African-accent system voice at the time of writing — the picked MiniMax match is British (closest warm male). ElevenLabs stays as the authentic-accent fallback.",
    elevenVoiceId: "reGkImJki7uJOve2F4A0",
    minimaxVoiceId: "English_expressive_narrator"
  },
  {
    id: "british-storyteller",
    label: "British storyteller",
    description: "Classic, captivating narrator (George on ElevenLabs; ‘Expressive Narrator’ on MiniMax — British male, designed for audiobook narration).",
    elevenVoiceId: "JBFqnCBsd6RMkjVDRZzb",
    minimaxVoiceId: "English_expressive_narrator"
  },
  {
    id: "british-teacher",
    label: "British teacher",
    description: "Clear, calm and educational (Alice on ElevenLabs; ‘Compelling Lady’ on MiniMax — British female, authoritative).",
    elevenVoiceId: "Xb7hH8MSUJpSbSDYk0k2",
    minimaxVoiceId: "English_compelling_lady1"
  },
  {
    id: "calm-guide",
    label: "Calm guide",
    description: "Slow, soothing and gentle (River on ElevenLabs; ‘Calm Woman’ on MiniMax — calm, soothing).",
    elevenVoiceId: "SAz9YHcvj6GT2YYXdXww",
    minimaxVoiceId: "English_CalmWoman"
  },
  {
    id: "american-friendly",
    label: "American, friendly",
    description: "Upbeat and easy to follow (Matilda on ElevenLabs; ‘Upbeat Woman’ on MiniMax — American female, bright).",
    elevenVoiceId: "XrExE9yKIg1WjnnlVkGX",
    minimaxVoiceId: "English_Upbeat_Woman"
  }
];

function fromEnv(): NarratorVoice[] {
  const raw = process.env.NARRATION_VOICES;
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as NarratorVoice[];
    return list.filter(
      (v) => /^[a-z0-9-]{3,40}$/.test(v.id) && v.label && v.elevenVoiceId
    );
  } catch {
    console.warn("[voices] NARRATION_VOICES is not valid JSON — ignored");
    return [];
  }
}

export function narratorVoices(): NarratorVoice[] {
  const extra = fromEnv();
  const ids = new Set(extra.map((v) => v.id));
  return [...extra, ...BUILT_IN.filter((v) => !ids.has(v.id))];
}

export function findVoice(id: string | undefined | null): NarratorVoice | undefined {
  if (!id) return undefined;
  return narratorVoices().find((v) => v.id === id);
}

/** Pick the right voice id for the active TTS provider. */
export function pickProviderVoiceId(voice: NarratorVoice | undefined): string | null {
  if (!voice) return null;
  const tts = (process.env.TTS_PROVIDER ?? "minimax").toLowerCase().trim();
  if (tts === "elevenlabs") return voice.elevenVoiceId;
  return voice.minimaxVoiceId ?? voice.elevenVoiceId;
}

/**
 * Build the voice list as a reader would see it for a specific book, adding
 * the author's own clone under a unique id (`author:<userId>`) when present.
 * Used by `GET /api/narration/voices` to merge.
 *
 * NOTE: the author-clone path stays on ElevenLabs (TTS provider fallback for
 * clones until MiniMax parity lands). The `elevenVoiceId` slot is still
 * the stable identifier for the cloned voice.
 */
export function voicesForReader(input: {
  authorVoiceId?: string | null;
  authorName?: string | null;
}): NarratorVoice[] {
  const base = narratorVoices();
  if (!input.authorVoiceId) return base;
  return [
    {
      id: `author:${input.authorVoiceId}`,
      label: `By ${input.authorName ?? "this author"}`,
      description: "Cloned from the author's own voice samples (with their consent).",
      elevenVoiceId: input.authorVoiceId
    },
    ...base
  ];
}

/** Default narrator id for a book, from its type and setting. */
export function defaultVoiceIdFor(book: { vertical: string; setting?: string | null }): string {
  // Learning and how-to books get the teacher wherever they are set.
  if (["EDU", "DOCS", "BUSINESS", "LAW"].includes(book.vertical)) return "british-teacher";
  // Wellness, meditation and sleep content gets the calm guide.
  if (book.vertical === "WELLNESS") return "calm-guide";
  const setting = (book.setting ?? "").toLowerCase();
  const african =
    /\b(africa|african|nigeria|lagos|abuja|ghana|accra|kenya|nairobi|mombasa|uganda|jinja|kampala|tanzania|cameroon|douala|yaound|south africa|cape town|johannesburg|senegal|dakar|ethiopia|rwanda|zimbabwe|zambia|malawi|congo|ivory coast|abidjan)\b/.test(
      setting
    );
  if (african) return "nigerian-storyteller";
  return "british-storyteller";
}
