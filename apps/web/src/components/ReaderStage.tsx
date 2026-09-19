import { useEffect, useMemo, useRef, type ReactNode, type Ref } from "react";
import { motion } from "framer-motion";
import { useReaderStore } from "@/lib/store";
import type { BookSummary, PageRecord } from "@/lib/api";

interface Props {
  book: BookSummary;
  pages: PageRecord[];
  bedtime?: boolean;
  lensEnabled?: boolean;
  onWordTap?: (word: string) => void;
  paletteHint?: string;
  motionScale?: number;
  fontSize?: number;
  /** The reader pressed Pause — freeze the page's animation too. */
  paused?: boolean;
  /** Frame shape for the video, e.g. "16:9", "3:4". */
  aspect?: ReaderAspect;
  /** The video frame element (this is what goes full screen). */
  videoFrameRef?: Ref<HTMLElement>;
  /** Controls and captions shown over the video while it is full screen. */
  fullscreenOverlay?: ReactNode;
  /** Playback rate for the page's <video> (1 = normal). Default 1. */
  playbackRate?: number;
  /**
   * Apply the CSS loop-seam crossfade (`.loop-fade`) to the page video.
   * Default true. Toggleable from the Reader controls — some readers
   * prefer the hard cut, others find the dip distracting on bright art.
   */
  loopFade?: boolean;
}

export type ReaderAspect = "16:9" | "4:3" | "3:4" | "1:1" | "9:16";

export const READER_ASPECTS: Array<{ id: ReaderAspect; label: string; hint: string }> = [
  { id: "16:9", label: "Original", hint: "16:9 · widescreen" },
  { id: "4:3", label: "Classic", hint: "4:3" },
  { id: "3:4", label: "Portrait", hint: "3:4 · tablets" },
  { id: "1:1", label: "Square", hint: "1:1" },
  { id: "9:16", label: "Phone", hint: "9:16 · full-height" }
];

function aspectNumber(aspect: ReaderAspect): number {
  const [w, h] = aspect.split(":").map(Number);
  return w / h;
}

function pickAccent(vertical: string): string {
  const map: Record<string, string> = {
    CONSUMER: "#1B6B8A",
    KIDS: "#D9872A",
    EDU: "#1A6B3C",
    FAITH: "#6B2D8B",
    DOCS: "#56738A",
    VERSE: "#9D4C73",
    COMICS: "#C94B32",
    BUSINESS: "#B58B27",
    WELLNESS: "#3F8172",
    LAW: "#7A6650",
    TRAVEL: "#14818E",
    ORIGINALS: "#C49A1C"
  };
  return map[vertical] ?? "#1B6B8A";
}

