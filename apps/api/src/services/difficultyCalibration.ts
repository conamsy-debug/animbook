/**
 * 4-dimension Difficulty Calibration.
 *
 *   - reading_level:        derived from mean sentence length + token variety.
 *   - conceptual_density:   number of distinct noun phrases per 100 words.
 *   - prior_knowledge:      heuristics about assumed schemas.
 *   - visual_complexity:    inferred from camera angle + scene type keywords.
 *
 * Each dimension is a 0-1 score; the AnimBook Studio Review dashboard uses
 * these scores to surface pages that may need scaffolding.
 */
import type { DifficultyScore } from "../../domain/index.js";

export type { DifficultyScore } from "../../domain/index.js";

export interface DifficultyInput {
  text: string;
  sceneType: string | null;
  cameraAngle: string | null;
  emotionalRegister: string | null;
  vertical: string;
}

export function calibrateDifficulty(input: DifficultyInput): DifficultyScore {
  const sentences = input.text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const words = input.text.split(/\s+/).filter(Boolean);
  const avgSentenceLen = sentences.length > 0 ? words.length / sentences.length : words.length;
  const reading_level = clamp01(Math.min(1, avgSentenceLen / 28));

  const distinctNouns = countDistinctNouns(input.text);
  const conceptual_density = clamp01(distinctNouns / Math.max(1, words.length / 100));

  const schemaTerms = ["because", "therefore", "however", "although", "since", "thus", "consequently"];
  const priorHits = schemaTerms.reduce((acc, term) => acc + (input.text.toLowerCase().includes(term) ? 1 : 0), 0);
  const prior_knowledge = clamp01(0.2 + priorHits / schemaTerms.length);

  const camera = (input.cameraAngle ?? "").toLowerCase();
  const scene = (input.sceneType ?? "").toLowerCase();
  const complexCameraHints = ["macro", "microscopy", "overhead", "wide", "aerial"];
  const complexSceneHints = ["diagram", "anatomy", "schematic", "scientific"];
  const visual_complexity = clamp01(
    (complexCameraHints.some((hint) => camera.includes(hint)) ? 0.4 : 0.2) +
      (complexSceneHints.some((hint) => scene.includes(hint)) ? 0.5 : 0.1)
  );

  return { reading_level, conceptual_density, prior_knowledge, visual_complexity };
}

function countDistinctNouns(text: string): number {
  const tokens = text.toLowerCase().match(/\b[a-z][a-z\-]{3,}\b/g) ?? [];
  const set = new Set<string>();
  for (const token of tokens) set.add(token);
  return set.size;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}