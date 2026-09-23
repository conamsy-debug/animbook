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
