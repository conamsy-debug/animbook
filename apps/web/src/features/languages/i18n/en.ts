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

  // Onboarding (Section 7.2)
  "onboarding.title": "Welcome to AnimBook Languages",
  "onboarding.subtitle":
    "Tell us which language you already speak and which one you'd like to learn.",
  "onboarding.baseLabel": "I speak",
  "onboarding.targetLabel": "I want to learn",
  "onboarding.dailyGoalLabel": "Daily goal (optional)",
  "onboarding.dailyGoalHint": "We'll send a gentle nudge if you fall behind.",
  "onboarding.dailyGoal.none": "No goal",
  "onboarding.dailyGoal.relaxed": "5 min · relaxed",
  "onboarding.dailyGoal.regular": "10 min · regular",
  "onboarding.dailyGoal.serious": "20 min · serious",
  "onboarding.submit": "Start my first story",
  "onboarding.error.sameLang": "Pick a target that's different from the language you speak.",
  "onboarding.error.generic": "Something went wrong. Try again in a moment.",

  // My enrollments (Section 7 onboarding follow-up)
  "me.title": "My languages",
  "me.empty": "You haven't started a language yet.",
  "me.browseAll": "Browse languages",
  "me.lastActive": "Last active {when}",
  "me.startNew": "Start another language",

  // Course home (Section 7.3)
  "course.title": "{title}",
  "course.storiesHeading": "Stories",
  "course.statsHeading": "Your progress",
  "course.streak": {
    one: "1-day streak",
    other: "{count}-day streak"
  },
  "course.xp": {
    one: "1 XP",
    other: "{count} XP"
  },
  "course.lastActivity": "Last active {when}",
  "course.notEnrolled": "You're previewing this course. Start it to track your progress.",
  "course.enroll": "Start this course",
  "course.continueStory": "Continue",
  "course.startStory": "Start",
  "course.reviewStory": "Review",
  "course.status.notStarted": "Not started",
  "course.status.inProgress": "In progress",
  "course.status.completed": "Completed",
  "course.dailyGoal": "Daily goal: {minutes} min",

  // Story player
  "player.savedProgress": "Progress saved",
  "player.completeStory": "Mark story complete",

  // Word popup (Patch 06 — Section 7.5 screen 5)
  "popup.loading": "Loading word…",
  "popup.notFound": "Word not found.",
  "popup.error": "Could not load this word.",
  "popup.saveError": "Couldn't save. Try again.",
  "popup.close": "Close",
  "popup.audioFallback": "Your browser doesn't support audio playback.",
  "popup.meanings": "Meanings",
  "popup.noGlosses": "No glosses yet for this base language.",
  "popup.exampleHeading": "From the story",
  "popup.saveButton": "Save to my words",
  "popup.savedButton": "Saved ✓",
  "popup.saving": "Saving…",

  // My words page (Patch 06 — Section 7.9 screen 9)
  "words.title": "My words",
  "words.shortcut": "My words in this course",
  "words.search": "Search",
  "words.searchPlaceholder": "Search lemma or meaning…",
  "words.count": {
    one: "1 word saved",
    other: "{count} words saved"
  },
  "words.empty": "You haven't saved any words yet. Tap a word in a story to add it here.",
  "words.remove": "Remove",

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