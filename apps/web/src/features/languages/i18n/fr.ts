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
