/**
 * ExerciseView — Patch 07.
 *
 * Spec § 7.6 + § 8. The five Phase 1 exercise types each render as a
 * discrete view that submits a single attempt to
 * `POST /api/lang/exercises/:exerciseId/attempts`:
 *
 *   - comprehension_mc: a question + N options; learner picks one.
 *   - word_meaning_mc:  "What does `X` mean?" + N options; learner picks one.
 *   - sentence_builder: shuffled tokens the learner taps to assemble
 *                       the line in the right order.
 *   - listen_select:    plays an audio clip; learner picks the line
 *                       they heard from N options.
 *   - speak_line:       records the learner speaking a line. Patch 07
 *                       ships a stub UI (score slider); Patch 08 wires
 *                       the MediaRecorder + Whisper upload.
 *
 * UX flow:
 *   1. The view mounts → disabled until the learner makes a choice.
 *   2. Submit fires POST /attempts.
 *   3. We flip to a "result" state that shows the correct answer +
 *      XP earned, with a "Continue" button that calls onDone().
 *
 * Mobile-first 375px. The MC options are stacked radio-like buttons
 * with the surface form in the target language + the base-language
 * gloss below.
 */
import { useEffect, useMemo, useState } from "react";
import {
  submitExerciseAttempt,
  type BaseLang,
  type ExerciseAttemptResult
} from "./api";
import { t, type Locale } from "./i18n/t";
import type { PlayerExercise } from "./types";

/** One MC option — supports both flat string options (the
 *  comprehension + listen_select shapes) and per-base-language
 *  string arrays (word_meaning_mc). */
interface NormalisedOption {
  index: number;
  text: string;
}

function normaliseOptions(
  payload: Record<string, unknown>,
  base: BaseLang
): NormalisedOption[] {
  const raw = payload["options"];
  if (Array.isArray(raw) && raw.every((v) => typeof v === "string")) {
    return (raw as string[]).map((text, index) => ({ index, text }));
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, string[] | undefined>;
    // Prefer the learner's base; fall back to en so the wire shape
    // stays stable when fr glosses haven't shipped yet (matches the
    // /api/lang/lexemes fallback).
    const byBase = obj[base] ?? obj["en"];
    if (Array.isArray(byBase)) {
      return byBase.map((text, index) => ({ index, text }));
    }
  }
  return [];
}

interface ExerciseViewProps {
  exercise: PlayerExercise;
  base: BaseLang;
  locale: Locale;
  /** Fires when the learner dismisses the result screen — the player
   *  advances to the next exercise or next scene. */
  onDone: () => void;
}

export function ExerciseView({ exercise, base, locale, onDone }: ExerciseViewProps) {
  switch (exercise.type) {
    case "comprehension_mc":
    case "word_meaning_mc":
    case "listen_select":
      return <McView exercise={exercise} base={base} locale={locale} onDone={onDone} />;
    case "sentence_builder":
      return <SentenceBuilderView exercise={exercise} base={base} locale={locale} onDone={onDone} />;
    case "speak_line":
      return <SpeakLineView exercise={exercise} base={base} locale={locale} onDone={onDone} />;
    default:
      return (
        <UnknownExercise
          exercise={exercise}
          message={t("exercise.unsupported", locale, { type: exercise.type })}
          onDone={onDone}
        />
      );
  }
}

/* --------------------------------------------------------------------- *
 * Multiple-choice views (comprehension_mc, word_meaning_mc, listen_select)
 * --------------------------------------------------------------------- */

