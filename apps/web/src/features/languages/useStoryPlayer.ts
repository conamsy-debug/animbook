/**
 * useStoryPlayer — playback state machine for the StoryPlayer.
 *
 * Spec § 7 screen 4 + Patch 07 exercise handoff. Drives a
 * scene-by-scene, line-by-line player that the Subtitle + Controls
 * components read from. The hook is pure UI state — it does NOT
 * own the media element. When real audio/video lands (Patch 11's
 * TTS step), the media element will live in a sibling component and
 * sync to this state.
 *
 * Phases:
 *   loading  → player payload is in flight
 *   ready    → payload loaded; user can press play
 *   error    → load failed; show retry button
 *
 * Playback state (only meaningful when phase === "ready"):
 *   currentSceneIndex  → which scene is active
 *   currentLineIndex   → which line in that scene is active
 *   playing            → true when the auto-advance timer is running
 *   speed              → 0.75 or 1 (spec § 7)
 *
 * Exercise state (Patch 07):
 *   currentExerciseIndex  → which exercise in the current scene is
 *                           active. null when the player is in the
 *                           "watch lines" phase. After a scene's
 *                           lines finish, this auto-advances into
 *                           exercise mode (0). On the last exercise
 *                           of the last scene, the story is done.
 *
 * Auto-advance: while `playing` is true, the hook advances lines
 * every `LINE_DURATION_MS / speed` ms. Real word-timing-driven
 * advancement lands in Patch 11; the public API stays the same.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerExercise, PlayerLine, PlayerPayload, PlaybackSpeed, PlayerPhase, PlayerToggles } from "./types";

/** A1 stories need short lines — we use this as the placeholder
 *  "this line should take N ms" until Patch 11 ships real word
 *  timings. Tuned for ~150 wpm (~2.5 wps) which matches the
 *  NARRATION_CHARS_PER_SEC constant in `services/narration/constants.ts`. */
export const LINE_DURATION_MS = 4000;

export interface UseStoryPlayerResult {
  phase: PlayerPhase;
  errorMessage: string | null;
  payload: PlayerPayload | null;

  /** Active scene — null while loading or before the user starts. */
  currentScene: PlayerPayload["scenes"][number] | null;
  currentSceneIndex: number;
  currentLine: PlayerLine | null;
  currentLineIndex: number;

  /** Patch 07 — exercise handoff. null when the player is in line
   *  playback; non-null when the scene's exercises are surfacing. */
  currentExercise: PlayerExercise | null;
  currentExerciseIndex: number | null;
  /** True after the last exercise of the last scene — the StoryPlayer
   *  renders the story-complete summary. */
  storyComplete: boolean;

  playing: boolean;
  speed: PlaybackSpeed;
  toggles: PlayerToggles;
  newLexemeCount: number;

  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  replayCurrentLine: () => void;
  goToScene: (sceneIndex: number) => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  setToggles: (next: Partial<PlayerToggles>) => void;

  /** Patch 07 — advance past the current exercise. Called by the
   *  ExerciseView's "Continue" button after the result renders. */
  nextExercise: () => void;

  /** Progress within the story as a 0..1 number. The player uses this
   *  for the progress bar. */
  progress: number;
}

