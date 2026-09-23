/**
 * AnimBook Languages — speech-to-text provider abstraction (Patch 08).
 *
 * Spec § 9 + § 13. The scoring flow is:
 *   1. The browser posts a recorded audio clip (raw bytes, no multipart)
 *      to /api/lang/pronunciation alongside the line_id.
 *   2. The route asks an `SttProvider` for a transcript of the audio,
 *      passing the line's expected text as the prompt hint.
 *   3. The transcript + the expected text are normalised (lowercase,
 *      strip punctuation, NFC, niqqud-strip for Hebrew) and tokenised.
 *   4. Levenshtein-aligned token comparison yields a 0..100 score
 *      and a per-word colouring payload.
 *
 * The provider is pluggable so a future Patch can swap in
 * `faster_whisper` or another backend without touching the route.
 *
 * The OpenAI Whisper implementation uses the `whisper-1` model and
 * the `language` parameter to bias the recogniser toward the
 * target language (per spec § 3 `languages.stt_code`). The
 * `prompt` parameter carries the expected text — Whisper uses it
 * as a vocabulary hint, which measurably improves accuracy on
 * short A1 utterances.
 */
export interface SttProvider {
  /** Stable name for telemetry + feature flags. */
  readonly name: string;
  /** True when the provider has its required credentials. */
  isConfigured(): boolean;
  /**
   * Transcribe a short audio clip. Returns the raw transcript
   * (no normalisation — the route handles that so the provider
   * stays language-agnostic).
   */
  transcribe(input: {
    audio: Buffer;
    /** BCP-47 / ISO-639 hint (e.g. "es", "zh", "he"). */
    language: string;
    /** Optional prompt hint to bias the vocabulary. Whisper-only. */
    prompt?: string;
  }): Promise<string>;
}

/* --------------------------------------------------------------------- *
 * Normalisation + scoring helpers (pure functions, exposed for tests)
 * --------------------------------------------------------------------- */

/** Unicode NFC normalisation + lowercase + strip combining marks
 *  (so Hebrew vowel points disappear) + collapse whitespace +
 *  strip common ASCII punctuation. The result is what we compare
 *  tokens against. */
