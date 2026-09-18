/**
 * Narrator voices readers can choose from.
 *
 * Each entry maps a stable AnimBook id to an ElevenLabs voice. Voice Library
 * voices must first be added to the ElevenLabs account ("Add to My Voices").
 *
 * Extra voices can be added without a code change by setting
 * NARRATION_VOICES to a JSON array of { id, label, description, elevenVoiceId }.
 */
export interface NarratorVoice {
  /** Stable id used in URLs and R2 keys: lowercase letters, digits, dashes. */
  id: string;
  label: string;
  description: string;
  elevenVoiceId: string;
}

const BUILT_IN: NarratorVoice[] = [
  {
    id: "nigerian-storyteller",
    label: "Nigerian storyteller",
    description: "Warm West African narrator",
    elevenVoiceId: "reGkImJki7uJOve2F4A0"
  },
  {
    id: "british-storyteller",
    label: "British storyteller",
    description: "Classic, captivating narrator (George)",
    elevenVoiceId: "JBFqnCBsd6RMkjVDRZzb"
  },
  {
    id: "british-teacher",
    label: "British teacher",
    description: "Clear, calm and educational (Alice)",
    elevenVoiceId: "Xb7hH8MSUJpSbSDYk0k2"
  },
  {
    id: "calm-guide",
    label: "Calm guide",
    description: "Slow, soothing and gentle (River)",
    elevenVoiceId: "SAz9YHcvj6GT2YYXdXww"
  },
  {
    id: "american-friendly",
    label: "American, friendly",
    description: "Upbeat and easy to follow (Matilda)",
    elevenVoiceId: "XrExE9yKIg1WjnnlVkGX"
  }
];

function fromEnv(): NarratorVoice[] {
  const raw = process.env.NARRATION_VOICES;
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as NarratorVoice[];
    return list.filter((v) => /^[a-z0-9-]{3,40}$/.test(v.id) && v.label && v.elevenVoiceId);
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

/**
 * Build the voice list as a reader would see it for a specific book, adding
 * the author's own clone under a unique id (`author:<userId>`) when present.
 * Used by `GET /api/narration/voices` to merge.
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
