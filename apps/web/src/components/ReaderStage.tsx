import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
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

export function ReaderStage({ book, pages, bedtime = false, lensEnabled = false, onWordTap, paletteHint = "default", motionScale = 1, fontSize = 18, paused = false }: Props) {
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
    <div className={`reader-stage mode-${mode.toLowerCase()}`} style={{ ["--accent-page" as string]: bannerAccent }}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={current.id}
          className="spread"
          initial={{ opacity: 0, rotateY: flippingDirection === "next" ? -8 * motionScale : 8 * motionScale }}
          animate={{ opacity: 1, rotateY: 0 }}
          exit={{ opacity: 0, rotateY: flippingDirection === "next" ? 8 * motionScale : -8 * motionScale }}
          transition={{ duration: bedtime ? 0.8 : 0.5, ease: [0.34, 1.56, 0.64, 1] }}
          onAnimationComplete={finishFlip}
          style={{ transformStyle: "preserve-3d" }}
        >
          {mode !== "WATCH" && (
            <article className="page text">
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
            </article>
          )}
          {mode !== "READ" && (
            <article className="page video" aria-label={`Page ${current.pageNum} animation`}>
              {current.videoUrl && !/\.(png|jpe?g|webp)(\?|$)|placehold\.co/i.test(current.videoUrl) ? (
                <video
                  ref={videoRef}
                  src={current.videoUrl}
                  poster={current.posterUrl ?? undefined}
                  autoPlay={!paused}
                  muted
                  loop
                  playsInline
                  style={lensEnabled ? { transform: "scale(1.6)", transformOrigin: "center" } : undefined}
                />
              ) : current.posterUrl || current.videoUrl ? (
                <img src={current.posterUrl ?? current.videoUrl ?? ""} alt="" className="video-poster" />
              ) : (
                <div className="video-empty">Animation coming soon</div>
              )}
            </article>
          )}
        </motion.div>
      </AnimatePresence>

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