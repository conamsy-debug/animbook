/**
 * Shelves inside each vertical. Mirrors apps/web/src/lib/verticals.ts —
 * keep the two in step.
 */
export const SUBCATEGORIES: Record<string, { id: string; label: string }[]> = {
  CONSUMER: [
    { id: "literary-fiction", label: "Literary Fiction" },
    { id: "romance", label: "Romance" },
    { id: "crime-mystery", label: "Crime & Mystery" },
    { id: "science-fiction", label: "Science Fiction" },
    { id: "fantasy", label: "Fantasy" },
    { id: "historical", label: "Historical" },
    { id: "thriller", label: "Thriller" },
    { id: "short-stories", label: "Short Stories" }
  ],
  KIDS: [
    { id: "picture-books", label: "Picture Books (3–6)" },
    { id: "early-readers", label: "Early Readers (6–8)" },
    { id: "middle-grade", label: "Middle Grade (9–12)" },
    { id: "bedtime", label: "Bedtime & Sleep" },
    { id: "folktales", label: "Folktales & Fables" },
    { id: "first-learning", label: "First Learning" }
  ],
  EDU: [
    { id: "science", label: "Science" },
    { id: "mathematics", label: "Mathematics" },
    { id: "history", label: "History" },
    { id: "languages", label: "Languages" },
    { id: "geography", label: "Geography & Earth" },
    { id: "civics", label: "Civics & Society" },
    { id: "exam-revision", label: "Exam Revision" }
  ],
  FAITH: [
    { id: "christian", label: "Christian" },
    { id: "islamic", label: "Islamic" },
    { id: "judaic-kabbalistic", label: "Judaic & Kabbalistic" },
    { id: "buddhist", label: "Buddhist" },
    { id: "hindu", label: "Hindu" },
    { id: "african-spirituality", label: "African Spirituality" },
    { id: "esoteric", label: "Esoteric & Mystical" },
    { id: "interfaith", label: "Interfaith & Philosophy" }
  ],
  DOCS: [
    { id: "how-to-repair", label: "How-To & Repair" },
    { id: "cooking", label: "Cooking" },
    { id: "health-first-aid", label: "Health & First Aid" },
    { id: "gardening", label: "Gardening" },
    { id: "home-craft", label: "Home & Craft" },
    { id: "technology", label: "Technology" },
    { id: "money-skills", label: "Money Skills" }
  ],
  VERSE: [
    { id: "spoken-word", label: "Spoken Word" },
    { id: "classic-poetry", label: "Classic Poetry" },
    { id: "contemporary-poetry", label: "Contemporary Poetry" },
    { id: "devotional-verse", label: "Devotional Verse" },
    { id: "city-poems", label: "City Poems" }
  ],
  COMICS: [
    { id: "superhero", label: "Superhero" },
    { id: "slice-of-life", label: "Slice of Life" },
    { id: "afrofuturism", label: "Afrofuturism" },
    { id: "manga-style", label: "Manga-Style" },
    { id: "all-ages", label: "All Ages" },
    { id: "graphic-memoir", label: "Graphic Memoir" }
  ],
  BUSINESS: [
    { id: "leadership", label: "Leadership" },
    { id: "onboarding", label: "Onboarding & Training" },
    { id: "sales-marketing", label: "Sales & Marketing" },
    { id: "finance", label: "Finance" },
    { id: "entrepreneurship", label: "Entrepreneurship" },
    { id: "compliance", label: "Compliance & Safety" }
  ],
  WELLNESS: [
    { id: "sleep-stories", label: "Sleep Stories" },
    { id: "meditation", label: "Meditation & Breath" },
    { id: "movement", label: "Movement & Stretch" },
    { id: "mental-wellbeing", label: "Mental Wellbeing" },
    { id: "nutrition", label: "Nutrition" },
    { id: "grief-healing", label: "Grief & Healing" }
  ],
  LAW: [
    { id: "rights-citizenship", label: "Rights & Citizenship" },
    { id: "family-law", label: "Family Law" },
    { id: "business-contracts", label: "Business & Contracts" },
    { id: "land-property", label: "Land & Property" },
    { id: "criminal-justice", label: "Criminal Justice" },
    { id: "human-rights", label: "Human Rights" }
  ],
  TRAVEL: [
    { id: "city-journeys", label: "City Journeys" },
    { id: "nature-wildlife", label: "Nature & Wildlife" },
    { id: "food-markets", label: "Food & Markets" },
    { id: "pilgrimage", label: "Pilgrimage Routes" },
    { id: "coast-islands", label: "Coast & Islands" },
    { id: "heritage", label: "Culture & Heritage" }
  ],
  ORIGINALS: [
    { id: "interactive", label: "Interactive Stories" },
    { id: "shared-worlds", label: "Shared Worlds" },
    { id: "documentary", label: "Documentary Originals" },
    { id: "experimental", label: "Experimental" }
  ]
};

export function isValidSubcategory(vertical: string, id: string | null | undefined): boolean {
  if (!id) return true;
  return (SUBCATEGORIES[vertical] ?? []).some((s) => s.id === id);
}

export function subcategoryLabel(vertical: string, id: string | null | undefined): string | null {
  if (!id) return null;
  return (SUBCATEGORIES[vertical] ?? []).find((s) => s.id === id)?.label ?? null;
}