function McView({ exercise, base, locale, onDone }: ExerciseViewProps) {
  const payload = exercise.payload;
  const options = useMemo(() => normaliseOptions(payload, base), [payload, base]);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<ExerciseAttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const question = pickQuestion(payload, base);
  const prompt = exercise.type === "listen_select" ? t("exercise.listenPrompt", locale) : null;

  const submit = async () => {
    if (selected === null || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await submitExerciseAttempt({
        exerciseId: exercise.exerciseId,
        body: { type: exercise.type as "comprehension_mc" | "word_meaning_mc" | "listen_select", index: selected }
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("exercise.error", locale));
    } finally {
      setSubmitting(false);
    }
  };

  // Reset on exercise change (the StoryPlayer reuses the same
  // <ExerciseView /> as the scene advances).
  useEffect(() => {
    setSelected(null);
    setResult(null);
    setError(null);
  }, [exercise.exerciseId]);

  return (
    <div className="lang-exercise lang-exercise--mc">
      <h2 className="lang-exercise-question">{question}</h2>
      {prompt ? <p className="lang-exercise-prompt">{prompt}</p> : null}

      <ul className="lang-exercise-options" role="radiogroup" aria-label={question}>
        {options.map((opt) => {
          const isCorrect = result?.isCorrect && result.correctIndex === opt.index;
          const isWrongSelection = result && !result.isCorrect && selected === opt.index;
          const isRevealCorrect =
            result && !result.isCorrect && result.correctIndex === opt.index;
          const classes = [
            "lang-exercise-option",
            isCorrect && "lang-exercise-option--correct",
            isWrongSelection && "lang-exercise-option--wrong",
            isRevealCorrect && "lang-exercise-option--reveal"
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={opt.index}>
              <button
                type="button"
                role="radio"
                aria-checked={selected === opt.index}
                className={classes}
                onClick={() => !result && setSelected(opt.index)}
                disabled={Boolean(result) || submitting}
              >
                {opt.text}
              </button>
            </li>
          );
        })}
      </ul>

      {result ? <ResultPanel result={result} locale={locale} onDone={onDone} /> : null}

      {!result ? (
        <button
          type="button"
          className="lang-exercise-submit"
          onClick={submit}
          disabled={selected === null || submitting}
        >
          {submitting ? t("exercise.submitting", locale) : t("exercise.check", locale)}
        </button>
      ) : null}

      {error ? (
        <p className="lang-exercise-error" role="alert">{error}</p>
      ) : null}
    </div>
  );
}

function pickQuestion(payload: Record<string, unknown>, base: BaseLang): string {
  const q = payload["question"];
  if (q && typeof q === "object") {
    const byBase = (q as Record<string, string | undefined>)[base];
    if (byBase) return byBase;
  }
  return t("exercise.questionFallback", base);
}

/* --------------------------------------------------------------------- *
 * sentence_builder — shuffled tokens, tap to assemble in order
 * --------------------------------------------------------------------- */

function SentenceBuilderView({ exercise, base, locale, onDone }: ExerciseViewProps) {
  const payload = exercise.payload;
  // The server sends `tokens` as a shuffled list of surface strings.
  // We keep the candidate pool on the client and let the learner tap
  // to assemble into the "selected" list.
  const candidates = useMemo<string[]>(() => {
    const raw = payload["tokens"];
    if (Array.isArray(raw) && raw.every((v) => typeof v === "string")) return raw as string[];
    return [];
  }, [payload]);
  const [picked, setPicked] = useState<number[]>([]);
  const [result, setResult] = useState<ExerciseAttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPicked([]);
    setResult(null);
    setError(null);
  }, [exercise.exerciseId]);

  const tapCandidate = (idx: number) => {
    if (result) return;
    setPicked((cur) => [...cur, idx]);
  };
  const untapPicked = (idx: number) => {
    if (result) return;
    setPicked((cur) => cur.filter((c) => c !== idx));
  };
  const reset = () => {
    setPicked([]);
  };

  const submit = async () => {
    if (picked.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // The wire format for sentence_builder is the order of indices
      // into the candidate pool. The server's scoring compares these
      // indices element-wise against answer.order (which holds the
      // ground-truth indices into the same pool).
      const r = await submitExerciseAttempt({
        exerciseId: exercise.exerciseId,
        body: { type: "sentence_builder", order: picked }
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("exercise.error", locale));
    } finally {
      setSubmitting(false);
    }
  };

  const assembledText = picked.map((i) => candidates[i]).join(" ");

  return (
    <div className="lang-exercise lang-exercise--builder" lang={base}>
      <h2 className="lang-exercise-question">{t("exercise.builderPrompt", locale)}</h2>

      <p className="lang-exercise-builder-output" aria-live="polite">
        {assembledText || <span className="lang-exercise-builder-output--empty">{t("exercise.builderEmpty", locale)}</span>}
      </p>

      <ul className="lang-exercise-builder-pool" role="list" aria-label={t("exercise.builderPrompt", locale)}>
        {candidates.map((tok, idx) => {
          const used = picked.includes(idx);
          return (
            <li key={idx}>
              <button
                type="button"
                className={
                  "lang-exercise-builder-token" +
                  (used ? " lang-exercise-builder-token--used" : "")
                }
                onClick={() => (used ? untapPicked(idx) : tapCandidate(idx))}
                disabled={Boolean(result) || submitting}
                aria-pressed={used}
              >
                {tok}
              </button>
            </li>
          );
        })}
      </ul>

      {!result ? (
        <div className="lang-exercise-builder-actions">
          <button
            type="button"
            className="lang-exercise-builder-reset"
            onClick={reset}
            disabled={picked.length === 0 || submitting}
          >
            {t("exercise.reset", locale)}
          </button>
          <button
            type="button"
            className="lang-exercise-submit"
            onClick={submit}
            disabled={picked.length === 0 || submitting}
          >
            {submitting ? t("exercise.submitting", locale) : t("exercise.check", locale)}
          </button>
        </div>
      ) : null}

      {result ? <ResultPanel result={result} locale={locale} onDone={onDone} /> : null}

      {error ? <p className="lang-exercise-error" role="alert">{error}</p> : null}
    </div>
  );
}

