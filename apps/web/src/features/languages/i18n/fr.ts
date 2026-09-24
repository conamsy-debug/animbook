/**
 * French UI strings for the AnimBook Languages module.
 *
 * Mirror of i18n/en.ts. The base/instruction language for a learner
 * decides which dictionary their UI reads from — see spec § 7. Patch
 * 01 ships only the strings the landing page needs; later patches
 * extend this as new screens come online.
 */
export const fr = {
  // Landing (Section 7.1)
  "landing.eyebrow": "AnimBook · Langues",
  "landing.title": "Apprends une langue à travers des histoires animées.",
  "landing.subtitle":
    "Choisis une langue que tu connais et une langue que tu veux apprendre. AnimBook t'enseigne avec de courtes histoires animées — appuie sur un mot pour voir sa traduction, ajoute-le à ton deck, puis reviens le réviser.",
  "landing.cta.start": "Commencer",
  "landing.cta.continue": "Reprendre où je me suis arrêté",
  "languagesHeading": "Sept langues au choix",
  "languagesHint":
    "La phase 1 livre ces langues cibles. L'interface de l'application suit ta langue de base.",

  // NotAvailable (shown when the LANGUAGES_ENABLED flag is off)
  "notAvailable.title": "AnimBook Langues n'est pas encore disponible",
  "notAvailable.body":
    "Nous sommes encore en train de construire cette section. Reviens bientôt — en attendant, tu peux explorer le reste d'AnimBook.",

  // Onboarding (Section 7.2)
  "onboarding.title": "Bienvenue dans AnimBook Langues",
  "onboarding.subtitle":
    "Dis-nous quelle langue tu parles déjà et laquelle tu veux apprendre.",
  "onboarding.baseLabel": "Je parle",
  "onboarding.targetLabel": "Je veux apprendre",
  "onboarding.dailyGoalLabel": "Objectif quotidien (optionnel)",
  "onboarding.dailyGoalHint": "On t'enverra un rappel doux si tu prends du retard.",
  "onboarding.dailyGoal.none": "Pas d'objectif",
  "onboarding.dailyGoal.relaxed": "5 min · tranquille",
  "onboarding.dailyGoal.regular": "10 min · régulier",
  "onboarding.dailyGoal.serious": "20 min · sérieux",
  "onboarding.submit": "Commencer ma première histoire",
  "onboarding.error.sameLang": "Choisis une langue cible différente de celle que tu parles.",
  "onboarding.error.generic": "Une erreur s'est produite. Réessaie dans un instant.",

  // My enrollments (Section 7 onboarding follow-up)
  "me.title": "Mes langues",
  "me.empty": "Tu n'as pas encore commencé de langue.",
  "me.browseAll": "Voir les langues",
  "me.lastActive": "Dernière activité {when}",
  "me.startNew": "Commencer une autre langue",

  // Course home (Section 7.3)
  "course.title": "{title}",
  "course.storiesHeading": "Histoires",
  "course.statsHeading": "Tes progrès",
  "course.streak": {
    one: "1 jour d'affilée",
    other: "{count} jours d'affilée"
  },
  "course.xp": {
    one: "1 XP",
    other: "{count} XP"
  },
  "course.lastActivity": "Dernière activité {when}",
  "course.notEnrolled": "Tu regardes un extrait de ce cours. Commence-le pour suivre tes progrès.",
  "course.enroll": "Commencer ce cours",
  "course.continueStory": "Continuer",
  "course.startStory": "Commencer",
  "course.reviewStory": "Revoir",
  "course.status.notStarted": "Pas commencé",
  "course.status.inProgress": "En cours",
  "course.status.completed": "Terminé",
  "course.dailyGoal": "Objectif quotidien : {minutes} min",

  // Story player
  "player.savedProgress": "Progression enregistrée",
  "player.completeStory": "Marquer l'histoire comme terminée",
  "player.completeTitle": "Histoire terminée",
  "player.completeBody": "Bravo — chaque mot que tu as touché est maintenant dans ton deck.",
  "player.completeWords": {
    one: "1 nouveau mot appris",
    other: "{count} nouveaux mots appris"
  },

  // Exercise views (Patch 07 — Section 7.6)
  "exercise.questionFallback": "Choisis la meilleure réponse.",
  "exercise.listenPrompt": "Écoute la phrase, puis choisis ce que tu as entendu.",
  "exercise.check": "Vérifier",
  "exercise.submitting": "Vérification…",
  "exercise.submitScore": "Envoyer le score",
  "exercise.error": "Une erreur s'est produite. Réessaie.",
  "exercise.correct": "Correct !",
  "exercise.wrong": "Pas tout à fait — la bonne réponse est surlignée.",
  "exercise.xpAwarded": {
    one: "+1 XP",
    other: "+{count} XP"
  },
  "exercise.continue": "Continuer",
  "exercise.skip": "Passer",
  "exercise.unsupported": "Ce type d'exercice n'est pas encore supporté : {type}",
  "exercise.builderPrompt": "Appuie sur les mots dans le bon ordre.",
  "exercise.builderEmpty": "Appuie sur un mot pour commencer ta phrase.",
  "exercise.reset": "Réinitialiser",
  "exercise.speakPrompt": "Prononce la phrase à voix haute.",

  // Pronunciation (Patch 08)
  "pronunciation.record": "Enregistrer",
  "pronunciation.stop": "Arrêter",
  "pronunciation.submit": "Envoyer l'enregistrement",
  "pronunciation.submitting": "Évaluation…",
  "pronunciation.tryAgain": "Réessayer",
  "pronunciation.submitError": "Impossible d'évaluer ton enregistrement. Réessaie.",
  "pronunciation.missingLineId": "Cet exercice n'est pas configuré — merci de le signaler.",
  "pronunciation.unsupported": "Ton navigateur ne supporte pas l'enregistrement audio.",
  "pronunciation.passed": "Bravo — c'était très bien.",
  "pronunciation.tryAgainHint": "Presque — écoute l'audio natif et réessaie.",
  "pronunciation.practiceScore": "Score d'entraînement : {count}",
  "pronunciation.transcriptHeard": "On a entendu :",
  "pronunciation.ariaCorrect": "correct",
  "pronunciation.ariaMissed": "manqué",
  "pronunciation.ariaDifferent": "différent",
  "pronunciation.colouringAria": "Détail mot par mot de la prononciation",

  // Review session (Patch 09 — Section 7.5 screen 5 + Section 10)
  "review.title": "Révise tes mots",
  "review.subtitle":
    "Touche la carte pour la retourner, puis note à quel point tu t'en souviens. Sois honnête — l'algorithme apprend de tes notes.",
  "review.cardFrontAria": "Recto de la carte. Touche pour retourner.",
  "review.cardBackAria": "Verso de la carte. Sens et phrase d'exemple.",
  "review.flip": "Touche la carte pour la retourner",
  "review.nextIn": "Prochain rappel dans {when}",
  "review.again": "Encore",
  "review.hard": "Difficile",
  "review.good": "Bon",
  "review.easy": "Facile",
  "review.againHint": "Vu il y a moins d'une seconde.",
  "review.hardHint": "Retrouvé avec beaucoup de difficulté.",
  "review.goodHint": "Retrouvé avec un peu d'effort.",
  "review.easyHint": "Retrouvé sans effort.",
  "review.complete": "Terminé pour aujourd'hui",
  "review.completeBody":
    "Bien joué — ces mots reviendront au moment parfait pour ta mémoire.",
  "review.countdown": "{count} restant(s)",
  "review.empty": "Rien à réviser pour l'instant.",
  "review.emptyBody": "Enregistre un mot depuis une histoire pour commencer à réviser.",
  "review.errorLoad": "Impossible de charger ta file de révision. Réessaie.",
  "review.errorRate": "Impossible d'enregistrer cette note. Réessaie.",
  "review.back": "Retour au cours",
  "review.glossesLabel": "Sens",
  "review.exampleLabel": "Exemple",

  // Word popup (Patch 06 — Section 7.5 screen 5)
  "popup.loading": "Chargement du mot…",
  "popup.notFound": "Mot introuvable.",
  "popup.error": "Impossible de charger ce mot.",
  "popup.saveError": "Sauvegarde impossible. Réessaie.",
  "popup.close": "Fermer",
  "popup.audioFallback": "Ton navigateur ne supporte pas la lecture audio.",
  "popup.meanings": "Sens",
  "popup.noGlosses": "Aucune traduction disponible pour cette langue de base.",
  "popup.exampleHeading": "Tiré de l'histoire",
  "popup.saveButton": "Enregistrer dans mes mots",
  "popup.savedButton": "Enregistré ✓",
  "popup.saving": "Sauvegarde…",

  // My words page (Patch 06 — Section 7.9 screen 9)
  "words.title": "Mes mots",
  "words.shortcut": "Mes mots dans ce cours",
  "words.search": "Rechercher",
  "words.searchPlaceholder": "Rechercher un lemme ou un sens…",
  "words.count": {
    one: "1 mot enregistré",
    other: "{count} mots enregistrés"
  },
  "words.empty": "Tu n'as encore enregistré aucun mot. Appuie sur un mot dans une histoire pour l'ajouter ici.",
  "words.remove": "Retirer",

  // Misc shared bits
  "nav.label": "Langues",
  "common.comingSoon": "Bientôt disponible",

  // Interpolation + plural examples (mirror of en.ts; French splits on
  // count === 1 same as English, so the same one/other pair works).
  "greeting.named": "Bon retour, {name}.",
  "story.wordsSeen": {
    one: "1 mot vu dans cette histoire",
    other: "{count} mots vus dans cette histoire"
  },
  "story.minutesLeft": {
    one: "1 minute restante",
    other: "{count} minutes restantes"
  },
  "deck.saved": {
    one: "1 mot enregistré dans ton deck",
    other: "{count} mots enregistrés dans ton deck"
  }
} as const;

export type FrKey = keyof typeof fr;