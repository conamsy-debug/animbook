/**
 * WordColoring — Patch 08.
 *
 * Renders the per-word classification payload returned by
 * /api/lang/pronunciation as coloured tokens. Each token's
 * background + text colour reflects the status:
 *   - correct:   neutral (same as the player subtitle) + a green
 *                underline / dot
 *   - missed:    yellow / amber — the learner didn't say this word
 *   - different: red — the recogniser heard a different word
 *
 * The component renders from a `AlignedWord[]` produced by the
 * server's Levenshtein alignment. Tokens with `expected: null` are
 * insertions (extra words the recogniser hallucinated); tokens with
 * `transcript: null` are missed (expected words not spoken).
 */
import type { AlignedWord, WordStatus } from "./api";
import { t, type Locale } from "./i18n/t";

interface WordColoringProps {
  /** Per-word alignment payload from the server. */
  perWord: AlignedWord[];
  /** Display style — flat (rendered as tokens in a row) or with
   *  visible "missed" placeholders when the learner skipped words. */
  layout?: "inline" | "stacked";
  /** Locale for the aria labels. */
  locale?: Locale;
}

function statusClass(status: WordStatus): string {
  switch (status) {
    case "correct":
      return "lang-word-coloring-token--correct";
    case "missed":
      return "lang-word-coloring-token--missed";
    case "different":
      return "lang-word-coloring-token--different";
  }
}

function statusAriaKey(status: WordStatus, locale: Locale = "en"): string {
  // The result screen has its own copy; this aria-label is the
  // spoken-friendly version for screen readers.
  switch (status) {
    case "correct":
      return t("pronunciation.ariaCorrect", locale);
    case "missed":
      return t("pronunciation.ariaMissed", locale);
    case "different":
      return t("pronunciation.ariaDifferent", locale);
  }
}

export function WordColoring({ perWord, layout = "inline", locale = "en" }: WordColoringProps) {
  if (perWord.length === 0) return null;
  return (
    <div
      className={`lang-word-coloring lang-word-coloring--${layout}`}
      aria-label={t("pronunciation.colouringAria", locale)}
    >
      {perWord.map((w, i) => {
        const surface = w.expected ?? w.transcript ?? "";
        if (surface.length === 0) return null;
        return (
          <span
            key={i}
            className={`lang-word-coloring-token ${statusClass(w.status)}`}
            aria-label={`${surface} — ${statusAriaKey(w.status, locale)}`}
          >
            {surface}
          </span>
        );
      })}
    </div>
  );
}

/** Colour-class lookup mirror (exposed for tests + the speak_line
 *  shell so they can build the same class names without importing
 *  the component itself). */
export function wordStatusClass(status: WordStatus): string {
  return statusClass(status);
}