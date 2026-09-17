/**
 * Book Brain Engine.
 *
 * Reads a manuscript holistically and returns a structured Book Brain JSON
 * the rest of the pipeline uses. When the Anthropic key is present we call
 * Claude claude-sonnet-4-5. Otherwise we fall back to a deterministic
 * local analyser so the Studio pipeline never blocks.
 */
import { appEnv, isFeatureEnabled } from "../config/env.js";

export interface BookBrainPageManifest {
  page_num: number;
  text_excerpt: string;
  setting: string;
  characters_present: string[];
  primary_action: string;
  emotion: string;
  camera_angle: string;
  animation_prompt_draft: string;
}

export interface BookBrainCharacter {
  name: string;
  description: string;
  first_page: number;
  role: string;
  visual_keywords: string[];
}

export interface BookBrainSetting {
  name: string;
  description: string;
  time_period: string;
  atmosphere: string;
  visual_keywords: string[];
}

export interface BookBrain {
  title: string;
  author?: string;
  genre: string[];
  cultural_origin: string;
  target_audience: string;
  narrative_arc: {
    setup_pages: number[];
    climax_pages: number[];
    resolution_pages: number[];
  };
  emotional_register: { chapter: string; emotion: string; intensity_1_to_10: number }[];
  characters: BookBrainCharacter[];
  settings: BookBrainSetting[];
  visual_motifs: string[];
  pacing_profile: { page: number; score_1_to_10: number }[];
  style_recommendation: string;
  page_manifest: BookBrainPageManifest[];
}

interface ManuscriptLike {
  title?: string;
  author?: string;
  pages: { pageNum: number; chapter?: string | null; text: string }[];
}

const SYSTEM_PROMPT = `You are the AnimBook Book Brain engine. You read a complete manuscript and return a single JSON object matching the schema given to you. The output drives the AnimBook production pipeline. Always:
- Cover EVERY page in the page_manifest, preserving original text verbatim.
- Group pages by chapter in emotional_register.
- Recommend a single visual_style aligned with the genre and audience.
- Return valid JSON only. No prose.`;

function buildUserPrompt(input: { title?: string; author?: string; vertical?: string; manuscript: ManuscriptLike }): string {
  const manifest = input.manuscript.pages.map((page) => ({
    page_num: page.pageNum,
    chapter: page.chapter ?? null,
    text: page.text
  }));
  return JSON.stringify({
    task: "Produce a Book Brain JSON for this manuscript.",
    constraints: [
      "text_excerpt must be verbatim from the manuscript.",
      "characters_present must reference characters defined in this same response.",
      "style_recommendation must be one of: Desert Realism, Painterly Mysticism, Graphic Novel, Anime-Inspired, Watercolour, Cinematic Dark, Scientific Microscopy, Sacred Realism."
    ],
    book: {
      title: input.title,
      author: input.author,
      vertical: input.vertical
    },
    manuscript: manifest
  });
}