/* --------------------------------------------------------------------- *
 * speak_line — Patch 07 stub. Patch 08 swaps the score slider for a
 * MediaRecorder + Whisper upload flow. The wire format is the same
 * (the server treats the score as authoritative either way), so the
 * UI upgrade is purely local.
 * --------------------------------------------------------------------- */

function SpeakLineView({ exercise, base, locale, onDone }: ExerciseViewProps) {
  const [score, setScore] = useState<number>(80);
  const [transcript, setTranscript] = useState<string>("");
  const [result, setResult] = useState<ExerciseAttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setScore(80);
    setTranscript("");
    setResult(null);
    setError(null);
  }, [exercise.exerciseId]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await submitExerciseAttempt({
        exerciseId: exercise.exerciseId,
        body: { type: "speak_line", score, transcript: transcript || undefined }
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("exercise.error", locale));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="lang-exercise lang-exercise--speak" lang={base}>
      <h2 className="lang-exercise-question">{t("exercise.speakPrompt", locale)}</h2>
      <p className="lang-exercise-speak-stub">{t("exercise.speakStub", locale)}</p>

      <label className="lang-exercise-speak-score">
        <span className="lang-exercise-speak-score-label">
          {t("exercise.speakScore", locale, undefined, score)}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          disabled={Boolean(result) || submitting}
          className="lang-exercise-speak-slider"
        />
      </label>

      <label className="lang-exercise-speak-transcript">
        <span className="lang-exercise-speak-transcript-label">
          {t("exercise.speakTranscript", locale)}
        </span>
        <input
          type="text"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder={t("exercise.speakTranscriptPlaceholder", locale)}
          disabled={Boolean(result) || submitting}
          className="lang-exercise-speak-input"
        />
      </label>

      {!result ? (
        <button
          type="button"
          className="lang-exercise-submit"
          onClick={submit}
          disabled={submitting}
        >
          {submitting ? t("exercise.submitting", locale) : t("exercise.submitScore", locale)}
        </button>
      ) : null}

      {result ? <ResultPanel result={result} locale={locale} onDone={onDone} /> : null}

      {error ? <p className="lang-exercise-error" role="alert">{error}</p> : null}
    </div>
  );
}

/* --------------------------------------------------------------------- *
 * Result panel + unknown fallback
 * --------------------------------------------------------------------- */

function ResultPanel({
  result,
  locale,
  onDone
}: {
  result: ExerciseAttemptResult;
  locale: Locale;
  onDone: () => void;
}) {
  return (
    <section
      className={
        "lang-exercise-result" +
        (result.isCorrect ? " lang-exercise-result--correct" : " lang-exercise-result--wrong")
      }
      role="status"
    >
      <p className="lang-exercise-result-line">
        {result.isCorrect
          ? t("exercise.correct", locale)
          : t("exercise.wrong", locale)}
      </p>
      {result.xpAwarded > 0 ? (
        <p className="lang-exercise-result-xp">
          {t("exercise.xpAwarded", locale, undefined, result.xpAwarded)}
        </p>
      ) : null}
      <button type="button" className="lang-exercise-continue" onClick={onDone}>
        {t("exercise.continue", locale)}
      </button>
    </section>
  );
}

function UnknownExercise({
  exercise,
  message,
  onDone
}: {
  exercise: PlayerExercise;
  message: string;
  onDone: () => void;
}) {
  return (
    <div className="lang-exercise lang-exercise--unknown" role="alert">
      <p className="lang-exercise-error">{message}</p>
      <p className="lang-exercise-error-meta">id={exercise.exerciseId}</p>
      <button type="button" className="lang-exercise-continue" onClick={onDone}>
        {t("exercise.skip", "en")}
      </button>
    </div>
  );
}