/** The twelve AnimBook verticals — shared by the home page and the Library. */
export interface Vertical {
  id: string;
  label: string;
  promise: string;
  blurb: string;
  accent: string;
}

export const VERTICALS: Vertical[] = [
  { id: "CONSUMER", label: "Consumer", promise: "Stories become worlds.", blurb: "Novels, classics and the nights you can't put down.", accent: "#1B6B8A" },
  { id: "KIDS", label: "Kids", promise: "Bedtime stories that breathe.", blurb: "Gentle, safe picture books with a bedtime mode.", accent: "#D9872A" },
  { id: "EDU", label: "Edu", promise: "See the idea. Understand it.", blurb: "Curriculum-mapped lessons with quick checkpoints.", accent: "#1A6B3C" },
  { id: "FAITH", label: "Faith", promise: "Sacred texts, respectfully illuminated.", blurb: "Reviewed by theological advisors, paced with care.", accent: "#6B2D8B" },
  { id: "DOCS", label: "Docs", promise: "Knowledge with a camera.", blurb: "How-tos and field guides you can watch step by step.", accent: "#56738A" },
  { id: "VERSE", label: "Verse", promise: "Poetry in motion.", blurb: "Poems that move, with tap-to-translate words.", accent: "#9D4C73" },
  { id: "COMICS", label: "Comics", promise: "Original art, newly alive.", blurb: "Panel-by-panel stories brought to life.", accent: "#C94B32" },
  { id: "BUSINESS", label: "Business", promise: "Ideas your team remembers.", blurb: "Learning for teams, ready for your training platform.", accent: "#B58B27" },
  { id: "WELLNESS", label: "Wellness", promise: "Gentle journeys inward.", blurb: "Sleep stories and calm, slow-paced reads.", accent: "#3F8172" },
  { id: "LAW", label: "Law", promise: "Civic understanding, made visible.", blurb: "Rights and civic ideas explained clearly.", accent: "#7A6650" },
  { id: "TRAVEL", label: "Travel", promise: "Go before you arrive.", blurb: "Slow journeys through streets, markets and coasts.", accent: "#14818E" },
  { id: "ORIGINALS", label: "Originals", promise: "Made for the medium.", blurb: "New work that could only exist as an AnimBook.", accent: "#C49A1C" }
];

export function verticalById(id: string | undefined | null): Vertical | undefined {
  return VERTICALS.find((v) => v.id === id);
}

export function verticalAccent(id: string): string {
  return verticalById(id)?.accent ?? "#1B6B8A";
}
