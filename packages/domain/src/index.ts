export const VERTICALS = [
  { id: "CONSUMER", label: "Consumer", accent: "#1B6B8A", promise: "Stories become worlds." },
  { id: "KIDS", label: "Kids", accent: "#D9872A", promise: "Bedtime stories that breathe." },
  { id: "EDU", label: "Edu", accent: "#1A6B3C", promise: "See the idea. Understand it." },
  { id: "FAITH", label: "Faith", accent: "#6B2D8B", promise: "Sacred texts, respectfully illuminated." },
  { id: "DOCS", label: "Docs", accent: "#56738A", promise: "Knowledge with a camera." },
  { id: "VERSE", label: "Verse", accent: "#9D4C73", promise: "Poetry in motion." },
  { id: "COMICS", label: "Comics", accent: "#C94B32", promise: "Original art, newly alive." },
  { id: "BUSINESS", label: "Business", accent: "#B58B27", promise: "Ideas your team remembers." },
  { id: "WELLNESS", label: "Wellness", accent: "#3F8172", promise: "Gentle journeys inward." },
  { id: "LAW", label: "Law", accent: "#7A6650", promise: "Civic understanding, made visible." },
  { id: "TRAVEL", label: "Travel", accent: "#14818E", promise: "Go before you arrive." },
  { id: "ORIGINALS", label: "Originals", accent: "#C49A1C", promise: "Made for the medium." }
] as const;

export const CONSUMER_WORLDS = [
  "Otherworlds",
  "Human Stories",
  "True Stories",
  "Deep Dives",
  "Thrills",
  "Spirit & Soul",
  "Young Minds",
  "The World"
] as const;

export const CURRICULUM_FRAMEWORKS = [
  "KENYA_CBC",
  "COMMON_CORE",
  "NGSS",
  "CAMBRIDGE_IGCSE",
  "IB",
  "NCERT_INDIA",
  "CAPS_SOUTH_AFRICA"
] as const;

export type CurriculumFramework = (typeof CURRICULUM_FRAMEWORKS)[number];

export const EDU_QUESTION_TYPES = [
  "multiple_choice",
  "short_answer",
  "sequencing",
  "diagram_labelling",
  "equation_completion",
  "vocabulary_match",
  "translate_and_type"
] as const;

export type EduQuestionType = (typeof EDU_QUESTION_TYPES)[number];

export interface EduCheckpoint {
  id: string;
  pageId: string;
  question: string;
  options: string[];
  correctIndex: number | null;
  correctText: string | null;
  explanation: string;
  questionType: EduQuestionType;
  curriculumTags: string[];
  difficultyScore: number;
  misconceptionTargets: string[];
}

export interface DifficultyScore {
  reading_level: number;
  conceptual_density: number;
  prior_knowledge: number;
  visual_complexity: number;
}

export interface CurriculumMapping {
  framework: CurriculumFramework;
  standardCode: string;
  standardTitle: string;
  pageNums: number[];
}

export interface TeacherDashboardSummary {
  bookId: string;
  bookSlug: string;
  bookTitle: string;
  totalPages: number;
  classSize: number;
  activeStudents: number;
  averageProgress: number;
  averageAccuracy: number;
  flaggedPages: { pageNum: number; accuracy: number; attempts: number }[];
  recentResponses: {
    studentId: string;
    studentName: string;
    pageNum: number;
    questionType: EduQuestionType;
    isCorrect: boolean;
    timeTakenSeconds: number;
    at: string;
  }[];
}

export type VerticalId = (typeof VERTICALS)[number]["id"];
export type ReadingMode = "WATCH" | "BOTH" | "READ";
export type PageStatus = "PENDING" | "APPROVED" | "FLAGGED" | "REGENERATING";

export interface AnimPage {
  id: string;
  pageNum: number;
  chapter: string | null;
  textExcerpt: string;
  videoUrl: string | null;
  posterUrl: string | null;
  audioUrl: string | null;
  vttUrl: string | null;
  sceneType: string | null;
  emotionalRegister: string | null;
  cameraAngle: string | null;
  qualityScore: number | null;
  status: PageStatus;
}

export interface AnimBookSummary {
  id: string;
  slug: string;
  title: string;
  author: string;
  synopsis: string;
  vertical: VerticalId;
  genreTags: string[];
  moodTags: string[];
  ageRating: string | null;
  language: string;
  coverUrl: string | null;
  totalPages: number;
  styleId: string | null;
}

export interface AnimBook extends AnimBookSummary {
  pages: AnimPage[];
}

export function verticalAccent(vertical: VerticalId): string {
  // `[...VERTICALS]` materialises a mutable copy because TypeScript with
  // `noUncheckedIndexedAccess: true` infers the const-array-literal as a
  // readonly tuple whose `.find()` type can fail to resolve in stricter
  // toolchain combinations.
  return [...VERTICALS].find((entry) => entry.id === vertical)?.accent ?? "#1B6B8A";
}

export function curriculumFrameworkLabel(framework: CurriculumFramework): string {
  switch (framework) {
    case "KENYA_CBC":
      return "Kenya CBC";
    case "COMMON_CORE":
      return "Common Core";
    case "NGSS":
      return "Next Generation Science Standards";
    case "CAMBRIDGE_IGCSE":
      return "Cambridge IGCSE";
    case "IB":
      return "International Baccalaureate";
    case "NCERT_INDIA":
      return "NCERT India";
    case "CAPS_SOUTH_AFRICA":
      return "CAPS South Africa";
    default:
      return framework;
  }
}
