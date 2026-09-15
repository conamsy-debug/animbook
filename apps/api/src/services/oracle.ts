/**
 * AnimBook ORACLE — AI-generated story continuation.
 *
 * When the reader reaches an Oracle decision point, the system generates
 * a next page in the author's voice and lets the reader choose between
 * branches. The continuation is persisted as an `OracleNode` so when the
 * reader picks a branch the next page is consistent with the tree.
 *
 * Live when the Anthropic key is set; deterministic fallback otherwise.
 */
import { PrismaClient } from "@prisma/client";
import { appEnv, isFeatureEnabled } from "../config/env.js";

const prisma = new PrismaClient();

export interface OracleChoice {
  label: string;
  promptText: string;
}

export interface OracleContinuation {
  choiceLabel: string;
  generatedText: string;
  animationPrompt: string;
  speakerName: string;
  emotion: string;
}

const DEFAULT_CHOICES: OracleChoice[] = [
  { label: "Step forward", promptText: "The protagonist chooses to step forward into the unknown." },
  { label: "Look back", promptText: "The protagonist pauses and looks back at where they started." },
  { label: "Speak the truth", promptText: "The protagonist decides to speak the truth they have been holding." }
];

export async function getOrCreateOracleTree(bookId: string, rootPage: number) {
  const existing = await prisma.oracleTree.findUnique({
    where: { bookId_rootPage: { bookId, rootPage } },
    include: { nodes: true }
  });
  if (existing) return existing;
  return prisma.oracleTree.create({
    data: {
      bookId,
      rootPage,
      nodes: {
        create: DEFAULT_CHOICES.map((choice) => ({
          pageNum: 0,
          choiceLabel: choice.label,
          promptText: choice.promptText,
          generatedText: "",
          animationPrompt: "",
          emotion: "reflective"
        }))
      }
    },
    include: { nodes: true }
  });
}

export async function generateOracleContinuation(input: {
  bookId: string;
  parentNodeId: string;
  bookTitle: string;
  vertical: string;
  voice: string;
}): Promise<OracleContinuation> {
  const parent = await prisma.oracleNode.findUnique({ where: { id: input.parentNodeId } });
  if (!parent) throw new Error("Oracle node not found");
  if (isFeatureEnabled("BOOK_BRAIN")) {
    try {
      const text = await callAnthropicForOracle({
        parent,
        bookTitle: input.bookTitle,
        vertical: input.vertical,
        voice: input.voice
      });
      return text;
    } catch (err) {
      console.warn("[oracle] Anthropic call failed, falling back:", (err as Error).message);
    }
  }
  return buildFallbackContinuation(parent, input.voice);
}

async function callAnthropicForOracle(input: {
  parent: { promptText: string; generatedText: string; choiceLabel: string; emotion: string };
  bookTitle: string;
  vertical: string;
  voice: string;
}): Promise<OracleContinuation> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": String(appEnv.ANTHROPIC_API_KEY),
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: appEnv.ANTHROPIC_BOOK_BRAIN_MODEL,
      max_tokens: 800,
      system: "You are the AnimBook Oracle. Generate the next page of the book in the author's voice. Return valid JSON.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            book: input.bookTitle,
            vertical: input.vertical,
            voice: input.voice,
            previousBeat: input.parent.generatedText || input.parent.promptText,
            choice: input.parent.choiceLabel,
            prompt: input.parent.promptText,
            schema: {
              choiceLabel: "string",
              generatedText: "string",
              animationPrompt: "string",
              speakerName: "string",
              emotion: "string"
            }
          })
        }
      ]
    })
  });
  if (!response.ok) throw new Error(`Anthropic returned ${response.status}`);
  const json = (await response.json()) as { content?: { text?: string }[] };
  const parsed = JSON.parse(json.content?.[0]?.text ?? "{}") as OracleContinuation;
  return parsed;
}

function buildFallbackContinuation(parent: { choiceLabel: string; generatedText: string; promptText: string }, voice: string): OracleContinuation {
  const text = parent.generatedText || `${voice} chose ${parent.choiceLabel.toLowerCase()}. The scene shifts, and the room around them responds. What was certain a moment ago folds into something softer, and the next decision waits at the edge of the frame.`;
  return {
    choiceLabel: parent.choiceLabel,
    generatedText: text,
    animationPrompt: `Cinematic reaction shot pulling focus from the ${voice.toLowerCase()}'s face to the environment, painterly.`,
    speakerName: voice,
    emotion: "reflective"
  };
}

export async function persistOracleContinuation(input: {
  treeId: string;
  parentNodeId: string;
  continuation: OracleContinuation;
  pageNum: number;
}): Promise<{ id: string }> {
  return prisma.oracleNode.create({
    data: {
      treeId: input.treeId,
      parentNodeId: input.parentNodeId,
      pageNum: input.pageNum,
      choiceLabel: input.continuation.choiceLabel,
      promptText: `Continuation: ${input.continuation.choiceLabel}`,
      generatedText: input.continuation.generatedText,
      animationPrompt: input.continuation.animationPrompt,
      speakerName: input.continuation.speakerName,
      emotion: input.continuation.emotion
    },
    select: { id: true }
  });
}