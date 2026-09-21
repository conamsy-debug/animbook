import { useEffect, useRef, useState } from "react";
import { READER_ASPECTS, type ReaderAspect } from "@/components/ReaderStage";
import { BOOK_VOICE, voiceErrorMessage, voiceSample, type VoiceOption } from "@/lib/voices";
import { useReaderStore } from "@/lib/store";
import type { Narration } from "@/lib/useNarration";
import { SPEED_LEVELS, SPEED_HINTS, formatSpeed, type Speed } from "@/lib/speed";

interface Props {
  narration: Narration;
  onPlay(): void;
  onPause(): void;
  onNext?: () => void;
  onPrev?: () => void;
  autoFlip?: boolean;
  onToggleAutoFlip?: () => void;
  aspect?: ReaderAspect;
  onAspectChange?: (aspect: ReaderAspect) => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /** Narrators readers can choose; omit to hide the voice menu. */
  /** Notes on this page; omit to hide the notes button. */
  noteCount?: number;
  notesOpen?: boolean;
  onToggleNotes?(): void;
  voices?: VoiceOption[];
  voice?: string;
  onVoiceChange?: (voice: string) => void;
  onVoiceNotice?: (message: string) => void;
  /** Reader's chosen playback rate. Controls both video and narration. */
  speed?: Speed;
  onSpeedChange?: (speed: Speed) => void;
  /**
   * Loop-seam crossfade on the page video (CSS keyframes `loop-fade`
   * class). Default true. Some readers find the dip too subtle, some
   * find it distracting on bright covers — toggle here.
   */
  loopFade?: boolean;
  onToggleLoopFade?: () => void;
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
  loopFade: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M5 9c0-2.2 1.8-4 4-4h6c2.2 0 4 1.8 4 4v6c0 2.2-1.8 4-4 4H9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m7 7-3 2 3 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 14v3a3 3 0 0 1-3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  notes: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M4.5 5.5h15v10h-9l-4.2 3.4a.5.5 0 0 1-.8-.4V15.5h-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  ),
  voice: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17 7.5c1 1.2 1 3.8 0 5M19.6 5.5c2 2.4 2 6.6 0 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  spinner: (
    <svg viewBox="0 0 24 24" aria-hidden className="spin">
      <path d="M12 3a9 9 0 1 1-9 9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  ),
  screen: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 9.5V8.5h2M17 14.5v1h-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  expand: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  collapse: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  muted: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" fill="currentColor" />
      <path d="m16 9.5 5 5m0-5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  speed: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 4a8 8 0 1 1-7.4 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m12 4-1.6 3.3 3.5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 8.5v4l2.5 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
};

function AspectShape({ aspect }: { aspect: ReaderAspect }) {
  const [w, h] = aspect.split(":").map(Number);
  const scale = 16 / Math.max(w, h);
  return (
    <span className="aspect-slot" aria-hidden>
      <span className="aspect-shape" style={{ width: w * scale, height: h * scale }} />
    </span>
  );
}

