/**
 * PlayerControls — the bottom bar of the StoryPlayer.
 *
 * Spec § 7 screen 4 toggles + transport:
 *   - play / pause (tap to toggle)
 *   - previous / next line
 *   - replay current line (spec: "Tap a line to replay it" — the
 *     line itself also has this onClick; the button is the
 *     accessibility-friendly duplicate)
 *   - playback speed (0.75× / 1×)
 *   - show translation toggle
 *   - show reading aid toggle (only when the language has one)
 *
 * The progress bar at the top mirrors `progress` from the state
 * hook. Mobile-first 375px — buttons are at least 44px tall per
 * Apple HIG / Material guidelines.
 */
import type { PlaybackSpeed, PlayerToggles, ReadingAid } from "./types";

interface PlayerControlsProps {
  playing: boolean;
  speed: PlaybackSpeed;
  toggles: PlayerToggles;
  readingAid: ReadingAid;
  progress: number;
  canPrev: boolean;
  canNext: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onReplay: () => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
  onToggleTranslation: () => void;
  onToggleReadingAid: () => void;
}

export function PlayerControls({
  playing,
  speed,
  toggles,
  readingAid,
  progress,
  canPrev,
  canNext,
  onTogglePlay,
  onPrev,
  onNext,
  onReplay,
  onSpeedChange,
  onToggleTranslation,
  onToggleReadingAid
}: PlayerControlsProps) {
  return (
    <div className="lang-controls" role="toolbar" aria-label="Story player controls">
      <div className="lang-controls-progress">
        <div className="lang-controls-progress-bar" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
      </div>

      <div className="lang-controls-row">
        <button
          type="button"
          className="lang-btn lang-btn--ghost"
          onClick={onPrev}
          disabled={!canPrev}
          aria-label="Previous line"
        >
          ‹‹
        </button>

        <button
          type="button"
          className="lang-btn lang-btn--ghost"
          onClick={onReplay}
          aria-label="Replay current line"
        >
          ↻
        </button>

        <button
          type="button"
          className="lang-btn lang-btn--primary lang-btn--play"
          onClick={onTogglePlay}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <button
          type="button"
          className="lang-btn lang-btn--ghost"
          onClick={onNext}
          disabled={!canNext}
          aria-label="Next line"
        >
          ››
        </button>

        <div className="lang-controls-speed" role="group" aria-label="Playback speed">
          <button
            type="button"
            className={`lang-btn lang-btn--speed ${speed === 0.75 ? "lang-btn--active" : ""}`}
            onClick={() => onSpeedChange(0.75)}
            aria-pressed={speed === 0.75}
          >
            0.75×
          </button>
          <button
            type="button"
            className={`lang-btn lang-btn--speed ${speed === 1 ? "lang-btn--active" : ""}`}
            onClick={() => onSpeedChange(1)}
            aria-pressed={speed === 1}
          >
            1×
          </button>
        </div>
      </div>

      <div className="lang-controls-row lang-controls-row--toggles">
        <label className="lang-toggle">
          <input
            type="checkbox"
            checked={toggles.showTranslation}
            onChange={onToggleTranslation}
            aria-label="Show translation"
          />
          <span>Translation</span>
        </label>

        {readingAid ? (
          <label className="lang-toggle">
            <input
              type="checkbox"
              checked={toggles.showReadingAid}
              onChange={onToggleReadingAid}
              aria-label={`Show reading aid (${readingAid})`}
            />
            <span>{readingAid === "pinyin" ? "Pinyin" : "Niqqud"}</span>
          </label>
        ) : null}
      </div>
    </div>
  );
}
