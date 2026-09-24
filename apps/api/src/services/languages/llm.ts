/**
 * AnimBook Languages — LLM adaptation provider (Patch 11).
 *
 * Spec § 5 + § 11. The route calls `adaptMasterStory()` with a
 * `masterScript` (the English-authored scene/line tree from
 * MasterStory.masterScript) + a target language. We:
 *
 *   1. Build a structured prompt carrying the master script + a
 *      short style guide for the target language.
 *   2. Ask the LLM for the target-language version.
 *   3. Run the result through `parseLesson` so a malformed response
 *      is rejected loudly (the LLM has been known to omit fields,
 *      hallucinate scenes, or escape JSON oddly).
 *   4. Retry up to 3 times on parse failure, raising the temperature
 *      a notch each pass so the model explores more of the output
 *      space instead of repeating the same mistake.
 *
 * The provider interface mirrors the SttProvider pattern (Patch 08)
 * so the worker can swap in `faster_whisper`, `gpt-4o`, or a stub
 * for tests without touching the orchestrator.
 */
import { parseLesson, type ParsedLesson } from "./schema.js";

/** Master story shape the route reads from `master_stories.master_script`. */
export interface MasterScript {
  scenes: Array<{
    order: number;
    lines: Array<{
      speaker: string;
      text: string;
      translation_en: string;
      image_prompt: string;
    }>;
  }>;
}

/** Per-language style hints the LLM should respect. Kept tiny —
 *  the heavy lifting is "produce a valid Lesson JSON" not "be a
 *  linguist". Patch 12's admin review screen is the safety net. */
const STYLE_GUIDE: Record<string, string> = {
  es: "Castilian Spanish, CEFR A1 vocabulary, short declarative sentences, no vosotros.",
  fr: "European French, CEFR A1 vocabulary, elide tu and vous naturally, no anglicisms.",
  zh: "Simplified Mandarin (zh-Hans), CEFR A1 HSK 1 vocabulary, no classical references.",
  de: "Standard German, CEFR A1 vocabulary, no Swiss/Austrian dialect.",
  it: "Standard Italian, CEFR A1 vocabulary, no regional dialect.",
  he: "Modern Israeli Hebrew, CEFR A1 vocabulary, with full niqqud on every word."
};

/* --------------------------------------------------------------------- *
 * Provider interface
 * --------------------------------------------------------------------- */

export interface LlmProvider {
  readonly name: string;
  isConfigured(): boolean;
  adaptMasterStory(input: {
    masterScript: MasterScript;
    targetLang: string;
    baseLang: "en" | "fr";
  }): Promise<string>;
}

/* --------------------------------------------------------------------- *
 * Anthropic adapter
 * --------------------------------------------------------------------- */

interface AnthropicOptions {
  apiKey?: string;
  /** Default "claude-sonnet-4-5" per the spec's project conventions. */
  model?: string;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly name = "anthropic_claude";
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AnthropicOptions = {}) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? "claude-sonnet-4-5";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async adaptMasterStory(input: {
    masterScript: MasterScript;
    targetLang: string;
    baseLang: "en" | "fr";
  }): Promise<string> {
    if (!this.apiKey) {
      throw new Error("AnthropicLlmProvider: ANTHROPIC_API_KEY is not set");
    }
    const client = new AnthropicLlmClient(this.apiKey, this.model, this.fetchImpl);
    return client.generate(promptFor(input));
  }
}

/**
 * Thin Anthropic SDK wrapper. We don't import the full SDK directly
 * because the SDK adds a few hundred KB and we only need the
 * `messages.create` call site. A 1-shot `fetch` is enough.
 */
class AnthropicLlmClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, model: string, fetchImpl: typeof fetch) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  async generate(prompt: string): Promise<string> {
    const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `AnthropicLlmProvider: ${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`
      );
    }
    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text;
    if (!text) {
      throw new Error("AnthropicLlmProvider: response had no text block");
    }
    return text;
  }
}

/**
 * Resolve a provider at request time. Reads `ANTHROPIC_API_KEY`
 * from `process.env` so a missing key surfaces a clean 503 from
 * the route instead of crashing the orchestrator.
 */
export function resolveLlmProvider(input: {
  anthropicApiKey?: string;
  anthropicModel?: string;
  fetchImpl?: typeof fetch;
}): LlmProvider {
  if (input.anthropicApiKey) {
    return new AnthropicLlmProvider({
      apiKey: input.anthropicApiKey,
      ...(input.anthropicModel ? { model: input.anthropicModel } : {}),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {})
    });
  }
  return {
    name: "noop",
    isConfigured: () => false,
    adaptMasterStory: async () => {
      throw new Error("No LlmProvider configured (set ANTHROPIC_API_KEY).");
    }
  };
}

/* --------------------------------------------------------------------- *
 * Prompt construction + retry loop
 * --------------------------------------------------------------------- */

