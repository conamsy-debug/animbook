/**
 * Comprehension Checkpoint Generator.
 *
 * Picks 1-3 question types from the 7 supported kinds and produces a
 * plausible checkpoint per AnimPage. When the Anthropic key is present we
 * call claude-sonnet-4-5 with the page text and scene context; otherwise
 * we fall back to a deterministic local generator that uses page heuristics
 * to choose appropriate question types and write the items.
 *
 * The 7 supported question types:
 *   - multiple_choice
 *   - short_answer
 *   - sequencing
 *   - diagram_labelling
 *   - equation_completion
 *   - vocabulary_match
 *   - translate_and_type
 */
import { appEnv, isFeatureEnabled } from "../config/env.js";
import type { EduQuestionType, DifficultyScore } from "../domain/index.js";
import { calibrateDifficulty } from "./difficultyCalibration.js";
import { buildMisconceptionTargets } from "./misconceptionDatabase.js";

export interface CheckpointCandidate {
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

export interface GeneratorInput {
  pageNum: number;
  text: string;
  sceneType: string | null;
  emotionalRegister: string | null;
  cameraAngle: string | null;
  vertical: string;
  chapter?: string | null;
  framework?: string;
}

const QUESTION_TYPE_BY_SCENE: Record<string, EduQuestionType[]> = {
  mitosis: ["sequencing", "diagram_labelling", "multiple_choice"],
  equation: ["equation_completion", "multiple_choice"],
  vocabulary: ["vocabulary_match", "multiple_choice"],
  diagram: ["diagram_labelling", "sequencing"],
  translate: ["translate_and_type", "vocabulary_match"],
  language: ["translate_and_type", "vocabulary_match"],
  narrative: ["short_answer", "multiple_choice"],
  reflection: ["short_answer", "multiple_choice"],
  scene: ["multiple_choice", "short_answer"]
};

function pickSceneKey(sceneType: string | null, text: string): string {
  if (!sceneType) return "narrative";
  const lower = sceneType.toLowerCase();
  if (/mitosis|cell|replicat|chromosom|dna/i.test(lower + " " + text)) return "mitosis";
  if (/equat|formula|solve|calcul/i.test(text)) return "equation";
  if (/vocab|termin|definit|word/i.test(text)) return "vocabulary";
  if (/diagram|anatomy|labell|figure/i.test(lower + " " + text)) return "diagram";
  if (/translat|language|french|spanish|swahili|chinese|arabic/i.test(lower + " " + text)) return "language";
  return lower in QUESTION_TYPE_BY_SCENE ? lower : "narrative";
}

export async function generateCheckpoint(input: GeneratorInput): Promise<CheckpointCandidate> {
  const difficulty = calibrateDifficulty(input);
  const sceneKey = pickSceneKey(input.sceneType, input.text);
  const candidateTypes = QUESTION_TYPE_BY_SCENE[sceneKey] ?? QUESTION_TYPE_BY_SCENE.narrative!;
  const questionType = candidateTypes[0]!;

  if (isFeatureEnabled("BOOK_BRAIN")) {
    try {
      const live = await callAnthropicForCheckpoint(input, questionType, difficulty);
      return live;
    } catch (err) {
      console.warn("[edu/checkpoint] Anthropic call failed, falling back:", (err as Error).message);
    }
  }
  return buildFallbackCheckpoint(input, questionType, difficulty, sceneKey);
}

async function callAnthropicForCheckpoint(
  input: GeneratorInput,
  type: EduQuestionType,
  difficulty: DifficultyScore
): Promise<CheckpointCandidate> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": String(appEnv.ANTHROPIC_API_KEY),
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: appEnv.ANTHROPIC_BOOK_BRAIN_MODEL,
      max_tokens: 1024,
      system: "You are the AnimBook EDU checkpoint generator. You return exactly one checkpoint object matching the requested type. Be precise; the misconception distractors should reflect real student errors.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            task: `Generate a ${type} checkpoint for this AnimPage.`,
            framework: input.framework ?? "KENYA_CBC",
            difficulty,
            page: {
              pageNum: input.pageNum,
              chapter: input.chapter,
              text: input.text,
              sceneType: input.sceneType,
              cameraAngle: input.cameraAngle,
              emotionalRegister: input.emotionalRegister
            },
            schema: {
              question: "string",
              options: "string[]",
              correctIndex: "number | null",
              correctText: "string | null",
              explanation: "string",
              questionType: type,
              curriculumTags: "string[]",
              difficultyScore: "number 1..5",
              misconceptionTargets: "string[]"
            }
          })
        }
      ]
    })
  });
  if (!response.ok) throw new Error(`Anthropic returned ${response.status}`);
  const json = (await response.json()) as { content?: { text?: string }[] };
  const text = json.content?.[0]?.text ?? "{}";
  const parsed = JSON.parse(text) as CheckpointCandidate;
  return parsed;
}

