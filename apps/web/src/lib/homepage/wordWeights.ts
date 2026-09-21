// Word-weighted timing for the homepage living card.
//
// We don't have word-level timestamps from ElevenLabs (the API returns
// `alignment` data but we don't store it). Per the brief, estimate on the
// client: each word is weighted by its character count, weights are
// normalized to [0, 1], and cumulative fractions give the start/end of
// each word. The "current word" is the one whose range contains
// `audio.currentTime / audio.duration`.
//
// The estimation is decent — it matches intuition that longer words take
// longer — and matches what the user hears well enough for a 24-second
// quote. It drifts on words the narrator pauses on (commas, sentence
// ends), which is acceptable.

export interface TimedWord {
  /** The original word as it appeared in the text (whitespace-stripped). */
  word: string;
  /** Fraction of total duration when this word starts (0..1). */
  start: number;
  /** Fraction of total duration when this word ends (0..1). */
  end: number;
}

/**
 * Split the text into words (whitespace separated, preserves nothing)
 * and return each word's start/end as fractions of the total duration.
 *
 *  - Empty / whitespace-only input → empty array.
 *  - Whitespace is consumed but doesn't appear in the output (the
 *    caller re-injects it as DOM text nodes around the spans).
 *  - Hyphenated words stay one word (e.g. "well-known").
 *  - Pure-punctuation tokens are dropped so they don't get a highlight
 *    slot and the surrounding text still flows.
 */
export function weightWords(text: string): TimedWord[] {
  const raw = (text ?? "").trim();
  if (!raw) return [];

  // Split on whitespace, drop empty fragments.
  const tokens = raw.split(/\s+/).filter(Boolean);
  // Strip pure-punctuation tokens (commas, periods, em-dashes). A token
  // is "pure punctuation" when its alphanumeric-stripped length is 0.
  const kept = tokens.filter((t) => t.replace(/[^\p{L}\p{N}]/gu, "").length > 0);
  if (kept.length === 0) return [];

  // Weight each kept token by its stripped character count.
  const weights = kept.map((t) => Math.max(1, t.replace(/[^\p{L}\p{N}]/gu, "").length));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return [];

  let acc = 0;
  return kept.map((word, i) => {
    const start = acc / total;
    acc += weights[i]!;
    const end = acc / total;
    return { word, start, end };
  });
}

/** Returns the index of the word containing the given fraction, or -1.
 *  The brief says highlight the word whose range contains
 *  `audio.currentTime / audio.duration`. We treat the boundary as
 *  half-open: `start <= f < end`, except the last word, which owns
 *  everything from its `start` to 1. */
export function findWordAt(words: TimedWord[], fraction: number): number {
  if (words.length === 0) return -1;
  const f = Math.max(0, Math.min(1, fraction));
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const isLast = i === words.length - 1;
    if (f >= w.start && (isLast ? f <= 1 : f < w.end)) return i;
  }
  return -1;
}
