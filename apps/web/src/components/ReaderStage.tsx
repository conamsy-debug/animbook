import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { motion } from "framer-motion";
import { useReaderStore } from "@/lib/store";
import type { BookSummary, PageRecord, ShotRecord } from "@/lib/api";

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
  /**
   * The narration audio element. When a page has playable shots this is the
   * master clock the shots are cut to.
   */
  narrationClock?: HTMLAudioElement | null;
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

/* --------------------------------------------------------------------- *
 * The shot player
 * --------------------------------------------------------------------- */

/** How long one shot dissolves into the next. */
const SHOT_CROSSFADE_MS = 250;

interface ShotSequenceProps {
  shots: ShotRecord[];
  /**
   * The narration audio element. It is the MASTER CLOCK: the shots are cut
   * to the narration's timeline, so the picture and the words stay together
   * even when the audio is paused, resumed or slightly out of sync with the
   * clips.
   */
  clock: HTMLAudioElement | null;
  paused: boolean;
  playbackRate: number;
  lensEnabled: boolean;
}

/**
 * Play a page's shots in order, cut to the narration.
 *
 * Two stacked video layers: the live shot is on one, the incoming shot is
 * loaded into the other and crossfaded in over 250ms as the narration reaches
 * the next shot's span. Nothing loops - a clip is cut at the end of its span
 * and the last shot holds its final frame until the page turns.
 */
