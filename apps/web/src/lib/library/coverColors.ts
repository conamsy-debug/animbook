// Cover color picker for the library's generated cover fallback.
//
// The brief gives 8 explicit palettes (Wellness, Docs, City Poems, City
// Journeys, plus 4 extras). The library should reuse the app's existing
// vertical-to-color mapping when possible — verticals.ts already has
// `accent` per vertical. We use that as the override, falling back to
// the brief's palette table when the vertical isn't recognized.

const PALETTES: Array<{ background: string; foreground: string }> = [
  { background: "#12363A", foreground: "#A9D9CB" },
  { background: "#1B2B4A", foreground: "#B7C8EA" },
  { background: "#4A1C36", foreground: "#F0B7CF" },
  { background: "#0F3B40", foreground: "#BFE3E3" },
  { background: "#4A3712", foreground: "#F0D08A" },
  { background: "#16341F", foreground: "#B6DDB8" },
  { background: "#2A2350", foreground: "#CFC7F2" },
  { background: "#4A2016", foreground: "#F2BBA6" }
];

/** djb2 hash — small, deterministic, fine for a non-cryptographic
 *  palette assignment. Same vertical always gets the same palette. */
function hashString(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export interface CoverPalette {
  /** CSS color for the cover background. */
  background: string;
  /** CSS color for the foreground text (label + title). */
  foreground: string;
}

/** Pick a deterministic palette for a vertical name.
 *  Pass `fallbackAccent` (e.g. verticals.ts `accent` for known verticals)
 *  to bias the background — if provided and it isn't one of the brief's
 *  preset colors, we still return it as the background for visual
 *  consistency with the rest of the app. */
export function coverColorFor(verticalId: string, fallbackAccent?: string): CoverPalette {
  // Special-case the most visually-distinct verticals so the library
  // matches the brief's mockup as closely as possible.
  switch (verticalId) {
    case "WELLNESS": return PALETTES[0]!;
    case "DOCS":     return PALETTES[1]!;
    case "VERSE":    return PALETTES[2]!; // "City Poems" sits in VERSE
    case "TRAVEL":   return PALETTES[3]!; // "City Journeys" sits in TRAVEL
    default:         break;
  }
  // Stable hash → index. Always picks a palette within the brief's table.
  const idx = hashString(verticalId || "animbook") % PALETTES.length;
  const palette = PALETTES[idx]!;
  // If the vertical has its own accent (consumer, kids, edu, …) and it
  // isn't already in the table, prefer it as the background so the
  // generated cover matches the app's own color language.
  if (fallbackAccent && !PALETTES.some((p) => p.background.toLowerCase() === fallbackAccent.toLowerCase())) {
    return { background: fallbackAccent, foreground: pickReadableFg(fallbackAccent) };
  }
  return palette;
}

/** Pick a foreground color that should be readable on the given bg.
 *  Light backgrounds get dark text, dark backgrounds get the warm cream
 *  used elsewhere in the design. */
function pickReadableFg(bg: string): string {
  const hex = bg.replace("#", "");
  if (hex.length !== 6) return "#F2EEE6";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0A0F18" : "#F2EEE6";
}
