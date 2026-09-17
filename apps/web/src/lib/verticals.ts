/** The twelve AnimBook verticals and the shelves inside them. */
export interface Subcategory {
  id: string;
  label: string;
}

export interface Vertical {
  id: string;
  label: string;
  promise: string;
  blurb: string;
  accent: string;
  /** Shelves readers filter by and authors choose from in the Studio. */
  subcategories: Subcategory[];
}

export const VERTICALS: Vertical[] = [
  {
    id: "CONSUMER",
    label: "Consumer",
    promise: "Stories become worlds.",
    blurb: "Novels, classics and the nights you can't put down.",
    accent: "#1B6B8A",
    subcategories: [
      { id: "literary-fiction", label: "Literary Fiction" },
      { id: "romance", label: "Romance" },
      { id: "crime-mystery", label: "Crime & Mystery" },
      { id: "science-fiction", label: "Science Fiction" },
      { id: "fantasy", label: "Fantasy" },
      { id: "historical", label: "Historical" },
      { id: "thriller", label: "Thriller" },
      { id: "short-stories", label: "Short Stories" }
    ]
  },
  {
    id: "KIDS",
    label: "Kids",
    promise: "Bedtime stories that breathe.",
    blurb: "Gentle, safe picture books with a bedtime mode.",
    accent: "#D9872A",
    subcategories: [
      { id: "picture-books", label: "Picture Books (3–6)" },
      { id: "early-readers", label: "Early Readers (6–8)" },
      { id: "middle-grade", label: "Middle Grade (9–12)" },
      { id: "bedtime", label: "Bedtime & Sleep" },
      { id: "folktales", label: "Folktales & Fables" },
      { id: "first-learning", label: "First Learning" }
    ]
  },
  {
    id: "EDU",
    label: "Edu",
    promise: "See the idea. Understand it.",
    blurb: "Curriculum-mapped lessons with quick checkpoints.",
    accent: "#1A6B3C",
    subcategories: [
      { id: "science", label: "Science" },
      { id: "mathematics", label: "Mathematics" },
      { id: "history", label: "History" },
      { id: "languages", label: "Languages" },
      { id: "geography", label: "Geography & Earth" },
      { id: "civics", label: "Civics & Society" },
      { id: "exam-revision", label: "Exam Revision" }
    ]
  },
  {
    id: "FAITH",
    label: "Faith",
    promise: "Sacred texts, respectfully illuminated.",
    blurb: "Reviewed by theological advisors, paced with care.",
    accent: "#6B2D8B",
    subcategories: [
      { id: "christian", label: "Christian" },
      { id: "islamic", label: "Islamic" },
      { id: "judaic-kabbalistic", label: "Judaic & Kabbalistic" },
      { id: "buddhist", label: "Buddhist" },
      { id: "hindu", label: "Hindu" },
      { id: "african-spirituality", label: "African Spirituality" },
      { id: "esoteric", label: "Esoteric & Mystical" },
      { id: "interfaith", label: "Interfaith & Philosophy" }
    ]
  },
  {
    id: "DOCS",
    label: "Docs",
    promise: "Knowledge with a camera.",
    blurb: "How-tos and field guides you can watch step by step.",
    accent: "#56738A",
    subcategories: [
      { id: "how-to-repair", label: "How-To & Repair" },
      { id: "cooking", label: "Cooking" },
      { id: "health-first-aid", label: "Health & First Aid" },
      { id: "gardening", label: "Gardening" },
      { id: "home-craft", label: "Home & Craft" },
      { id: "fitness-movement", label: "Fitness & Movement" },
      { id: "technology", label: "Technology" },
      { id: "money-skills", label: "Money Skills" }
    ]
  },
  {
    id: "VERSE",
    label: "Verse",
    promise: "Poetry in motion.",
    blurb: "Poems that move, with tap-to-translate words.",
    accent: "#9D4C73",
    subcategories: [
      { id: "spoken-word", label: "Spoken Word" },
      { id: "classic-poetry", label: "Classic Poetry" },
      { id: "contemporary-poetry", label: "Contemporary Poetry" },
      { id: "devotional-verse", label: "Devotional Verse" },
      { id: "city-poems", label: "City Poems" }
    ]
  },
  {
    id: "COMICS",
    label: "Comics",
    promise: "Original art, newly alive.",
    blurb: "Panel-by-panel stories brought to life.",
    accent: "#C94B32",
    subcategories: [
      { id: "superhero", label: "Superhero" },
      { id: "slice-of-life", label: "Slice of Life" },
      { id: "afrofuturism", label: "Afrofuturism" },
      { id: "manga-style", label: "Manga-Style" },
      { id: "all-ages", label: "All Ages" },
      { id: "graphic-memoir", label: "Graphic Memoir" }
    ]
  },
  {
    id: "BUSINESS",
    label: "Business",
    promise: "Ideas your team remembers.",
    blurb: "Learning for teams, ready for your training platform.",
    accent: "#B58B27",
    subcategories: [
      { id: "leadership", label: "Leadership" },
      { id: "onboarding", label: "Onboarding & Training" },
      { id: "sales-marketing", label: "Sales & Marketing" },
      { id: "finance", label: "Finance" },
      { id: "entrepreneurship", label: "Entrepreneurship" },
      { id: "compliance", label: "Compliance & Safety" }
    ]
  },
  {
    id: "WELLNESS",
    label: "Wellness",
    promise: "Gentle journeys inward.",
    blurb: "Sleep stories and calm, slow-paced reads.",
    accent: "#3F8172",
    subcategories: [
      { id: "sleep-stories", label: "Sleep Stories" },
      { id: "meditation", label: "Meditation & Breath" },
      { id: "movement", label: "Movement & Stretch" },
      { id: "mental-wellbeing", label: "Mental Wellbeing" },
      { id: "nutrition", label: "Nutrition" },
      { id: "grief-healing", label: "Grief & Healing" }
    ]
  },
  {
    id: "LAW",
    label: "Law",
    promise: "Civic understanding, made visible.",
    blurb: "Rights and civic ideas explained clearly.",
    accent: "#7A6650",
    subcategories: [
      { id: "rights-citizenship", label: "Rights & Citizenship" },
      { id: "family-law", label: "Family Law" },
      { id: "business-contracts", label: "Business & Contracts" },
      { id: "land-property", label: "Land & Property" },
      { id: "criminal-justice", label: "Criminal Justice" },
      { id: "human-rights", label: "Human Rights" }
    ]
  },
  {
    id: "TRAVEL",
    label: "Travel",
    promise: "Go before you arrive.",
    blurb: "Slow journeys through streets, markets and coasts.",
    accent: "#14818E",
    subcategories: [
      { id: "city-journeys", label: "City Journeys" },
      { id: "nature-wildlife", label: "Nature & Wildlife" },
      { id: "food-markets", label: "Food & Markets" },
      { id: "pilgrimage", label: "Pilgrimage Routes" },
      { id: "coast-islands", label: "Coast & Islands" },
      { id: "heritage", label: "Culture & Heritage" }
    ]
  },
  {
    id: "ORIGINALS",
    label: "Originals",
    promise: "Made for the medium.",
    blurb: "New work that could only exist as an AnimBook.",
    accent: "#C49A1C",
    subcategories: [
      { id: "interactive", label: "Interactive Stories" },
      { id: "shared-worlds", label: "Shared Worlds" },
      { id: "documentary", label: "Documentary Originals" },
      { id: "experimental", label: "Experimental" }
    ]
  }
];

export function verticalById(id: string | undefined | null): Vertical | undefined {
  return VERTICALS.find((v) => v.id === id);
}

export function verticalAccent(id: string): string {
  return verticalById(id)?.accent ?? "#1B6B8A";
}

export function subcategoriesFor(verticalId: string | undefined | null): Subcategory[] {
  return verticalById(verticalId)?.subcategories ?? [];
}

export function subcategoryLabel(verticalId: string | undefined | null, subId: string | undefined | null): string | null {
  if (!subId) return null;
  return subcategoriesFor(verticalId).find((s) => s.id === subId)?.label ?? null;
}
