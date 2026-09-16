/**
 * Curriculum Mapping AI.
 *
 * Tags each AnimPage to standard codes for the requested framework (or all
 * seven by default). When the Anthropic key is present we ask Claude to
 * produce the mapping; otherwise we fall back to deterministic tagging using
 * the page's sceneType and key terms.
 *
 * The output is consumed by the Teacher Dashboard's curriculum heatmap.
 */
import { appEnv, isFeatureEnabled } from "../config/env.js";
import { CURRICULUM_FRAMEWORKS, type CurriculumFramework, type CurriculumMapping } from "../domain/index.js";

export interface MappingInput {
  framework: CurriculumFramework;
  bookTitle: string;
  pages: { pageNum: number; text: string; chapter: string | null; sceneType: string | null }[];
}

export async function mapCurriculum(input: MappingInput): Promise<CurriculumMapping[]> {
  if (isFeatureEnabled("BOOK_BRAIN")) {
    try {
      const live = await callAnthropicForMapping(input);
      if (live.length > 0) return live;
    } catch (err) {
      console.warn("[edu/curriculum] Anthropic call failed, falling back:", (err as Error).message);
    }
  }
  return buildFallbackMapping(input);
}

async function callAnthropicForMapping(input: MappingInput): Promise<CurriculumMapping[]> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": String(appEnv.ANTHROPIC_API_KEY),
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: appEnv.ANTHROPIC_BOOK_BRAIN_MODEL,
      max_tokens: 2048,
      system: `You map AnimPages to ${input.framework} standard codes. Return only valid JSON matching the schema given.`,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            task: "Map each page to a standard code. Allow one code per page.",
            framework: input.framework,
            book: input.bookTitle,
            schema: {
              mapping: "[{ standardCode, standardTitle, pageNums: number[] }]"
            },
            pages: input.pages.map((p) => ({ pageNum: p.pageNum, chapter: p.chapter, sceneType: p.sceneType, text: p.text.slice(0, 240) }))
          })
        }
      ]
    })
  });
  if (!response.ok) throw new Error(`Anthropic returned ${response.status}`);
  const json = (await response.json()) as { content?: { text?: string }[] };
  const text = json.content?.[0]?.text ?? "{}";
  try {
    const parsed = JSON.parse(text) as { mapping: Omit<CurriculumMapping, "framework">[] };
    return parsed.mapping.map((m) => ({ ...m, framework: input.framework }));
  } catch {
    return [];
  }
}

function buildFallbackMapping(input: MappingInput): CurriculumMapping[] {
  const tagByChapter = new Map<string, { standardCode: string; standardTitle: string; pageNums: number[] }>();
  for (const page of input.pages) {
    const chapter = page.chapter ?? "Chapter 1";
    const code = `${input.framework}.${inferSubject(page)}.${chapter.replace(/\s+/g, "_").toUpperCase()}`;
    const title = `${inferSubject(page)} · ${chapter}`;
    const existing = tagByChapter.get(code);
    if (existing) {
      existing.pageNums.push(page.pageNum);
    } else {
      tagByChapter.set(code, { standardCode: code, standardTitle: title, pageNums: [page.pageNum] });
    }
  }
  return [...tagByChapter.values()].map((entry) => ({ framework: input.framework, ...entry }));
}

function inferSubject(page: { text: string; sceneType: string | null }): string {
  const lower = (page.text + " " + (page.sceneType ?? "")).toLowerCase();
  if (/mitosis|cell|replicat|chromosom|dna/.test(lower)) return "Biology";
  if (/equat|formula|solve|calcul/.test(lower)) return "Mathematics";
  if (/translat|swahili|french|spanish|chinese|arabic/.test(lower)) return "Languages";
  if (/history|civilisation|empire/.test(lower)) return "History";
  if (/geography|continent|river|climate/.test(lower)) return "Geography";
  return "Reading";
}

export async function mapAllFrameworks(bookTitle: string, pages: { pageNum: number; text: string; chapter: string | null; sceneType: string | null }[]): Promise<CurriculumMapping[]> {
  const results: CurriculumMapping[] = [];
  for (const framework of CURRICULUM_FRAMEWORKS) {
    const mapping = await mapCurriculum({ framework, bookTitle, pages });
    results.push(...mapping);
  }
  return results;
}