export function normaliseForCompare(raw: string): string {
  return raw
    .normalize("NFC")
    .toLowerCase()
    // Strip combining marks. Hebrew niqqud = U+0591..U+05BD +
    // shin/sin dots U+05C1..U+05C2 + U+05C4..U+05C5 + U+05C7 (qamats
    // qatan). Arabic harakat = U+064B..U+065F + U+0670. We keep
    // Hebrew/Arabic base letters + Chinese hanzi intact.
    .replace(/[\u0591-\u05BD\u05C1\u05C2\u05C4\u05C5\u05C7\u064B-\u065F\u0670]/g, "")
    // Strip ASCII punctuation + Spanish opening marks (¿¡), quotes
    // (smart + straight), brackets, dashes, ellipsis.
    .replace(/[.,!?;:'"`()\[\]{}<>\/\\\-—–…¡¿·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokenise the normalised string. Whitespace-split; punctuation
 *  already stripped by `normaliseForCompare`. */
export function tokenise(normalised: string): string[] {
  if (normalised.length === 0) return [];
  return normalised.split(" ").filter((t) => t.length > 0);
}

/** Per-word classification for the colouring payload. The route
 *  ships these to the UI which renders each token green / yellow / red. */
export type WordStatus = "correct" | "missed" | "different";

export interface AlignedWord {
  /** Best-effort mapping of the EXPECTED word. null when the
   *  recogniser inserted a word that doesn't appear in the line. */
  expected: string | null;
  /** What the recogniser heard at this position. */
  transcript: string | null;
  status: WordStatus;
}

/**
 * Align `expected` and `transcript` via Levenshtein on the token
 * arrays and emit a per-word classification:
 *   - correct:   exact match
 *   - missed:    expected word with no transcript match (the learner
 *                didn't say this word)
 *   - different: transcript word that doesn't match the expected one
 *                at this position (substitution / insertion)
 *
 * The algorithm is a classic Levenshtein DP on tokens with back-
 * pointers; we use the alignment to emit the merged per-word list
 * (skipping deletions as "missed", substitutions as "different").
 */
export function alignTokens(expected: string[], transcript: string[]): AlignedWord[] {
  const n = expected.length;
  const m = transcript.length;

  // Edge case: empty sides.
  if (n === 0 && m === 0) return [];
  if (n === 0) return transcript.map((t) => ({ expected: null, transcript: t, status: "different" }));
  if (m === 0) return expected.map((e) => ({ expected: e, transcript: null, status: "missed" }));

  // dp[i][j] = edit distance between expected[0..i) and transcript[0..j).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (expected[i - 1] === transcript[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  // Backtrack.
  const out: AlignedWord[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && expected[i - 1] === transcript[j - 1]) {
      out.push({ expected: expected[i - 1]!, transcript: transcript[j - 1]!, status: "correct" });
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      out.push({ expected: expected[i - 1]!, transcript: transcript[j - 1]!, status: "different" });
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      out.push({ expected: expected[i - 1]!, transcript: null, status: "missed" });
      i--;
    } else {
      // j > 0: insertion in transcript.
      out.push({ expected: null, transcript: transcript[j - 1]!, status: "different" });
      j--;
    }
  }
  return out.reverse();
}

/** Map a Levenshtein distance to a 0..100 score using a normalised
 *  ratio: `100 * (1 - distance / max(expected, transcript))`. Empty
 *  input gets 0. A perfect match gets 100. */
export function scoreFromAlignment(expected: string[], transcript: string[]): number {
  if (expected.length === 0 && transcript.length === 0) return 0;
  const aligned = alignTokens(expected, transcript);
  // Each "different" row counts as 1 error; each "missed" row counts
  // as 1 error too. Correct rows are 0.
  const errors = aligned.filter((w) => w.status !== "correct").length;
  const max = Math.max(expected.length, transcript.length, 1);
  const ratio = 1 - errors / max;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

/* --------------------------------------------------------------------- *
 * OpenAI Whisper provider
 * --------------------------------------------------------------------- */

interface WhisperProviderOptions {
  apiKey: string;
  /** Default model — "whisper-1" per OpenAI's transcription endpoint. */
  model?: string;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
}

export class WhisperOpenAIProvider implements SttProvider {
  readonly name = "whisper_openai";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: WhisperProviderOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? "whisper-1";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async transcribe(input: { audio: Buffer; language: string; prompt?: string }): Promise<string> {
    // OpenAI's `/audio/transcriptions` endpoint expects multipart form
    // data. We build the form manually with FormData + Blob — supported
    // natively in Node 18+.
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(input.audio)], { type: "audio/webm" }),
      "recording.webm"
    );
    form.append("model", this.model);
    form.append("language", input.language);
    if (input.prompt && input.prompt.length > 0) {
      form.append("prompt", input.prompt);
    }
    form.append("response_format", "json");

    const res = await this.fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      },
      body: form
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `WhisperOpenAIProvider: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`
      );
    }
    const data = (await res.json()) as { text?: string };
    return typeof data.text === "string" ? data.text : "";
  }
}

/* --------------------------------------------------------------------- *
 * Provider selection
 * --------------------------------------------------------------------- *
 * The route resolves an `SttProvider` at request time so a missing
 * OPENAI_API_KEY returns a clean 503 instead of crashing the route.
 * The pronunciation route itself only mounts when the feature
 * flag is on, so the calling code never has to import the provider
 * directly.
 *
 * Selection rule (Patch 08): use Whisper when OPENAI is configured.
 * `faster_whisper` self-hosted lands later if needed. */

export function resolveSttProvider(input: {
  openaiApiKey?: string;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
}): SttProvider {
  if (input.openaiApiKey) {
    return new WhisperOpenAIProvider({
      apiKey: input.openaiApiKey,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {})
    });
  }
  // No provider configured. The route handles this with a 503.
  return {
    name: "noop",
    isConfigured: () => false,
    transcribe: async () => {
      throw new Error("No SttProvider configured (set OPENAI_API_KEY).");
    }
  };
}