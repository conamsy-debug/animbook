/**
 * Next-gen features surfaced on the homepage as the "More than a book"
 * constellation strip (S2). ORACLE gets its own marquee section; the
 * other 13 features live here as static metadata.
 *
 * The glyph for each feature is rendered by `ConstellationTile` via the
 * `glyphId` lookup in `apps/web/src/components/nextgen/glyphs.tsx`.
 * Keeping the metadata pure-data here lets the tile component own the
 * SVG details without coupling this list to JSX.
 *
 * All routes are existing public pages. No new endpoints.
 */

export interface NextgenFeature {
  /** Stable id used for keys + glyph lookup. */
  id:
    | "memory"
    | "lens"
    | "echo"
    | "live-translation"
    | "live"
    | "dream"
    | "worlds"
    | "stage"
    | "signal"
    | "network"
    | "archive"
    | "school"
    | "studio-pro";
  /** Display name (sentence case). */
  name: string;
  /** One-line description (sentence case, 8-14 words). */
  tagline: string;
  /** Existing public route. Always starts with `/`. */
  route: string;
  /** Matches a case in `glyphs.tsx` so the tile renders the right icon. */
  glyphId: NextgenFeature["id"];
}

export const NEXTGEN_FEATURES: readonly NextgenFeature[] = [
  {
    id: "memory",
    name: "Memory",
    tagline: "The book learns your pace, your pauses, your sweet spots.",
    route: "/memory",
    glyphId: "memory"
  },
  {
    id: "lens",
    name: "Lens",
    tagline: "First-person reading — just for you, tuned to your habits.",
    route: "/memory",
    glyphId: "lens"
  },
  {
    id: "echo",
    name: "Echo",
    tagline: "A quiet vibration on every page turn, like a heartbeat.",
    route: "/memory",
    glyphId: "echo"
  },
  {
    id: "live-translation",
    name: "Live Translation",
    tagline: "Tap any word. See its tongue, in your language.",
    route: "/library",
    glyphId: "live-translation"
  },
  {
    id: "live",
    name: "Live",
    tagline: "Read together in real time, room by room, page by page.",
    route: "/live",
    glyphId: "live"
  },
  {
    id: "dream",
    name: "Dream",
    tagline: "A slower AnimBook for tired eyes — softer palette, gentler pacing.",
    route: "/dream",
    glyphId: "dream"
  },
  {
    id: "worlds",
    name: "Worlds",
    tagline: "Character universes that span books, sequels and prologues.",
    route: "/worlds",
    glyphId: "worlds"
  },
  {
    id: "stage",
    name: "Stage",
    tagline: "Pass the page — one reader at a time, one round at a time.",
    route: "/worlds",
    glyphId: "stage"
  },
  {
    id: "signal",
    name: "Signal",
    tagline: "See where readers linger, skip, or get stuck.",
    route: "/signal",
    glyphId: "signal"
  },
  {
    id: "network",
    name: "Network",
    tagline: "AnimBook as an API, with keys — build on top of it.",
    route: "/network",
    glyphId: "network"
  },
  {
    id: "archive",
    name: "Archive",
    tagline: "Oral history with consent, attribution and cultural notes.",
    route: "/archive",
    glyphId: "archive"
  },
  {
    id: "school",
    name: "School",
    tagline: "Classrooms, assignments, grade books and dashboards for teachers.",
    route: "/school",
    glyphId: "school"
  },
  {
    id: "studio-pro",
    name: "Studio Pro",
    tagline: "Point a phone at a marker. Open the book. Hold the world.",
    route: "/companion",
    glyphId: "studio-pro"
  }
] as const;

/** Lookup helper. Throws for unknown ids — only used at render time. */
export function findFeature(id: NextgenFeature["id"]): NextgenFeature {
  const f = NEXTGEN_FEATURES.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown nextgen feature id: ${id}`);
  return f;
}