export function ReaderControls({
  narration,
  onPlay,
  onPause,
  onNext,
  onPrev,
  autoFlip,
  onToggleAutoFlip,
  aspect = "16:9",
  onAspectChange,
  fullscreen = false,
  onToggleFullscreen,
  loopFade = true,
  onToggleLoopFade,
  noteCount,
  notesOpen = false,
  onToggleNotes,
  voices,
  voice = BOOK_VOICE,
  onVoiceChange,
  onVoiceNotice,
  speed = 1.0,
  onSpeedChange
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const voiceMenuRef = useRef<HTMLDivElement | null>(null);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const speedMenuRef = useRef<HTMLDivElement | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!voiceMenuOpen) return;
    function onDown(ev: MouseEvent) {
      if (voiceMenuRef.current && !voiceMenuRef.current.contains(ev.target as Node)) setVoiceMenuOpen(false);
    }
    function onEsc(ev: KeyboardEvent) {
      if (ev.key === "Escape") setVoiceMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [voiceMenuOpen]);

  useEffect(() => () => previewAudio.current?.pause(), []);

  async function preview(id: string) {
    previewAudio.current?.pause();
    if (previewing === id) {
      setPreviewing(null);
      return;
    }
    setPreviewing(id);
    try {
      const url = await voiceSample(id);
      const audio = previewAudio.current ?? new Audio();
      previewAudio.current = audio;
      audio.src = url;
      audio.volume = narration.muted ? 0 : narration.volume;
      audio.onended = () => setPreviewing(null);
      await audio.play();
    } catch (err) {
      setPreviewing(null);
      onVoiceNotice?.(voiceErrorMessage(err));
    }
  }

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(ev: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) setMenuOpen(false);
    }
    function onEsc(ev: KeyboardEvent) {
      if (ev.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!speedMenuOpen) return;
    function onDown(ev: MouseEvent) {
      if (speedMenuRef.current && !speedMenuRef.current.contains(ev.target as Node)) setSpeedMenuOpen(false);
    }
    function onEsc(ev: KeyboardEvent) {
      if (ev.key === "Escape") setSpeedMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [speedMenuOpen]);

  const { pages, pageIndex, mode, setMode, flipNext, flipPrev } = useReaderStore();
  const total = pages.length;
  const progress = total > 0 ? ((pageIndex + 1) / total) * 100 : 0;
  const next = onNext ?? flipNext;
  const prev = onPrev ?? flipPrev;
  const { speaking, muted, volume, preparing } = narration;
  const busy = speaking || preparing;

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const target = ev.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (ev.key === "ArrowRight") next();
      if (ev.key === "ArrowLeft") prev();
      if (ev.key === " ") {
        ev.preventDefault();
        if (busy) onPause();
        else onPlay();
      }
      if (ev.key === "m" || ev.key === "M") narration.toggleMute();
      if ((ev.key === "f" || ev.key === "F") && onToggleFullscreen) onToggleFullscreen();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, busy, onPause, onPlay, narration, onToggleFullscreen]);

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
          {/* Prev/Next live as floating .stage-arrow buttons at the
           *  page edges (ReaderStage.tsx). Keeping them out of the
           *  player bar avoids overlap with the auto-turn / loop-fade
           *  chips on the right side and gives the reader an iBooks-
           *  style "drag the page edge" affordance. */}
          <button
            type="button"
            className={`play-btn${preparing ? " preparing" : ""}`}
            onClick={busy ? onPause : onPlay}
            aria-label={preparing ? "Preparing narration — press to cancel" : speaking ? "Pause" : "Play narration"}
            title={preparing ? "Preparing this voice…" : speaking ? "Pause (space)" : "Play (space)"}
          >
            {preparing ? Icon.spinner : speaking ? Icon.pause : Icon.play}
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
              <span className="chip-label">Auto-turn</span>
            </button>
          )}
          {onToggleLoopFade && (
            <button
              type="button"
              className={`toggle-chip${loopFade ? " on" : ""}`}
              onClick={onToggleLoopFade}
              aria-pressed={Boolean(loopFade)}
              title={loopFade
                ? "Loop-seam crossfade on (click to disable — some readers prefer the hard cut)"
                : "Loop-seam crossfade off (click to enable — softens the 5s loop seam)"}
              aria-label="Toggle loop-seam crossfade"
            >
              {Icon.loopFade}
              <span className="chip-label">Loop fade</span>
            </button>
          )}
          {onToggleNotes && (
            <button
              type="button"
              className={`icon-btn small notes-btn${notesOpen ? " active" : ""}`}
              onClick={onToggleNotes}
              aria-pressed={notesOpen}
              aria-label={noteCount ? `Notes (${noteCount})` : "Notes"}
              title="Notes from other readers"
            >
              {Icon.notes}
              {noteCount ? <span className="note-count">{noteCount > 9 ? "9+" : noteCount}</span> : null}
            </button>
          )}
          {voices && voices.length > 0 && onVoiceChange && (
            <div className="menu-anchor" ref={voiceMenuRef}>
              <button
                type="button"
                className={`icon-btn small${voiceMenuOpen ? " active" : ""}${voice !== BOOK_VOICE ? " chosen" : ""}`}
                onClick={() => setVoiceMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={voiceMenuOpen}
                aria-label="Narrator voice"
                title="Narrator voice"
              >
                {Icon.voice}
              </button>
              {voiceMenuOpen && (
                <div className="player-menu voice-menu" role="menu" aria-label="Narrator voice">
                  <div className="player-menu-title">Narrator</div>
                  {[{ id: BOOK_VOICE, label: "This book's narrator", description: "Recorded for this book" }, ...voices].map((option) => (
                    <div key={option.id} className={`voice-row${voice === option.id ? " selected" : ""}`}>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={voice === option.id}
                        className="voice-pick"
                        onClick={() => {
                          onVoiceChange(option.id);
                          setVoiceMenuOpen(false);
                        }}
                      >
                        <span className="player-menu-text">
                          <span>{option.label}</span>
                          <small>{option.description}</small>
                        </span>
                        {voice === option.id && <span className="player-menu-check">{Icon.check}</span>}
                      </button>
                      {option.id !== BOOK_VOICE && (
                        <button
                          type="button"
                          className="voice-preview"
                          onClick={() => void preview(option.id)}
                          aria-label={previewing === option.id ? `Stop ${option.label} sample` : `Play ${option.label} sample`}
                          title="Hear a sample"
                        >
                          {previewing === option.id ? Icon.pause : Icon.play}
                        </button>
                      )}
                    </div>
                  ))}
                  <p className="voice-note">Other voices are recorded the first time a page is played, so they may take a few seconds.</p>
                </div>
              )}
            </div>
          )}
          {onSpeedChange && (
            <div className="menu-anchor" ref={speedMenuRef}>
              <button
                type="button"
                className={`icon-btn small speed-btn${speedMenuOpen ? " active" : ""}${speed !== 1.0 ? " chosen" : ""}`}
                onClick={() => setSpeedMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={speedMenuOpen}
                aria-label={`Playback speed (${formatSpeed(speed)})`}
                title={`Playback speed — ${formatSpeed(speed)}`}
              >
                {Icon.speed}
                <span className="speed-label" aria-hidden>{formatSpeed(speed)}</span>
              </button>
              {speedMenuOpen && (
                <div className="player-menu speed-menu" role="menu" aria-label="Playback speed">
                  <div className="player-menu-title">Playback speed</div>
                  {SPEED_LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      role="menuitemradio"
                      aria-checked={speed === level}
                      className={speed === level ? "selected" : ""}
                      onClick={() => {
                        onSpeedChange(level);
                        setSpeedMenuOpen(false);
                      }}
                    >
                      <span className="player-menu-text">
                        <span>{formatSpeed(level)}</span>
                        <small>{SPEED_HINTS[level]}</small>
                      </span>
                      {speed === level && <span className="player-menu-check">{Icon.check}</span>}
                    </button>
                  ))}
                  <p className="voice-note">Sets the video and the narration together.</p>
                </div>
              )}
            </div>
          )}
          {onAspectChange && (
            <div className="menu-anchor" ref={menuRef}>
              <button
                type="button"
                className={`icon-btn small${menuOpen ? " active" : ""}`}
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Screen size"
                title="Screen size"
              >
                {Icon.screen}
              </button>
              {menuOpen && (
                <div className="player-menu" role="menu" aria-label="Screen size">
                  <div className="player-menu-title">Screen size</div>
                  {READER_ASPECTS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={aspect === option.id}
                      className={aspect === option.id ? "selected" : ""}
                      onClick={() => {
                        onAspectChange(option.id);
                        setMenuOpen(false);
                      }}
                    >
                      <AspectShape aspect={option.id} />
                      <span className="player-menu-text">
                        <span>{option.label}</span>
                        <small>{option.hint}</small>
                      </span>
                      {aspect === option.id && <span className="player-menu-check">{Icon.check}</span>}
                    </button>
                  ))}
                  {onToggleFullscreen && (
                    <>
                      <div className="player-menu-sep" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onToggleFullscreen();
                        }}
                      >
                        <span className="player-menu-icon">{fullscreen ? Icon.collapse : Icon.expand}</span>
                        <span className="player-menu-text">
                          <span>{fullscreen ? "Exit full screen" : "Full screen"}</span>
                          <small>Shortcut: F</small>
                        </span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {onToggleFullscreen && (
            <button
              type="button"
              className="icon-btn small"
              onClick={onToggleFullscreen}
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              title={fullscreen ? "Exit full screen (F)" : "Full screen (F)"}
            >
              {fullscreen ? Icon.collapse : Icon.expand}
            </button>
          )}
          <span className="page-count">{total === 0 ? "—" : (
              <>
                <span className="page-count-word">Page </span>
                {pageIndex + 1}
                <span className="page-count-sep"> of </span>
                {total}
              </>
            )}</span>
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
