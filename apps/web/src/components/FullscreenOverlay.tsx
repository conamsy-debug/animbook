import { useEffect, useRef, useState } from "react";
import type { Narration } from "@/lib/useNarration";

interface Props {
  active: boolean;
  narration: Narration;
  onPlay(): void;
  onPause(): void;
  onPrev(): void;
  onNext(): void;
  onExit(): void;
  pageNumber: number;
  total: number;
  caption: string;
}

const icon = {
  prev: <path d="M15.5 5.5 9 12l6.5 6.5" />,
  next: <path d="M8.5 5.5 15 12l-6.5 6.5" />,
  exit: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  cc: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="M10.5 10.2a2.2 2.2 0 1 0 0 3.6M16.5 10.2a2.2 2.2 0 1 0 0 3.6" />
    </>
  )
};

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/** Controls and captions laid over the video while it is full screen. */
export function FullscreenOverlay({ active, narration, onPlay, onPause, onPrev, onNext, onExit, pageNumber, total, caption }: Props) {
  const [visible, setVisible] = useState(true);
  const [captions, setCaptions] = useState(true);
  const timer = useRef<number | null>(null);
  const busy = narration.speaking || narration.preparing;

  useEffect(() => {
    if (!active) return;
    const wake = () => {
      setVisible(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setVisible(false), 2800);
    };
    wake();
    document.addEventListener("mousemove", wake);
    document.addEventListener("touchstart", wake);
    document.addEventListener("keydown", wake);
    return () => {
      document.removeEventListener("mousemove", wake);
      document.removeEventListener("touchstart", wake);
      document.removeEventListener("keydown", wake);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [active]);

  if (!active) return null;
  return (
    <div className={`fs-overlay${visible ? " show" : ""}`}>
      {captions && caption && (
        <p className="fs-caption" aria-live="polite">
          {caption}
        </p>
      )}
      <div className="fs-bar" role="group" aria-label="Full screen controls">
        <button type="button" className="fs-btn" onClick={onPrev} disabled={pageNumber <= 1} aria-label="Previous page">
          <Svg>{icon.prev}</Svg>
        </button>
        <button
          type="button"
          className="fs-play"
          onClick={busy ? onPause : onPlay}
          aria-label={busy ? "Pause" : "Play narration"}
        >
          {busy ? (
            <svg viewBox="0 0 24 24" aria-hidden><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" /><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden><path d="M8 5.5v13l10.5-6.5Z" fill="currentColor" /></svg>
          )}
        </button>
        <button type="button" className="fs-btn" onClick={onNext} disabled={pageNumber >= total} aria-label="Next page">
          <Svg>{icon.next}</Svg>
        </button>
        <span className="fs-count">
          {pageNumber} / {total}
        </span>
        <span className="fs-spacer" />
        <button
          type="button"
          className={`fs-btn${captions ? " on" : ""}`}
          onClick={() => setCaptions((c) => !c)}
          aria-pressed={captions}
          aria-label={captions ? "Hide captions" : "Show captions"}
          title="Captions"
        >
          <Svg>{icon.cc}</Svg>
        </button>
        <button type="button" className="fs-btn" onClick={onExit} aria-label="Exit full screen" title="Exit full screen (F / Esc)">
          <Svg>{icon.exit}</Svg>
        </button>
      </div>
    </div>
  );
}