function buildFallbackCheckpoint(
  input: GeneratorInput,
  type: EduQuestionType,
  difficulty: DifficultyScore,
  sceneKey: string
): CheckpointCandidate {
  const sentences = input.text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const firstSentence = sentences[0] ?? input.text;
  const lastSentence = sentences[sentences.length - 1] ?? input.text;
  const keyTerms = extractKeyTerms(input.text);

  let candidate: CheckpointCandidate;
  switch (type) {
    case "multiple_choice":
      candidate = buildMultipleChoice(input, firstSentence, keyTerms);
      break;
    case "short_answer":
      candidate = buildShortAnswer(input, firstSentence, lastSentence);
      break;
    case "sequencing":
      candidate = buildSequencing(input);
      break;
    case "diagram_labelling":
      candidate = buildDiagramLabelling(input, keyTerms);
      break;
    case "equation_completion":
      candidate = buildEquationCompletion(input);
      break;
    case "vocabulary_match":
      candidate = buildVocabularyMatch(input, keyTerms);
      break;
    case "translate_and_type":
      candidate = buildTranslateAndType(input, firstSentence);
      break;
    default:
      candidate = buildMultipleChoice(input, firstSentence, keyTerms);
  }
  candidate.curriculumTags = buildCurriculumTags(input, sceneKey);
  candidate.difficultyScore = Math.min(5, Math.max(1, Math.round(difficulty.conceptual_density * 2 + difficulty.reading_level)));
  candidate.misconceptionTargets = buildMisconceptionTargets(sceneKey, keyTerms);
  return candidate;
}

function extractKeyTerms(text: string): string[] {
  const words = text.split(/\s+/).filter((w) => /^[A-Za-z][a-z]{3,}$/.test(w));
  const counts = new Map<string, number>();
  for (const word of words) {
    const lower = word.toLowerCase();
    counts.set(lower, (counts.get(lower) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, count]) => count >= 1)
    .slice(0, 6)
    .map(([w]) => w);
}

function buildMultipleChoice(input: GeneratorInput, firstSentence: string, keyTerms: string[]): CheckpointCandidate {
  const correct = (keyTerms[0] ?? "the central idea").replace(/^./, (m) => m.toUpperCase());
  const distractors = [
    `A reflection on ${input.emotionalRegister ?? "tone"} unrelated to the page`,
    `The opposite of what the page describes`,
    `An unsupported inference about ${keyTerms[1] ?? "a peripheral detail"}`
  ];
  const options = shuffleWithCorrect(distractors, correct);
  return {
    question: `Based on page ${input.pageNum}, which statement best reflects the central idea?`,
    options,
    correctIndex: options.indexOf(correct),
    correctText: correct,
    explanation: `The page opens with: "${firstSentence.slice(0, 120)}${firstSentence.length > 120 ? "…" : ""}". The other options describe plausible but unsupported readings.`,
    questionType: "multiple_choice",
    curriculumTags: [],
    difficultyScore: 0,
    misconceptionTargets: []
  };
}

function buildShortAnswer(input: GeneratorInput, first: string, last: string): CheckpointCandidate {
  const prompt = input.chapter?.toLowerCase().includes("reflection")
    ? `In your own words, what does the reader carry away from page ${input.pageNum}?`
    : `Summarise the key claim on page ${input.pageNum} in one sentence.`;
  return {
    question: prompt,
    options: [],
    correctIndex: null,
    correctText: last,
    explanation: `A strong response echoes the page's last sentence and uses one of the page's key terms: "${first.split(/\s+/).slice(0, 8).join(" ")}…".`,
    questionType: "short_answer",
    curriculumTags: [],
    difficultyScore: 0,
    misconceptionTargets: []
  };
}

function buildSequencing(input: GeneratorInput): CheckpointCandidate {
  const beats = ["The setup establishes the scene.", "Tension builds as the action unfolds.", "The page reaches a turning point."];
  const correct = beats[Math.floor((input.pageNum - 1) / 2) % beats.length]!;
  return {
    question: `Where does page ${input.pageNum} sit in the ${input.chapter ?? "narrative"} arc?`,
    options: shuffleWithCorrect(["It introduces the conflict.", correct, "It resolves the conflict."], correct),
    correctIndex: ["It introduces the conflict.", correct, "It resolves the conflict."].indexOf(correct),
    correctText: correct,
    explanation: `Page ${input.pageNum} sits in the middle third of the chapter — the build-up, not the resolution.`,
    questionType: "sequencing",
    curriculumTags: [],
    difficultyScore: 0,
    misconceptionTargets: []
  };
}

