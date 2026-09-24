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
  "player.completeTitle": "Story complete",
  "player.completeBody": "Nice work — every word you tapped is now in your deck.",
  "player.completeWords": {
    one: "1 new word learned",
    other: "{count} new words learned"
  },

  // Exercise views (Patch 07 — Section 7.6)
  "exercise.questionFallback": "Pick the best answer.",
  "exercise.listenPrompt": "Listen to the line, then pick what you heard.",
  "exercise.check": "Check",
  "exercise.submitting": "Checking…",
  "exercise.submitScore": "Submit score",
  "exercise.error": "Something went wrong. Try again.",
  "exercise.correct": "Correct!",
  "exercise.wrong": "Not quite — the right answer is highlighted.",
  "exercise.xpAwarded": {
    one: "+1 XP",
    other: "+{count} XP"
  },
  "exercise.continue": "Continue",
  "exercise.skip": "Skip",
  "exercise.unsupported": "This exercise type isn't supported yet: {type}",
  "exercise.builderPrompt": "Tap the tokens in the right order.",
  "exercise.builderEmpty": "Tap a token to start building your sentence.",
  "exercise.reset": "Reset",
  "exercise.speakPrompt": "Say the line out loud.",

  // Pronunciation (Patch 08 — Section 7.5 screen 5 + Section 9)
  "pronunciation.record": "Record",
  "pronunciation.stop": "Stop",
  "pronunciation.submit": "Submit recording",
  "pronunciation.submitting": "Scoring…",
  "pronunciation.tryAgain": "Try again",
  "pronunciation.submitError": "Couldn't score your recording. Try again.",
  "pronunciation.missingLineId": "This exercise isn't wired up — please report it.",
  "pronunciation.unsupported": "Your browser doesn't support audio recording.",
  "pronunciation.passed": "Nice — that sounded great.",
  "pronunciation.tryAgainHint": "Close — listen to the native audio and try once more.",
  "pronunciation.practiceScore": "Practice score: {count}",
  "pronunciation.transcriptHeard": "We heard:",
  "pronunciation.ariaCorrect": "correct",
  "pronunciation.ariaMissed": "missed",
  "pronunciation.ariaDifferent": "different",
  "pronunciation.colouringAria": "Per-word pronunciation breakdown",

  // Review session (Patch 09 — Section 7.5 screen 5 + Section 10)
  "review.title": "Review your words",
  "review.subtitle":
    "Tap the card to flip it, then rate how well you remembered. Be honest — the algorithm learns from your ratings.",
  "review.cardFrontAria": "Word front. Tap to flip.",
  "review.cardBackAria": "Word back. Meaning and example sentence.",
  "review.flip": "Tap card to flip",
  "review.nextIn": "Next review in {when}",
  "review.again": "Again",
  "review.hard": "Hard",
  "review.good": "Good",
  "review.easy": "Easy",
  "review.againHint": "Saw it less than a second ago.",
  "review.hardHint": "Recalled with serious difficulty.",
  "review.goodHint": "Recalled with some effort.",
  "review.easyHint": "Recalled effortlessly.",
  "review.complete": "All done for today",
  "review.completeBody":
    "Nice work — these words will resurface at the perfect interval for your memory.",
  "review.countdown": "{count} left",
  "review.empty": "Nothing due right now.",
  "review.emptyBody": "Save a word from a story to start reviewing.",
  "review.errorLoad": "Couldn't load your review queue. Try again.",
  "review.errorRate": "Couldn't record that rating. Try again.",
  "review.back": "Back to course",
  "review.glossesLabel": "Meaning",
  "review.exampleLabel": "Example",

  // Stats card (Patch 10 — Section 7.3)
  "stats.heading": "Your progress",
  "stats.streak": "Current streak",
  "stats.longest": "Longest streak",
  "stats.xp": "Total XP",
  "stats.vocabCount": "Words saved",
  "stats.exerciseCount": "Exercises completed",
  "stats.timezone": "Timezone",
  "stats.lastActivity": "Last activity: {when}",
  "stats.alive": "Keep it going!",
  "stats.atRisk": "Don't break the chain — review today.",
  "stats.broken": "Streak broken. Start a new one today!",

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