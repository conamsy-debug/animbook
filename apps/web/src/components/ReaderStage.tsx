import { useEffect, useMemo } from "react";
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

export function ReaderStage({ book, pages, bedtime = false, lensEnabled = false, onWordTap, paletteHint = "default", motionScale = 1, fontSize = 18 }: Props) {
  const { pageIndex, mode, isFlipping, flippingDirection, setBook, flipNext, flipPrev, finishFlip } = useReaderStore();

  useEffect(() => {
    setBook(book, pages);
  }, [book, pages, setBook]);

  const current = pages[pageIndex];
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
    <div className="reader-stage" style={{ borderColor: bannerAccent }}>
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
              <div className="label" style={{ color: bannerAccent }}>Page {current.pageNum} of {pages.length}</div>
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
              <div className="scene-meta">
                {current.emotionalRegister && <span className="pill">{current.emotionalRegister}</span>}
                {current.cameraAngle && <span className="pill">{current.cameraAngle}</span>}
                {current.sceneType && <span className="pill">{current.sceneType}</span>}
              </div>
            </article>
          )}
          {mode !== "READ" && (
            <article className="page video" aria-label={`Page ${current.pageNum} animation`}>
              {current.videoUrl ? (
                <video
                  src={current.videoUrl}
                  poster={current.posterUrl ?? undefined}
                  autoPlay
                  muted
                  loop
                  playsInline
                  style={lensEnabled ? { transform: "scale(1.6)", transformOrigin: "center" } : undefined}
                />
              ) : (
                <div className="video-empty">Animation pending</div>
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
        className="btn ghost"
        style={{ position: "absolute", top: "50%", left: 8, transform: "translateY(-50%)", borderRadius: "50%", width: 40, height: 40, padding: 0 }}
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Next page"
        onClick={flipNext}
        className="btn ghost"
        style={{ position: "absolute", top: "50%", right: 8, transform: "translateY(-50%)", borderRadius: "50%", width: 40, height: 40, padding: 0 }}
      >
        ›
      </button>
    </div>
  );
}