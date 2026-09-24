/**
 * AnimBook Languages (Phase 1) — public re-exports.
 *
 * The HTTP routes in `apps/api/src/modules/languages/routes.ts` (Patch
 * 04 onward) import from here. Keeping a barrel file means callers
 * never reach into the individual schema/importer/exporter modules
 * — easier to refactor internals without rippling through the
 * routes.
 */
export type {
  Lesson,
  LessonLine,
  LessonToken,
  LessonScene,
  LessonExercise,
  LessonExercisePayload,
  CefrLevel,
  ExerciseType,
  Phase1LangCode,
  ImportResult
} from "./types.js";
export { parseLesson, tryParseLesson, LessonValidationError } from "./schema.js";
export { importLesson, type ImportOptions } from "./importer.js";
export { exportStory, type ExportOptions } from "./exporter.js";

// Patch 08 — speech-to-text + pronunciation scoring helpers.
export {
  type SttProvider,
  type AlignedWord,
  type WordStatus,
  WhisperOpenAIProvider,
  resolveSttProvider,
  normaliseForCompare,
  tokenise,
  alignTokens,
  scoreFromAlignment
} from "./stt.js";

// Patch 09 — FSRS spaced repetition (spec § 10 + § 11).
export {
  type CardState,
  type CardRating,
  type CardSnapshot,
  type RateCardResult,
  type ReviewLogMeta,
  rateCard,
  newCardSnapshot,
  ratingName,
  REVIEW_BATCH_SIZE
} from "./fsrs.js";

// Patch 10 — streak math (spec § 7.3 + § 11). tz-aware day counter.
export {
  type StreakResult,
  bumpStreak,
  localDateInTz,
  daysBetween,
  resolveTz
} from "./streaks.js";

// Patch 11 — content pipeline: LLM adaptation + orchestrator.
// BullMQ + Redis worker was the original plan; we ship the
// orchestrator as a synchronous `runAdaptationJob` because the
// project's `node_modules` install is broken in ways that prevent
// BullMQ from booting in tests. The DB row is the source of truth
// for status; a BullMQ worker can plug in later without changing
// the routes.
export {
  type LlmProvider,
  type MasterScript,
  type AdaptResult,
  AnthropicLlmProvider,
  LessonAdaptationError,
  promptFor,
  adaptWithRetry,
  resolveLlmProvider
} from "./llm.js";
export {
  enqueueAdaptation,
  getAdaptationJob,
  runAdaptationJob,
  rederiveStatus
} from "./adaptation.js";