function extractJson(text: string): BookBrain | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as BookBrain;
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence && fence[1]) {
      try {
        return JSON.parse(fence[1]) as BookBrain;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function callAnthropic(prompt: string, systemPrompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": String(appEnv.ANTHROPIC_API_KEY),
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: appEnv.ANTHROPIC_BOOK_BRAIN_MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!response.ok) {
    throw new Error(`Anthropic returned ${response.status}`);
  }
  const json = (await response.json()) as { content?: { text?: string }[] };
  const text = json.content?.[0]?.text ?? "";
  return text;
}

/**
 * Deterministic fallback when the Anthropic key is missing.
 *
 * It is intentionally lightweight — it produces a plausible Book Brain so the
 * downstream stages (style selection, prompt generation, video generation)
 * always have something to work with. Operators can edit it by hand on the
 * Studio Book Brain Review screen.
 */
export function buildFallbackBrain(input: ManuscriptLike, opts: { vertical?: string }): BookBrain {
  const characters: BookBrainCharacter[] = [];
  const seen = new Set<string>();
  input.pages.forEach((page) => {
    const matches = page.text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
    for (const raw of matches) {
      if (seen.size >= 6) break;
      if (["The", "And", "But", "She", "He", "They", "Then", "With", "From"].includes(raw)) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      characters.push({
        name: raw,
        description: `Detected character "${raw}" from manuscript text.`,
        first_page: page.pageNum,
        role: "supporting",
        visual_keywords: ["human silhouette", "soft cinematic light", "editorial portrait"]
      });
    }
  });

  const settings: BookBrainSetting[] = [
    {
      name: "Primary Setting",
      description: "Inferred from manuscript cadence.",
      time_period: "Contemporary",
      atmosphere: "Warm and contemplative",
      visual_keywords: ["golden hour", "wide shot", "natural texture"]
    }
  ];

  const page_manifest: BookBrainPageManifest[] = input.pages.map((page) => ({
    page_num: page.pageNum,
    text_excerpt: page.text,
    setting: settings[0]!.name,
    characters_present: characters.slice(0, 2).map((c) => c.name),
    primary_action: "narrative beat",
    emotion: "reflective",
    camera_angle: "eye-level medium shot",
    animation_prompt_draft: `Cinematic slow camera movement over a still atmospheric scene evoking the chapter text. ${page.text.slice(0, 80)}`
  }));

  return {
    title: input.title ?? "Untitled AnimBook",
    author: input.author,
    genre: ["literary"],
    cultural_origin: "global",
    target_audience: "adult",
    narrative_arc: {
      setup_pages: input.pages.slice(0, Math.max(1, Math.floor(input.pages.length / 3))).map((p) => p.pageNum),
      climax_pages: input.pages
        .slice(Math.floor(input.pages.length / 3), Math.floor((2 * input.pages.length) / 3))
        .map((p) => p.pageNum),
      resolution_pages: input.pages.slice(Math.floor((2 * input.pages.length) / 3)).map((p) => p.pageNum)
    },
    emotional_register: [
      { chapter: "Chapter 1", emotion: "establishing", intensity_1_to_10: 4 }
    ],
    characters,
    settings,
    visual_motifs: ["light", "silhouette", "textured landscape"],
    pacing_profile: input.pages.map((p) => ({ page: p.pageNum, score_1_to_10: 5 })),
    style_recommendation: "Painterly Mysticism",
    page_manifest
  };
}

const CHUNK_THRESHOLD = 40;
const CHUNK_PAGES = 25;

const OVERVIEW_SYSTEM = `You are the AnimBook Book Brain engine. You are given the opening of a manuscript plus samples from later in it. Return ONE JSON object describing the book as a whole — no page_manifest.
Keys: title, author, genre[], cultural_origin, target_audience, narrative_arc{setup_pages[],climax_pages[],resolution_pages[]}, emotional_register[{chapter,emotion,intensity_1_to_10}], characters[{name,description,first_page,role,visual_keywords[]}], settings[{name,description,time_period,atmosphere,visual_keywords[]}], visual_motifs[], pacing_profile[], style_recommendation.
Character descriptions fix how each person looks in every illustration: age, build, skin tone, hair, one signature outfit — no other body parts, and never pair "young" with "male" or "female".
style_recommendation must be one of: desert-realism, painterly-mysticism, graphic-novel, anime-inspired, watercolour, cinematic-dark, scientific-microscopy, sacred-realism.
Return valid JSON only. No prose.`;

const MANIFEST_SYSTEM = `You are the AnimBook Book Brain engine. You are given a book overview and a slice of its pages. Return ONE JSON object: {"page_manifest": [...]} covering EXACTLY the page numbers given, in order.
Each entry: {page_num, text_excerpt (verbatim first sentence or two), setting, characters_present[] (names from the overview), primary_action, emotion, camera_angle, animation_prompt_draft}.
animation_prompt_draft describes one frame to illustrate that page: who is in it (by look, not name), where, the light and the framing. Never mention text, titles, letters or logos.
Return valid JSON only. No prose.`;

function sampleForOverview(pages: ManuscriptLike["pages"]): ManuscriptLike["pages"] {
  if (pages.length <= 18) return pages;
  const opening = pages.slice(0, 10);
  const rest = pages.slice(10);
  const step = Math.max(1, Math.floor(rest.length / 8));
  const samples = rest.filter((_, i) => i % step === 0).slice(0, 8);
  return [...opening, ...samples];
}

/** Long manuscripts are read in sections: one overview pass, then page batches. */
async function chunkedBrain(input: { title?: string; author?: string; vertical?: string; manuscript: ManuscriptLike }): Promise<BookBrain> {
  const pages = input.manuscript.pages;
  const overviewText = await callAnthropic(
    JSON.stringify({
      book: { title: input.title, author: input.author, vertical: input.vertical, total_pages: pages.length },
      opening_and_samples: sampleForOverview(pages).map((p) => ({ page_num: p.pageNum, chapter: p.chapter ?? null, text: p.text }))
    }),
    OVERVIEW_SYSTEM
  );
  const overview = extractJson(overviewText);
  if (!overview) throw new Error("Overview pass returned no JSON");

  const manifest: BookBrainPageManifest[] = [];
  for (let i = 0; i < pages.length; i += CHUNK_PAGES) {
    const slice = pages.slice(i, i + CHUNK_PAGES);
    const text = await callAnthropic(
      JSON.stringify({
        overview: {
          title: overview.title,
          cultural_origin: overview.cultural_origin,
          style_recommendation: overview.style_recommendation,
          characters: overview.characters,
          settings: overview.settings
        },
        pages: slice.map((p) => ({ page_num: p.pageNum, chapter: p.chapter ?? null, text: p.text }))
      }),
      MANIFEST_SYSTEM
    );
    const parsed = extractJson(text) as unknown as { page_manifest?: BookBrainPageManifest[] } | null;
    if (parsed?.page_manifest?.length) {
      manifest.push(...parsed.page_manifest);
    } else {
      // Keep going: a missing batch falls back to the page's own text.
      manifest.push(
        ...slice.map((p) => ({
          page_num: p.pageNum,
          text_excerpt: p.text.slice(0, 200),
          setting: overview.settings?.[0]?.name ?? "",
          characters_present: [],
          primary_action: "a quiet moment",
          emotion: "calm",
          camera_angle: "medium shot",
          animation_prompt_draft: p.text.slice(0, 220)
        }))
      );
    }
  }
  manifest.sort((a, b) => a.page_num - b.page_num);
  return { ...overview, page_manifest: manifest };
}

export async function generateBookBrain(input: { title?: string; author?: string; vertical?: string; manuscript: ManuscriptLike }): Promise<{
  brain: BookBrain;
  source: "anthropic" | "fallback";
}> {
  if (isFeatureEnabled("BOOK_BRAIN")) {
    try {
      if (input.manuscript.pages.length > CHUNK_THRESHOLD) {
        return { brain: await chunkedBrain(input), source: "anthropic" };
      }
      const text = await callAnthropic(buildUserPrompt(input), SYSTEM_PROMPT);
      const parsed = extractJson(text);
      if (parsed) return { brain: parsed, source: "anthropic" };
    } catch (err) {
      console.warn("[book-brain] Anthropic call failed, falling back:", (err as Error).message);
    }
  }
  return { brain: buildFallbackBrain(input.manuscript, { vertical: input.vertical }), source: "fallback" };
}