export function ReaderStage({ book, pages, bedtime = false, lensEnabled = false, onWordTap, paletteHint = "default", motionScale = 1, fontSize = 18, paused = false, aspect = "16:9", videoFrameRef, fullscreenOverlay, playbackRate = 1, loopFade = true }: Props) {
  const { pageIndex, mode, isFlipping, flippingDirection, setBook, flipNext, flipPrev, finishFlip } = useReaderStore();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setBook(book, pages);
  }, [book, pages, setBook]);

  const current = pages[pageIndex];

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) video.pause();
    else void video.play().catch(() => undefined);
  }, [paused, current?.id, mode]);

  // Keep the page's <video> in sync with the reader's chosen playback rate.
  // Re-applies on every page turn (new current.id) because the element may
  // have been swapped out by the motion layer.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate, current?.id]);

  const accent = useMemo(() => pickAccent(book.vertical), [book.vertical]);

  if (!current) return null;

  const paletteAccent: Record<string, string> = {
    default: "#C49A1C",
    cool: "#14818E",
    warm: "#D9872A",
    graphite: "#56738A",
    neon: "#9D4C73"
  };
  const bannerAccent = paletteAccent[paletteHint] ?? pickAccent(book.vertical);
  const renderWords = (text: string) => {
    if (!onWordTap) return text;
    return text.split(/(\s+)/).map((segment, idx) => {
      if (/^\s+$/.test(segment)) return segment;
      return (
        <button
          key={idx}
          type="button"
          className="word-tap"
          onClick={(e) => {
            e.stopPropagation();
            onWordTap(segment);
          }}
        >
          {segment}
        </button>
      );
    });
  };

  return (
    <div
      className={`reader-stage mode-${mode.toLowerCase()}${aspectNumber(aspect) < 1 ? " aspect-portrait" : ""}`}
      style={{ ["--accent-page" as string]: bannerAccent, ["--ar" as string]: aspectNumber(aspect).toFixed(4) }}
      data-aspect={aspect}
    >
      {/* The spread and the video frame stay mounted across page turns, so full
          screen isn't interrupted; only the page content fades in. (The old
          exit-then-enter animation could stall and leave the stage blank.) */}
      <div className="spread">
        {mode !== "WATCH" && (
          <article className="page text">
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 6 * motionScale }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: bedtime ? 0.6 : 0.35, ease: "easeOut" }}
              onAnimationComplete={finishFlip}
            >
              <div className="page-kicker" style={{ color: bannerAccent }}>
                {book.title} · Page {current.pageNum}
              </div>
              {current.chapter && <div className="chapter">{current.chapter}</div>}
              {current.speakerName && book.vertical === "KIDS" && (
                <div className="label" style={{ color: "var(--kids)", marginBottom: 8 }}>
                  As told by {current.speakerName}
                </div>
              )}
              <p
                className="body"
                style={{
                  fontSize: `clamp(${fontSize * 0.85}px, ${fontSize / 14}vw, ${fontSize * 1.25}px)`,
                  lineHeight: 1.7
                }}
              >
                {lensEnabled ? "You see " : ""}{renderWords(current.textExcerpt)}
              </p>
            </motion.div>
          </article>
        )}
        {mode !== "READ" && (
          <article className="page video" aria-label={`Page ${current.pageNum} animation`} ref={videoFrameRef}>
            <motion.div
              key={current.id}
              className="video-layer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: bedtime ? 0.6 : 0.35, ease: "easeOut" }}
              onAnimationComplete={finishFlip}
            >
              {current.videoUrl && !/\.(png|jpe?g|webp)(\?|$)|placehold\.co/i.test(current.videoUrl) ? (
                <video
                  ref={videoRef}
                  src={current.videoUrl}
                  poster={current.posterUrl ?? undefined}
                  autoPlay={!paused}
                  muted
                  loop
                  playsInline
                  // Crossfade at the loop seam: STANDARD = 5s, HERO = 10s.
                  // The `loop-fade` class + data-tier is consumed by the
                  // `readerVideoLoopFade` keyframes in globals.css. The
                  // hard cut on every loop iteration becomes a soft 0.55→
                  // 1 dip right at the boundary — see brief: ship only if
                  // hard loop looks bad; this is opt-in by className.
                  className={loopFade ? "loop-fade" : undefined}
                  data-tier={current.motionTier === "HERO" ? "HERO" : "STANDARD"}
                  style={lensEnabled ? { transform: "scale(1.6)", transformOrigin: "center" } : undefined}
                />
              ) : current.posterUrl && !/placehold\.co/i.test(current.posterUrl) ? (
                <img
                  src={current.posterUrl}
                  alt=""
                  className={`video-poster${paused || motionScale < 0.4 ? "" : " ken-burns"}`}
                />
              ) : (
                <div className="video-empty">
                  <span>Animation coming soon</span>
                </div>
              )}
            </motion.div>
            {fullscreenOverlay}
          </article>
        )}
      </div>

      {isFlipping && (
        <motion.div
          className="flip-pane flipping"
          aria-hidden
          initial={{ rotateY: flippingDirection === "next" ? 0 : -180 }}
          animate={{ rotateY: flippingDirection === "next" ? -180 : 0 }}
          transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
          style={{ background: `linear-gradient(135deg, ${accent}, #080C14)` }}
        />
      )}

      <button
        type="button"
        aria-label="Previous page"
        onClick={flipPrev}
        className="stage-arrow left"
        disabled={pageIndex === 0}
      >
        <svg viewBox="0 0 24 24" aria-hidden><path d="M15.5 5.5 9 12l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button
        type="button"
        aria-label="Next page"
        onClick={flipNext}
        className="stage-arrow right"
        disabled={pageIndex >= pages.length - 1}
      >
        <svg viewBox="0 0 24 24" aria-hidden><path d="M8.5 5.5 15 12l-6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}