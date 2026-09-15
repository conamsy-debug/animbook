/**
 * AnimBook mobile design tokens.
 *
 * Mirrored from apps/web/src/styles/globals.css so the mobile shell stays
 * visually consistent with the desktop web app.
 */
export const palette = {
  bg: "#080c14",
  surface: "#0d1b2e",
  card: "#111d19",
  text: "#f5edd8",
  textMuted: "#8a9e96",
  border: "#1e2e28",
  gold: "#c49a1c",
  consumer: "#1b6b8a",
  kids: "#d9872a",
  edu: "#1a6b3c",
  faith: "#6b2d8b",
  verse: "#9d4c73",
  wellness: "#3f8172",
  travel: "#14818e",
  docs: "#56738a",
  law: "#7a6650",
  comics: "#c94b32",
  business: "#b58b27",
  originals: "#c49a1c",
  success: "#1a8a4a",
  warning: "#d46a0a",
  error: "#aa2020"
} as const;

export const fonts = {
  serif: '"Cormorant Garamond", "Times New Roman", serif',
  mono: '"DM Mono", ui-monospace, monospace',
  sans: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 18,
  xl: 28,
  xxl: 40
} as const;

export function verticalAccent(vertical: string): string {
  switch (vertical) {
    case "CONSUMER":
      return palette.consumer;
    case "KIDS":
      return palette.kids;
    case "EDU":
      return palette.edu;
    case "FAITH":
      return palette.faith;
    case "VERSE":
      return palette.verse;
    case "WELLNESS":
      return palette.wellness;
    case "TRAVEL":
      return palette.travel;
    case "DOCS":
      return palette.docs;
    case "LAW":
      return palette.law;
    case "COMICS":
      return palette.comics;
    case "BUSINESS":
      return palette.business;
    case "ORIGINALS":
      return palette.originals;
    default:
      return palette.consumer;
  }
}