function buildDiagramLabelling(input: GeneratorInput, keyTerms: string[]): CheckpointCandidate {
  const labels = keyTerms.length >= 4 ? keyTerms.slice(0, 4) : ["Cell membrane", "Nucleus", "Chromosome", "Centriole"];
  const correct = labels[0]!;
  const distractors = labels.slice(1, 4);
  const options = shuffleWithCorrect(distractors, correct);
  return {
    question: `Which label belongs at the centre of the ${input.sceneType ?? "diagram"} on page ${input.pageNum}?`,
    options,
    correctIndex: options.indexOf(correct),
    correctText: correct,
    explanation: `The centre of the ${input.sceneType ?? "scene"} corresponds to ${correct}, the structural anchor.`,
    questionType: "diagram_labelling",
    curriculumTags: [],
    difficultyScore: 0,
    misconceptionTargets: []
  };
}

function buildEquationCompletion(input: GeneratorInput): CheckpointCandidate {
  const m = input.text.match(/\b([a-zA-Z])\s*=\s*([^.,;]+)/);
  const symbol = m?.[1] ?? "n";
  const rhs = m?.[2]?.slice(0, 24) ?? "the population at time t";
  return {
    question: `Complete the equation that page ${input.pageNum} derives.`,
    options: [`${symbol} = ${rhs}`, `${symbol} = √(${rhs})`, `${symbol} = ln(${rhs})`, `${symbol} = d(${rhs})/dt`],
    correctIndex: 0,
    correctText: `${symbol} = ${rhs}`,
    explanation: `The page's derivation starts from the direct relationship; the other forms appear in later chapters.`,
    questionType: "equation_completion",
    curriculumTags: [],
    difficultyScore: 0,
    misconceptionTargets: []
  };
}

function buildVocabularyMatch(input: GeneratorInput, keyTerms: string[]): CheckpointCandidate {
  const term = keyTerms[0] ?? "cell";
  const correct = `The fundamental unit named in ${input.chapter ?? "this chapter"}`;
  const options = shuffleWithCorrect(
    [`A decorative metaphor`, correct, `An unrelated older term`, `A synonym for the chapter title`],
    correct
  );
  return {
    question: `Match the term "${term}" to its closest meaning on page ${input.pageNum}.`,
    options,
    correctIndex: options.indexOf(correct),
    correctText: correct,
    explanation: `"${term}" is introduced as the chapter's foundational unit, not a decorative device.`,
    questionType: "vocabulary_match",
    curriculumTags: [],
    difficultyScore: 0,
    misconceptionTargets: []
  };
}

function buildTranslateAndType(input: GeneratorInput, first: string): CheckpointCandidate {
  const phrase = first.replace(/[^a-zA-Z\s]/g, "").split(/\s+/).slice(0, 4).join(" ").toLowerCase();
  return {
    question: `Type the equivalent of "${phrase}" in the target language.`,
    options: [],
    correctIndex: null,
    correctText: phrase,
    explanation: `The phrase appears verbatim in the page's first sentence. Re-read the audio narration if you missed it.`,
    questionType: "translate_and_type",
    curriculumTags: [],
    difficultyScore: 0,
    misconceptionTargets: []
  };
}

function shuffleWithCorrect(distractors: string[], correct: string): string[] {
  const opts = [correct, ...distractors];
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [opts[i], opts[j]] = [opts[j]!, opts[i]!];
  }
  return opts;
}

function buildCurriculumTags(input: GeneratorInput, sceneKey: string): string[] {
  const framework = input.framework ?? "KENYA_CBC";
  const gradeBand = inferGradeBand(input.text);
  const subject = inferSubject(input.text, sceneKey);
  const codes: Record<string, string> = {
    KENYA_CBC: `${subject}.${gradeBand}`,
    COMMON_CORE: `CCSS.${subject === "Mathematics" ? "MATH" : subject === "Science" ? "SCI" : "ELA"}.${gradeBand}`,
    NGSS: `NGSS.${subject === "Science" ? "HS" : "MS"}.${sceneKey.toUpperCase()}`,
    CAMBRIDGE_IGCSE: `IGCSE.${subject.toUpperCase()}.${gradeBand}`,
    IB: `IB.${subject.toUpperCase()}.${gradeBand}`,
    NCERT_INDIA: `NCERT.${subject.toUpperCase()}.${gradeBand}`,
    CAPS_SOUTH_AFRICA: `CAPS.${subject.toUpperCase()}.${gradeBand}`
  };
  return [`${framework}:${codes[framework] ?? `${framework}.${subject}.${gradeBand}`}`];
}

function inferGradeBand(text: string): string {
  if (/advanced|university|higher/i.test(text)) return "12+";
  if (/secondary|high school/i.test(text)) return "10-11";
  if (/upper primary/i.test(text)) return "6-9";
  return "6-9";
}

function inferSubject(text: string, sceneKey: string): string {
  if (sceneKey === "mitosis" || sceneKey === "diagram") return "Science";
  if (sceneKey === "equation") return "Mathematics";
  if (sceneKey === "language" || sceneKey === "translate") return "Languages";
  if (/history|civilisation|empire/i.test(text)) return "History";
  return "English";
}