function ShotSequence({ shots, clock, paused, playbackRate, lensEnabled }: ShotSequenceProps) {
  const layerA = useRef<HTMLVideoElement | null>(null);
  const layerB = useRef<HTMLVideoElement | null>(null);
  /** Which layer is currently in front. */
  const [front, setFront] = useState<"A" | "B">("A");
  const frontRef = useRef<"A" | "B">("A");
  /** Index of the shot that is live. */
  const indexRef = useRef(-1);
  /** Guards against starting a second crossfade while one is in flight. */
  const switchingRef = useRef(false);
  /** A local clock for before the narration starts. */
  const localMsRef = useRef(0);
  const lastFrameRef = useRef(0);
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  const clockRef = useRef(clock);
  clockRef.current = clock;

  /** Load a clip into a layer and resolve once it can play. */
  const loadClip = useCallback((el: HTMLVideoElement, shot: ShotRecord): Promise<boolean> => {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        el.removeEventListener("canplay", onCanPlay);
        el.removeEventListener("error", onError);
        resolve(ok);
      };
      const onCanPlay = () => finish(true);
      const onError = () => finish(false);
      el.addEventListener("canplay", onCanPlay);
      el.addEventListener("error", onError);
      if (el.getAttribute("src") !== shot.videoUrl) {
        el.src = shot.videoUrl;
      }
      if (shot.posterUrl) el.poster = shot.posterUrl;
      el.load();
      if (el.readyState >= 3) finish(true);
    });
  }, []);

  /**
   * The narration's position in the page, in milliseconds.
   *
   * Once the narration has started, the audio IS the clock. Before that (the
   * reader has not pressed Play yet) a local clock keeps the page alive so
   * the reader sees motion instead of a frozen first frame.
   */
  const readClockMs = useCallback((): number => {
    const audio = clockRef.current;
    if (audio && audio.readyState >= 2 && (audio.currentTime > 0.05 || !audio.paused)) {
      return audio.currentTime * 1000;
    }
    return localMsRef.current;
  }, []);

  // Start on the first shot when the sequence mounts, and preload the second.
  useEffect(() => {
    const list = shotsRef.current;
    if (!list.length) return;
    let cancelled = false;
    const first = list[0]!;
    const el = layerA.current;
    if (!el) return;
    void (async () => {
      const ok = await loadClip(el, first);
      if (cancelled || !ok) return;
      el.currentTime = 0;
      void el.play().catch(() => undefined);
      indexRef.current = 0;
      const next = list[1];
      const idle = layerB.current;
      if (next && idle) {
        if (idle.getAttribute("src") !== next.videoUrl) idle.src = next.videoUrl;
        if (next.posterUrl) idle.poster = next.posterUrl;
        idle.load();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadClip]);

  // The crossfade loop.
  useEffect(() => {
    let raf = 0;
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      const list = shotsRef.current;
      if (!list.length) return;

      // Advance the local clock.
      if (lastFrameRef.current) {
        localMsRef.current += Math.min(200, ts - lastFrameRef.current);
      }
      lastFrameRef.current = ts;

      const t = readClockMs();
      const live = indexRef.current;
      if (live < 0) return;

      // Which shot should be on screen at this point in the narration?
      let target = 0;
      for (let i = 0; i < list.length; i++) {
        if (t >= list[i]!.narrationStartMs) target = i;
      }

      // The last shot holds its final frame once its span is over.
      const lastShot = list[list.length - 1]!;
      if (live === list.length - 1 && t >= lastShot.narrationEndMs) {
        const el = frontRef.current === "A" ? layerA.current : layerB.current;
        if (el && !el.paused) el.pause();
        return;
      }

      if (target === live || switchingRef.current) return;
      const incoming = list[target]!;
      // Start the dissolve just before the new shot's narration begins.
      if (t < incoming.narrationStartMs - SHOT_CROSSFADE_MS) return;

      switchingRef.current = true;
      const idleLayer: "A" | "B" = frontRef.current === "A" ? "B" : "A";
      const incomingEl = idleLayer === "A" ? layerA.current : layerB.current;
      const outgoingEl = frontRef.current === "A" ? layerA.current : layerB.current;
      if (!incomingEl) {
        switchingRef.current = false;
        return;
      }
      void (async () => {
        const ok = await loadClip(incomingEl, incoming);
        if (!ok) {
          switchingRef.current = false;
          return;
        }
        incomingEl.currentTime = 0;
        void incomingEl.play().catch(() => undefined);
        // The dissolve is a CSS opacity transition on the two layers.
        frontRef.current = idleLayer;
        setFront(idleLayer);
        indexRef.current = target;
        outgoingEl?.pause();
        // Preload the shot after this one so the next dissolve never waits.
        const next = list[target + 1];
        const nextLayer: "A" | "B" = idleLayer === "A" ? "B" : "A";
        const nextEl = nextLayer === "A" ? layerA.current : layerB.current;
        if (next && nextEl) {
          if (nextEl.getAttribute("src") !== next.videoUrl) nextEl.src = next.videoUrl;
          if (next.posterUrl) nextEl.poster = next.posterUrl;
          nextEl.load();
        }
        switchingRef.current = false;
      })();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loadClip, readClockMs]);

  // Pause and resume with the reader.
  useEffect(() => {
    for (const el of [layerA.current, layerB.current]) {
      if (!el) continue;
      if (paused) el.pause();
      else if (indexRef.current >= 0 && el === (frontRef.current === "A" ? layerA.current : layerB.current)) {
        void el.play().catch(() => undefined);
      }
    }
  }, [paused]);

  // Keep both layers on the reader's chosen playback rate.
  useEffect(() => {
    for (const el of [layerA.current, layerB.current]) {
      if (el) el.playbackRate = playbackRate;
    }
  }, [playbackRate, front]);

  const transform = lensEnabled ? { transform: "scale(1.6)", transformOrigin: "center" } : undefined;

  return (
    <>
      <video
        ref={layerA}
        className="shot-layer"
        style={{ opacity: front === "A" ? 1 : 0, ...transform }}
        muted
        playsInline
        preload="auto"
      />
      <video
        ref={layerB}
        className="shot-layer"
        style={{ opacity: front === "B" ? 1 : 0, ...transform }}
        muted
        playsInline
        preload="auto"
      />
    </>
  );
}

/** The shots of a page that are actually playable. */
function playableShots(page: PageRecord | undefined): ShotRecord[] {
  if (!page?.shots?.length) return [];
  return page.shots
    .filter((s) => s.status === "READY" && Boolean(s.videoUrl))
    .sort((a, b) => a.order - b.order);
}

export function ReaderStage({ book, pages, bedtime = false, lensEnabled = false, onWordTap, paletteHint = "default", motionScale = 1, fontSize = 18, paused = false, aspect = "16:9", videoFrameRef, fullscreenOverlay, playbackRate = 1, loopFade = true, narrationClock = null }: Props) {
  const { pageIndex, mode, isFlipping, flippingDirection, setBook, flipNext, flipPrev, finishFlip } = useReaderStore();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setBook(book, pages);
  }, [book, pages, setBook]);

  const current = pages[pageIndex];

  // A page with playable shots is a SEQUENCE. A page without them keeps the
  // single looping clip exactly as it always has.
  const shots = useMemo(() => playableShots(current), [current]);

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
              {shots.length ? (
                <ShotSequence
                  shots={shots}
                  clock={narrationClock}
                  paused={paused}
                  playbackRate={playbackRate}
                  lensEnabled={lensEnabled}
                />
              ) : current.videoUrl && !/\.(png|jpe?g|webp)(\?|$)|placehold\.co/i.test(current.videoUrl) ? (
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

      {isFlipping && (() => {
        // Pick the page that will be revealed when the current page
        // flips off it. For "next" that's pages[pageIndex + 1], for
        // "prev" it's pages[pageIndex - 1].
        const revealed =
          flippingDirection === "next" ? pages[pageIndex + 1] : pages[pageIndex - 1];
        return (
          <>
            {/* Book page flip.
             *
             * 1. Underlay: the page that gets revealed when the current
             *    page turns over. Its poster sits beneath the rotating
             *    pane so the user sees the new page emerge as the old
             *    one curls away — the classic "book opening" beat.
             * 2. Flip-pane: the OLD page, hinged from the spine on the
             *    leading edge (left for "next", right for "prev").
             *    It carries the CURRENT page's poster so the visual
             *    reads as the page itself turning, not a colored card.
             *    A page-curl highlight + edge shadow sells the 3D.
             * 3. Drop-shadow: the cast shadow on the revealed page,
             *    tracked independently so it follows the page, not
             *    the pane's rotation.
             */}
            {revealed && (
              <div
                className={`flip-underlay ${flippingDirection === "prev" ? "from-prev" : "from-next"}`}
                aria-hidden
              >
                {revealed.posterUrl && !/placehold\.co/i.test(revealed.posterUrl) ? (
                  <div
                    className="flip-underlay-poster"
                    style={{ backgroundImage: `url(${revealed.posterUrl})` }}
                  />
                ) : (
                  <div
                    className="flip-underlay-poster flip-underlay-blank"
                    style={{ background: `linear-gradient(135deg, ${accent}22, #050709)` }}
                  />
                )}
                {revealed.textExcerpt && (
                  <div className="flip-underlay-text">
                    <span className="flip-underlay-page">
                      Page {revealed.pageNum}
                    </span>
                  </div>
                )}
              </div>
            )}
            <motion.div
              className={`flip-pane flipping ${flippingDirection === "prev" ? "from-prev" : "from-next"}`}
              aria-hidden
              initial={{
                rotateY: flippingDirection === "next" ? 0 : -180,
                translateZ: 0
              }}
              animate={{
                rotateY: flippingDirection === "next" ? -180 : 0,
                // Hold the lift off the surface across the middle of the
                // flip so the user actually sees the page hovering before
                // it lands — the underlay, spine highlight, and shadow
                // all read better when the lift is sustained, not a
                // brief blip.
                translateZ: [0, 22, 22, 0]
              }}
              transition={{
                duration: 1.6,
                ease: [0.4, 0, 0.2, 1],
                times: [0, 0.35, 0.7, 1]
              }}
              style={{
                backgroundImage: current.posterUrl
                  ? `url(${current.posterUrl})`
                  : undefined,
                backgroundColor: current.posterUrl
                  ? undefined
                  : `linear-gradient(135deg, ${accent} 0%, #0D1420 50%, #050709 100%)`,
                backgroundSize: "cover",
                backgroundPosition: "center"
              }}
            />
            <motion.div
              className="flip-shadow"
              aria-hidden
              initial={{ opacity: 0 }}
              // Same held-peak strategy as the lift: shadow rises, holds
              // across the middle, then falls — so the cast shadow is
              // actually visible while the page is mid-rotation.
              animate={{ opacity: [0, 0.7, 0.7, 0] }}
              transition={{
                duration: 1.6,
                ease: [0.4, 0, 0.2, 1],
                times: [0, 0.35, 0.7, 1]
              }}
              style={{
                background: flippingDirection === "next"
                  ? "linear-gradient(to left, rgba(0,0,0,0.85) 0%, transparent 55%)"
                  : "linear-gradient(to right, rgba(0,0,0,0.85) 0%, transparent 55%)"
              }}
            />
          </>
        );
      })()}

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