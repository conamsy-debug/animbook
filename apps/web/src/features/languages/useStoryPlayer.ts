/**
 * useStoryPlayer — playback state machine for the StoryPlayer.
 *
 * Spec § 7 screen 4. Drives a scene-by-scene, line-by-line player
 * that the Subtitle + Controls components read from. The hook is
 * pure UI state — it does NOT own the media element. When real
 * audio/video lands (Patch 11's TTS step), the media element will
 * live in a sibling component and sync to this state.
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
 * Auto-advance: while `playing` is true, the hook advances lines
 * every `LINE_DURATION_MS / speed` ms. Real audio will replace this
 * with word-timing-driven advancement in Patch 11; the public API
 * stays the same.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerLine, PlayerPayload, PlaybackSpeed, PlayerPhase, PlayerToggles } from "./types";

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

  /** Progress within the story as a 0..1 number. The player uses this
   *  for the progress bar. */
  progress: number;
}

export function useStoryPlayer(payload: PlayerPayload | null, phase: PlayerPhase, errorMessage: string | null): UseStoryPlayerResult {
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
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

  // Auto-advance timer. When `playing` is true, advance to the next
  // line every LINE_DURATION_MS / speed. When we run off the end of
  // a scene's lines, pause (the UI then shows the scene's exercises).
  useEffect(() => {
    if (!playing) return;
    if (!currentScene) return;
    const interval = window.setInterval(() => {
      setCurrentLineIndex((idx) => {
        const next = idx + 1;
        if (next >= currentScene.lines.length) {
          // Reached the end of the scene → pause so the UI can show
          // exercises. Patch 07 will resume from the exercise screen.
          setPlaying(false);
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
    setCurrentSceneIndex((sceneIdx) => {
      const scene = payload.scenes[sceneIdx];
      if (!scene) return sceneIdx;
      setCurrentLineIndex((lineIdx) => {
        if (lineIdx + 1 < scene.lines.length) return lineIdx + 1;
        // Move to the next scene's first line.
        if (sceneIdx + 1 < payload.scenes.length) {
          // Defer the scene bump until the next tick so this state
          // setter resolves against the current sceneIdx.
          queueMicrotask(() => setCurrentLineIndex(0));
        }
        return lineIdx;
      });
      if (currentLineIndex + 1 >= scene.lines.length && sceneIdx + 1 < payload.scenes.length) {
        return sceneIdx + 1;
      }
      return sceneIdx;
    });
  }, [payload, currentLineIndex]);

  const prev = useCallback(() => {
    if (!payload) return;
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
  }, [payload, currentLineIndex]);

  const replayCurrentLine = useCallback(() => {
    if (!currentScene) return;
    // Spec § 7: "Tap a line to replay it." The hook just re-arms the
    // timer. Real audio replay will hook into the media element's
    // currentTime in Patch 11.
    setPlaying(false);
    // Reset the active line by toggling its index by 0 (forces React
    // to re-render the subtitle highlight).
    setCurrentLineIndex((idx) => idx);
    setPlaying(true);
  }, [currentScene]);

  const goToScene = useCallback(
    (sceneIndex: number) => {
      if (!payload) return;
      if (sceneIndex < 0 || sceneIndex >= payload.scenes.length) return;
      setCurrentSceneIndex(sceneIndex);
      setCurrentLineIndex(0);
      setPlaying(false);
    },
    [payload]
  );

  const setSpeed = useCallback((s: PlaybackSpeed) => setSpeedState(s), []);

  const setToggles = useCallback((next: Partial<PlayerToggles>) => {
    setTogglesState((cur) => ({ ...cur, ...next }));
  }, []);

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
        seen += currentLineIndex;
      }
    }
    return total === 0 ? 0 : seen / total;
  }, [payload, currentScene, currentLineIndex]);

  return {
    phase,
    errorMessage,
    payload,
    currentScene,
    currentSceneIndex,
    currentLine,
    currentLineIndex,
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
    progress
  };
}
