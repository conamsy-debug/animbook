/**
 * English UI strings for the AnimBook Languages module.
 *
 * Sourced from spec § 1 + § 7. Patch 01 ships the strings needed by
 * the landing page only; later patches extend this file as new
 * screens come online.
 *
 * Pattern: flat namespace, dot.notation keys, all values are
 * sentence-case strings. The learner-facing copy lives in the
 * base language (en or fr) — see spec § 7 "Interface language".
 */
export const en = {
  // Landing (Section 7.1)
  "landing.eyebrow": "AnimBook · Languages",
  "landing.title": "Learn a language through stories you can watch.",
  "landing.subtitle":
    "Pick a language you know and a language you want to learn. AnimBook teaches you through short animated stories — tap any word to see its meaning, save it to your deck, and come back for review.",
  "landing.cta.start": "Start learning",
  "landing.cta.continue": "Continue where I left off",
  "languagesHeading": "Seven languages to choose from",
  "languagesHint":
    "Phase 1 ships these target languages. The app interface itself follows your base language.",

  // NotAvailable (shown when the LANGUAGES_ENABLED flag is off)
  "notAvailable.title": "AnimBook Languages isn't available yet",
  "notAvailable.body":
    "We're still building this. Check back soon — or browse the rest of AnimBook in the meantime.",

  // Misc shared bits
  "nav.label": "Languages",
  "common.comingSoon": "Coming soon",

  // Interpolation + plural examples (used by tests; also real copy that
  // later patches will surface on the vocab deck and story player).
  "greeting.named": "Welcome back, {name}.",
  "story.wordsSeen": {
    one: "1 word seen in this story",
    other: "{count} words seen in this story"
  },
  "story.minutesLeft": {
    one: "1 minute left",
    other: "{count} minutes left"
  },
  "deck.saved": {
    one: "1 word saved to your deck",
    other: "{count} words saved to your deck"
  }
} as const;

export type EnKey = keyof typeof en;
