import { useEffect, useMemo, useRef } from "react";
import { useReaderStore } from "@/lib/store";

interface Props {
  onPlayNarration(): void;
  onNext?: () => void;
  onPrev?: () => void;
}

const modes: Array<{ id: "WATCH" | "BOTH" | "READ"; label: string }> = [
  { id: "WATCH", label: "Watch" },
  { id: "BOTH", label: "Read + Watch" },
  { id: "READ", label: "Read" }
];

export function ReaderControls({ onPlayNarration, onNext, onPrev }: Props) {
  const { pages, pageIndex, mode, setMode, flipNext, flipPrev } = useReaderStore();
  const total = pages.length;
  const progress = total > 0 ? ((pageIndex + 1) / total) * 100 : 0;

  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "ArrowRight") (onNext ?? flipNext)();
      if (ev.key === "ArrowLeft") (onPrev ?? flipPrev)();
      if (ev.key === " ") {
        ev.preventDefault();
        (onNext ?? flipNext)();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipNext, flipPrev, onNext, onPrev]);

  return (
    <div className="reader-controls">
      <div className="bar">
        <button ref={buttonRef} type="button" className="btn ghost" onClick={onPrev ?? flipPrev} disabled={pageIndex === 0}>‹ Prev</button>
        <span className="label" style={{ alignSelf: "center", padding: "0 8px" }}>
          {total === 0 ? "—" : `${pageIndex + 1} / ${total}`}
        </span>
        <button type="button" className="btn ghost" onClick={onNext ?? flipNext} disabled={pageIndex >= total - 1}>Next ›</button>
        <button type="button" className="btn ghost" onClick={onPlayNarration} aria-label="Play narration">
          ♪
        </button>
        <ModeSwitch mode={mode} setMode={setMode} />
      </div>
      <div className="progress" style={{ marginTop: 8 }}>
        <div className="bar-fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function ModeSwitch({ mode, setMode }: { mode: "WATCH" | "BOTH" | "READ"; setMode: (m: "WATCH" | "BOTH" | "READ") => void }) {
  const items = useMemo(() => modes, []);
  return (
    <div className="mode-switch" role="tablist" aria-label="Reading mode">
      {items.map((item) => (
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
  );
}