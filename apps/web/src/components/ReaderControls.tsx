import { useEffect } from "react";
import { useReaderStore } from "@/lib/store";
import type { Narration } from "@/lib/useNarration";

interface Props {
  narration: Narration;
  onPlay(): void;
  onPause(): void;
  onNext?: () => void;
  onPrev?: () => void;
  autoFlip?: boolean;
  onToggleAutoFlip?: () => void;
}

type Mode = "WATCH" | "BOTH" | "READ";

const modes: Array<{ id: Mode; label: string }> = [
  { id: "WATCH", label: "Watch" },
  { id: "BOTH", label: "Read & Watch" },
  { id: "READ", label: "Read" }
];

const Icon = {
  prev: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M15.5 5.5 9 12l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  next: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M8.5 5.5 15 12l-6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  play: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2Z" fill="currentColor" />
    </svg>
  ),
  pause: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
    </svg>
  ),
  volume: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" fill="currentColor" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  auto: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 7h11a4 4 0 0 1 0 8H9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m12 12-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  muted: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" fill="currentColor" />
      <path d="m16 9.5 5 5m0-5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
};

export function ReaderControls({ narration, onPlay, onPause, onNext, onPrev, autoFlip, onToggleAutoFlip }: Props) {
  const { pages, pageIndex, mode, setMode, flipNext, flipPrev } = useReaderStore();
  const total = pages.length;
  const progress = total > 0 ? ((pageIndex + 1) / total) * 100 : 0;
  const next = onNext ?? flipNext;
  const prev = onPrev ?? flipPrev;
  const { speaking, muted, volume } = narration;

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const target = ev.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (ev.key === "ArrowRight") next();
      if (ev.key === "ArrowLeft") prev();
      if (ev.key === " ") {
        ev.preventDefault();
        if (speaking) onPause();
        else onPlay();
      }
      if (ev.key === "m" || ev.key === "M") narration.toggleMute();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, speaking, onPause, onPlay, narration]);

  const shownVolume = muted ? 0 : volume;

  return (
    <div className="player" role="group" aria-label="Reader controls">
      <div className="player-progress" aria-hidden>
        <div className="player-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="player-row">
        <div className="player-side player-left">
          <div className="segmented" role="tablist" aria-label="Reading mode">
            {modes.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={mode === item.id}
                className={mode === item.id ? "active" : ""}
                onClick={() => setMode(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="player-center">
          <button type="button" className="icon-btn" onClick={prev} disabled={pageIndex === 0} aria-label="Previous page" title="Previous page (←)">
            {Icon.prev}
          </button>
          <button
            type="button"
            className="play-btn"
            onClick={speaking ? onPause : onPlay}
            aria-label={speaking ? "Pause" : "Play narration"}
            title={speaking ? "Pause (space)" : "Play (space)"}
          >
            {speaking ? Icon.pause : Icon.play}
          </button>
          <button type="button" className="icon-btn" onClick={next} disabled={pageIndex >= total - 1} aria-label="Next page" title="Next page (→)">
            {Icon.next}
          </button>
        </div>

        <div className="player-side player-right">
          {onToggleAutoFlip && (
            <button
              type="button"
              className={`toggle-chip${autoFlip ? " on" : ""}`}
              onClick={onToggleAutoFlip}
              aria-pressed={Boolean(autoFlip)}
              title={autoFlip ? "Pages turn by themselves after narration (click to turn off)" : "Turn pages yourself (click to auto-turn)"}
            >
              {Icon.auto}
              <span>Auto-turn</span>
            </button>
          )}
          <span className="page-count">{total === 0 ? "—" : `Page ${pageIndex + 1} of ${total}`}</span>
          <div className="volume">
            <button
              type="button"
              className="icon-btn small"
              onClick={narration.toggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
              title={muted ? "Unmute (M)" : "Mute (M)"}
            >
              {muted || volume === 0 ? Icon.muted : Icon.volume}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={shownVolume}
              onChange={(e) => narration.setVolume(Number(e.target.value))}
              aria-label="Volume"
              style={{ ["--fill" as string]: `${shownVolume * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
