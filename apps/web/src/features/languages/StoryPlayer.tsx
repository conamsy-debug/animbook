/**
 * StoryPlayer — the screen Patch 04 ships.
 *
 * Spec § 7 screen 4 + script/layout requirements. Pulls a player
 * payload from `/api/lang/stories/:storyId`, runs it through
 * `useStoryPlayer`, and renders:
 *
 *   - Top: story title + scene counter
 *   - Middle: a placeholder clip area (Patch 11 will fill with the
 *     real `<video>` element when R2 clips land)
 *   - Bottom: the Subtitle (with tappable tokens + RTL/ruby) and
 *     the PlayerControls bar
 *
 * Mobile-first 375px. The wrapper carries `lang=` and `dir=` so
 * screen readers + browser BIDI pick the right defaults (spec § 7).
 *
 * Honours the LANGUAGES_ENABLED flag at the page level — this
 * component assumes the route is reachable and the payload is
 * well-formed.
 */
import { useEffect, useRef, useState } from "react";
import { fetchStoryPlayer } from "./api";
import { Subtitle } from "./Subtitle";
import { PlayerControls } from "./PlayerControls";
import { useStoryPlayer } from "./useStoryPlayer";
import type { BaseLang, PlayerPayload, PlayerPhase } from "./types";

interface StoryPlayerProps {
  /** Synthetic storyId matching the server's format
   *  (`story:<masterSlug>:<targetLang>`). The page route builds
   *  this from the URL. */
  storyId: string;
  /** Base language for translations + glosses. */
  base?: BaseLang;
  /** Patch 06 will pass this in to wire up the word popup. The
   *  player reads it but ignores it for now (the token click still
   *  bubbles up to the line replay). */
  onTokenTap?: (lexemeId: string) => void;
  /**
   * Patch 05 — fires when the active scene changes. The page wires
   * this to `saveStoryProgress()` so the learner's progress is
   * persisted once per scene. The hook fires it on the FIRST scene
   * too (so a "viewed but didn't progress" counts as in_progress),
   * and again with `completed: true` when the last scene's final
   * line ticks over.
   */
  onSceneChange?: (info: { sceneIndex: number; completed: boolean }) => void;
}

export function StoryPlayer({ storyId, base = "en", onTokenTap, onSceneChange }: StoryPlayerProps) {
  const [phase, setPhase] = useState<PlayerPhase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [payload, setPayload] = useState<PlayerPayload | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setPhase("loading");
    setErrorMessage(null);
    fetchStoryPlayer(storyId, base, ac.signal)
      .then((data) => {
        if (!data) {
          setPhase("error");
          setErrorMessage("Story not found.");
          return;
        }
        setPayload(data);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setPhase("error");
        setErrorMessage(err instanceof Error ? err.message : "Failed to load story.");
      });
    return () => ac.abort();
  }, [storyId, base]);

  const player = useStoryPlayer(payload, phase, errorMessage);

  // Patch 05 — fire onSceneChange whenever the active scene
  // changes. We compare against a ref so we don't double-fire when
  // the player state resets on payload swap.
  const lastFiredSceneRef = useRef<number>(-1);
  useEffect(() => {
    if (phase !== "ready") return;
    if (!onSceneChange) return;
    if (player.currentSceneIndex === lastFiredSceneRef.current) return;
    lastFiredSceneRef.current = player.currentSceneIndex;
    const completed = player.currentSceneIndex >= payload.scenes.length - 1 && !player.playing && player.currentLineIndex >= (player.currentScene?.lines.length ?? 1) - 1;
    onSceneChange({ sceneIndex: player.currentSceneIndex, completed });
  }, [phase, onSceneChange, player.currentSceneIndex, player.currentLineIndex, player.playing, player.currentScene, payload]);

  // Loading / error states render a minimal shell so the page can
  // wrap this in the cinematic topbar without layout shift.
  if (phase === "loading") {
    return (
      <div className="lang-player lang-player--loading" aria-busy="true">
        <p>Loading story…</p>
      </div>
    );
  }
  if (phase === "error" || !payload) {
    return (
      <div className="lang-player lang-player--error" role="alert">
        <p>{errorMessage ?? "Could not load story."}</p>
      </div>
    );
  }

  // The outer wrapper carries the per-story lang + dir so the
  // browser picks the right BIDI defaults. The Subtitle also sets
  // its own lang/dir per spec § 7.
  return (
    <div
      className="lang-player"
      lang={payload.lang}
      dir={payload.direction}
      style={payload.fontFamily ? ({ ["--lang-font-family" as string]: payload.fontFamily }) : undefined}
    >
      <header className="lang-player-header">
        <h1 className="lang-player-title">{payload.title}</h1>
        <p className="lang-player-meta">
          <span className="lang-player-scene">
            Scene {player.currentSceneIndex + 1} of {payload.scenes.length}
          </span>
          {payload.newLexemeCount > 0 ? (
            <span className="lang-player-new-words" title="New words in this story">
              {payload.newLexemeCount} new
            </span>
          ) : null}
        </p>
      </header>

      {/* Placeholder for the animated clip + per-line audio. Spec
          § 7 requires it; Patch 11's pipeline fills the real URLs. */}
      <div className="lang-player-stage" aria-hidden="true">
        <div className="lang-player-stage-placeholder">
          <p>Animated clip placeholder</p>
          <p className="lang-player-stage-meta">
            {payload.masterSlug} · {payload.targetLang} · A1
          </p>
        </div>
      </div>

      <Subtitle
        line={player.currentLine}
        lang={payload.lang}
        direction={payload.direction}
        fontFamily={payload.fontFamily}
        readingAid={payload.readingAid}
        toggles={player.toggles}
        onReplayLine={player.replayCurrentLine}
        onTokenTap={
          onTokenTap
            ? (idx) => {
                const token = player.currentLine?.tokens[idx];
                if (token?.lexemeId) onTokenTap(token.lexemeId);
              }
            : undefined
        }
      />

      <PlayerControls
        playing={player.playing}
        speed={player.speed}
        toggles={player.toggles}
        readingAid={payload.readingAid}
        progress={player.progress}
        canPrev={player.currentSceneIndex > 0 || player.currentLineIndex > 0}
        canNext={
          player.currentSceneIndex < payload.scenes.length - 1 ||
          player.currentLineIndex < (player.currentScene?.lines.length ?? 1) - 1
        }
        onTogglePlay={player.togglePlay}
        onPrev={player.prev}
        onNext={player.next}
        onReplay={player.replayCurrentLine}
        onSpeedChange={player.setSpeed}
        onToggleTranslation={() => player.setToggles({ showTranslation: !player.toggles.showTranslation })}
        onToggleReadingAid={() => player.setToggles({ showReadingAid: !player.toggles.showReadingAid })}
      />
    </div>
  );
}