export function useStoryPlayer(payload: PlayerPayload | null, phase: PlayerPhase, errorMessage: string | null): UseStoryPlayerResult {
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [currentExerciseIndex, setCurrentExerciseIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(1);
  const [toggles, setTogglesState] = useState<PlayerToggles>(() => ({
    showTranslation: false,
    showReadingAid: payload?.readingAid != null
  }));

  // When the payload changes (e.g. base lang toggle reloads), reset
  // to the start of the story. We use a ref to skip the initial run.
  const lastPayloadRef = useRef<PlayerPayload | null>(null);
  useEffect(() => {
    if (!payload) return;
    if (lastPayloadRef.current?.storyId !== payload.storyId) {
      setCurrentSceneIndex(0);
      setCurrentLineIndex(0);
      setCurrentExerciseIndex(null);
      setPlaying(false);
      lastPayloadRef.current = payload;
    }
  }, [payload]);

  const currentScene = useMemo(() => {
    if (!payload) return null;
    return payload.scenes[currentSceneIndex] ?? null;
  }, [payload, currentSceneIndex]);

  const currentLine = useMemo(() => {
    if (!currentScene) return null;
    return currentScene.lines[currentLineIndex] ?? null;
  }, [currentScene, currentLineIndex]);

  const currentExercise = useMemo<PlayerExercise | null>(() => {
    if (currentExerciseIndex === null || !currentScene) return null;
    return currentScene.exercises[currentExerciseIndex] ?? null;
  }, [currentScene, currentExerciseIndex]);

  /** True when we're past the last exercise of the last scene. */
  const storyComplete = useMemo(() => {
    if (!payload) return false;
    if (currentExerciseIndex === null) return false;
    return (
      currentSceneIndex >= payload.scenes.length - 1 &&
      currentScene !== null &&
      currentExerciseIndex >= currentScene.exercises.length - 1
    );
  }, [payload, currentScene, currentSceneIndex, currentExerciseIndex]);

  // Auto-advance timer. When `playing` is true, advance to the next
  // line every LINE_DURATION_MS / speed. When we run off the end of
  // a scene's lines, pause + auto-enter exercise mode (Patch 07).
  useEffect(() => {
    if (!playing) return;
    if (!currentScene) return;
    const interval = window.setInterval(() => {
      setCurrentLineIndex((idx) => {
        const next = idx + 1;
        if (next >= currentScene.lines.length) {
          // Reached the end of the scene → pause + open exercises.
          setPlaying(false);
          if (currentScene.exercises.length > 0) {
            // Schedule on the next tick so React has applied the
            // lineIndex reset before we flip into exercise mode.
            queueMicrotask(() => setCurrentExerciseIndex(0));
          } else {
            // No exercises in this scene — fast-forward to the
            // next scene's first line.
            queueMicrotask(() => {
              setCurrentSceneIndex((sceneIdx) => sceneIdx + 1);
              setCurrentLineIndex(0);
              setCurrentExerciseIndex(null);
              setPlaying(true);
            });
          }
          return idx;
        }
        return next;
      });
    }, LINE_DURATION_MS / speed);
    return () => window.clearInterval(interval);
  }, [playing, currentScene, speed]);

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const togglePlay = useCallback(() => setPlaying((p) => !p), []);

  const next = useCallback(() => {
    if (!payload) return;
    // If we're in exercise mode, "next" advances to the next exercise
    // — the parent calls nextExercise() but keep this hook
    // self-consistent so the controls bar can also wire it.
    if (currentExerciseIndex !== null && currentScene) {
      const nextEx = currentExerciseIndex + 1;
      if (nextEx < currentScene.exercises.length) {
        setCurrentExerciseIndex(nextEx);
      } else if (currentSceneIndex + 1 < payload.scenes.length) {
        setCurrentSceneIndex((s) => s + 1);
        setCurrentLineIndex(0);
        setCurrentExerciseIndex(null);
      }
      return;
    }
    setCurrentSceneIndex((sceneIdx) => {
      const scene = payload.scenes[sceneIdx];
      if (!scene) return sceneIdx;
      setCurrentLineIndex((lineIdx) => {
        if (lineIdx + 1 < scene.lines.length) return lineIdx + 1;
        if (sceneIdx + 1 < payload.scenes.length) {
          queueMicrotask(() => {
            setCurrentLineIndex(0);
            setCurrentExerciseIndex(null);
          });
        }
        return lineIdx;
      });
      if (currentLineIndex + 1 >= scene.lines.length && sceneIdx + 1 < payload.scenes.length) {
        return sceneIdx + 1;
      }
      return sceneIdx;
    });
  }, [payload, currentLineIndex, currentExerciseIndex, currentScene, currentSceneIndex]);

  const prev = useCallback(() => {
    if (!payload) return;
    // From exercise mode, "prev" returns to the last line of the scene.
    if (currentExerciseIndex !== null && currentScene) {
      setCurrentExerciseIndex(null);
      setCurrentLineIndex(Math.max(0, currentScene.lines.length - 1));
      return;
    }
    setCurrentSceneIndex((sceneIdx) => {
      setCurrentLineIndex((lineIdx) => {
        if (lineIdx > 0) return lineIdx - 1;
        if (sceneIdx > 0) {
          const prevScene = payload.scenes[sceneIdx - 1];
          queueMicrotask(() => setCurrentLineIndex(Math.max(0, prevScene.lines.length - 1)));
          return lineIdx;
        }
        return 0;
      });
      if (currentLineIndex === 0 && sceneIdx > 0) return sceneIdx - 1;
      return sceneIdx;
    });
  }, [payload, currentLineIndex, currentExerciseIndex, currentScene]);

  const replayCurrentLine = useCallback(() => {
    if (!currentScene) return;
    // Replay from the exercise screen means restart the scene.
    if (currentExerciseIndex !== null) {
      setCurrentExerciseIndex(null);
      setCurrentLineIndex(0);
    }
    setPlaying(false);
    setCurrentLineIndex((idx) => idx);
    setPlaying(true);
  }, [currentScene, currentExerciseIndex]);

  const goToScene = useCallback(
    (sceneIndex: number) => {
      if (!payload) return;
      if (sceneIndex < 0 || sceneIndex >= payload.scenes.length) return;
      setCurrentSceneIndex(sceneIndex);
      setCurrentLineIndex(0);
      setCurrentExerciseIndex(null);
      setPlaying(false);
    },
    [payload]
  );

  const setSpeed = useCallback((s: PlaybackSpeed) => setSpeedState(s), []);

  const setToggles = useCallback((next: Partial<PlayerToggles>) => {
    setTogglesState((cur) => ({ ...cur, ...next }));
  }, []);

  // Patch 07 — advance past the current exercise. The StoryPlayer
  // calls this from the ExerciseView's "Continue" button.
  const nextExercise = useCallback(() => {
    if (!payload || !currentScene) return;
    if (currentExerciseIndex === null) return;
    const nextEx = currentExerciseIndex + 1;
    if (nextEx < currentScene.exercises.length) {
      setCurrentExerciseIndex(nextEx);
      return;
    }
    // Done with this scene's exercises — advance to the next scene
    // (or mark story complete if this was the last scene).
    if (currentSceneIndex + 1 < payload.scenes.length) {
      setCurrentSceneIndex((s) => s + 1);
      setCurrentLineIndex(0);
      setCurrentExerciseIndex(null);
    } else {
      // Stay put — storyComplete is true via the memo. The StoryPlayer
      // renders the summary.
      setCurrentExerciseIndex(currentScene.exercises.length); // past the end
    }
  }, [payload, currentScene, currentSceneIndex, currentExerciseIndex]);

  // Progress: total lines completed / total lines in story.
  const progress = useMemo(() => {
    if (!payload) return 0;
    let total = 0;
    let seen = 0;
    for (const s of payload.scenes) {
      total += s.lines.length;
      if (s.order < (currentScene?.order ?? -1)) {
        seen += s.lines.length;
      } else if (s === currentScene) {
        if (currentExerciseIndex !== null) {
          // Scene finished — count all its lines as seen.
          seen += s.lines.length;
        } else {
          seen += currentLineIndex;
        }
      }
    }
    return total === 0 ? 0 : seen / total;
  }, [payload, currentScene, currentLineIndex, currentExerciseIndex]);

  return {
    phase,
    errorMessage,
    payload,
    currentScene,
    currentSceneIndex,
    currentLine,
    currentLineIndex,
    currentExercise,
    currentExerciseIndex,
    storyComplete,
    playing,
    speed,
    toggles,
    newLexemeCount: payload?.newLexemeCount ?? 0,
    play,
    pause,
    togglePlay,
    next,
    prev,
    replayCurrentLine,
    goToScene,
    setSpeed,
    setToggles,
    nextExercise,
    progress
  };
}