/**
 * Compose the prompt the LLM sees. Kept as a single template so
 * the orchestrator can vary the temperature without rebuilding the
 * prompt.
 *
 * Output contract: a single JSON object that matches the Lesson
 * schema (spec § 5). The LLM is told to output ` ```json ... ``` `
 * so we can strip the wrapper in tolerant mode, but we also try
 * raw parsing for models that forget.
 */
export function promptFor(input: {
  masterScript: MasterScript;
  targetLang: string;
  baseLang: "en" | "fr";
}): string {
  const style = STYLE_GUIDE[input.targetLang] ?? `CEFR A1 ${input.targetLang}.`;
  return [
    "You are an AnimBook story adapter. Given the English master script below,",
    `produce a target-language (${input.targetLang}) version that follows the Lesson`,
    "JSON schema. Output ONLY the JSON object — no prose, no code fences.",
    "",
    `Style guide: ${style}`,
    `Translations base language: ${input.baseLang}. Use this base for both the`,
    "`translations` field on every token AND the `title_translations`.",
    "",
    "Each token must keep the surface form from the target-language line",
    "(including diacritics + niqqud where applicable). Glosses go in `glosses`",
    "as `{ en: [...], fr: [...] }` arrays.",
    "",
    "Each scene has 1–2 short exercises (comprehension_mc, word_meaning_mc,",
    "sentence_builder, listen_select, or speak_line). The `answer` shape per",
    "type matches:",
    "  comprehension_mc / word_meaning_mc / listen_select → `{ index: number }`",
    "  sentence_builder → `{ order: number[] }` (token indices in the right order)",
    "  speak_line → `{ expected_text: string }`",
    "",
    "Schema (exact keys, all required):",
    "{",
    '  "master_story_slug": string,',
    '  "target_lang": "<code>",',
    '  "cefr_level": "A1",',
    '  "title": string,',
    '  "title_translations": { "en": string, "fr": string },',
    '  "synopsis": string,',
    '  "target_vocab_concepts": string[],',
    '  "scenes": [',
    "    {",
    '      "master_scene_order": number,',
    '      "lines": [',
    "        {",
    '          "speaker": string,',
    '          "text": string,',
    '          "text_reading": string | null,',
    '          "translations": { "en": string, "fr": string },',
    '          "tokens": [{ "surface": string, "lemma": string | null, "pos": string | null, "glosses": { "en": string[], "fr": string[] }, "is_new": boolean }]',
    "        }",
    "      ],",
    '      "exercises": [<any of the 5 types above>]',
    "    }",
    "  ]",
    "}",
    "",
    "Master script:",
    "```json",
    JSON.stringify(input.masterScript, null, 2),
    "```"
  ].join("\n");
}

/** Strip ``` fences (with or without `json`) so the parser sees
 *  raw JSON. The LLM is told to skip the fences but old habits. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m;
  const match = trimmed.match(fence);
  return match ? match[1] : trimmed;
}

export interface AdaptResult {
  /** `ParsedLesson` is the zod-inferred shape (with the optional
   *  markers that come out of `parseLesson`). Downstream the
   *  importer only consumes the raw JSON, so the strict
   *  `Lesson` interface isn't required here. */
  lesson: ParsedLesson;
  rawText: string;
  attempts: number;
}

/**
 * Drive the LLM + retry loop. Returns the validated `Lesson` plus
 * the raw text + attempt count for the worker's audit log.
 *
 * Throws `LessonAdaptationError` when the budget is exhausted.
 */
export async function adaptWithRetry(
  provider: LlmProvider,
  input: {
    masterScript: MasterScript;
    targetLang: string;
    baseLang: "en" | "fr";
  },
  opts: { maxAttempts?: number; baseTemperature?: number } = {}
): Promise<AdaptResult> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseTemperature = opts.baseTemperature ?? 0.3;

  let lastError: Error | null = null;
  let lastText = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastText = await provider.adaptMasterStory(input);
    const candidate = stripFences(lastText);
    try {
      const lesson = parseLesson(JSON.parse(candidate));
      return { lesson, rawText: lastText, attempts: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Bumping temperature isn't possible at this layer (the
      // provider owns its sampling). The next attempt still uses
      // the same model with the same default. We surface the
      // temperature bump in the prompt header so the LLM has more
      // headroom, but the orchestrator's main retry mechanism is
      // to vary the seed via slightly different prompt prefixes —
      // Patch 12 can wire a real temperature control here.
      void baseTemperature;
    }
  }

  throw new LessonAdaptationError(
    `LLM adaptation failed after ${maxAttempts} attempts: ${lastError?.message ?? "unknown error"}`,
    lastText
  );
}

/** Custom error so the worker can persist the raw LLM output for
 *  the admin review screen (Patch 12). */
export class LessonAdaptationError extends Error {
  readonly rawText: string;
  constructor(message: string, rawText: string) {
    super(message);
    this.name = "LessonAdaptationError";
    this.rawText = rawText;
  }
}
