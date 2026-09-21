import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageRecord } from "@/lib/api";
import { narrationUrl } from "@/lib/voices";
import { weightWords, findWordAt, type TimedWord } from "@/lib/homepage/wordWeights";
import {
  ariaLabelFor,
  iconFor,
  transition,
  INITIAL_STATE,
  type PlayerState
} from "@/lib/homepage/narrationPlayer";
import { shouldAutoplayVideo } from "@/lib/homepage/motionGuard";

interface Props {
  /** Featured page. The card renders the page's still (or clip) in the
   *  scene area, and uses textExcerpt as the narration script. */
  page: PageRecord | null;
  /** The book's own narrator voice id (from /api/narration/voices). */
  defaultVoiceId: string | null;
  /** True when the user is signed in — narration endpoint is auth-gated. */
  signedIn: boolean;
}

const FEATURED_TITLE = "Lagos Nights · The Lagoon";

/**
 * LivingCard — clip / still + narration panel with word highlight.
 *
 *  - Scene: video (when the page has a videoUrl) or the still poster.
 *  - Narration: gold play/pause button, caption, the quote split into
 *    timed word spans. Highlight is driven by `audio.currentTime /
 *    audio.duration` against the word-weighted timing.
 *  - Narration is opt-in: never autoplays. The play button only fetches
 *    the audio URL on click.
 *  - When signed out, the play button is hidden — narration is auth-gated.
 */
export function LivingCard({ page, defaultVoiceId, signedIn }: Props) {
  const sceneRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>(INITIAL_STATE);
  const [currentWord, setCurrentWord] = useState<number>(-1);
  const [progress, setProgress] = useState<number>(0);
  /** Set to the fetched audio URL when the user clicks play. */
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  /** True when the play click is in flight (fetching the narration URL). */
  const [loading, setLoading] = useState(false);

  const text = page?.textExcerpt ?? "";
  const words = useMemo<TimedWord[]>(() => weightWords(text), [text]);
  const autoplayAllowed = useMemo(() => shouldAutoplayVideo(), [page?.id]);

  // Reset highlight whenever the page changes.
  useEffect(() => {
    setCurrentWord(-1);
    setProgress(0);
    setAudioSrc(null);
    setPlayerState(INITIAL_STATE);
    audioRef.current?.pause();
    audioRef.current = null;
  }, [page?.id]);

  const onTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration === 0) return;
    const fraction = audio.currentTime / audio.duration;
    setProgress(Math.max(0, Math.min(1, fraction)));
    setCurrentWord(findWordAt(words, fraction));
  }, [words]);

  const onEnded = useCallback(() => {
    setPlayerState((s) => transition(s, { type: "END" }));
  }, []);

  async function handlePlayClick() {
    if (!page || !defaultVoiceId || !signedIn) return;
    if (playerState === "playing") {
      audioRef.current?.pause();
      setPlayerState((s) => transition(s, { type: "PAUSE" }));
      return;
    }
    setLoading(true);
    try {
      const url = await narrationUrl(page.id, defaultVoiceId);
      if (!url) {
        // Brief says hide the button if narration is unavailable. The
        // parent will rerender without us when signedIn flips, but for
        // a runtime failure we collapse into the static-quote UI.
        setPlayerState(INITIAL_STATE);
        return;
      }
      setAudioSrc(url);
    } finally {
      setLoading(false);
    }
  }

  // When audioSrc flips, attach it to the <audio> element and play.
  useEffect(() => {
    if (!audioSrc) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = audioSrc;
    audio.load();
    audio.play().then(() => {
      setPlayerState((s) => transition(s, { type: "PLAY" }));
    }).catch(() => {
      // Browser blocked autoplay even after a click. Very rare; reset.
      setPlayerState(INITIAL_STATE);
    });
  }, [audioSrc]);

  const canNarrate = signedIn && Boolean(page && defaultVoiceId);

  // Build the quote DOM with timed word spans. Words get one of four
  // classes — `w`, `w done`, `w now`, `w dim` — based on the player's
  // current index. The brief specifies the colors via CSS.
  const quoteContent = words.length === 0
    ? <span className="home-w">{(text || "").slice(0, 110)}{(text.length > 110 ? "…" : "")}</span>
    : (
      <>
        {words.map((w, i) => {
          const cls = i < currentWord ? "home-w done"
            : i === currentWord ? "home-w now"
            : i > currentWord ? "home-w dim"
            : "home-w";
          return (
            <span key={`${w.word}-${i}`} className={cls} aria-hidden>
              {w.word}
              {i < words.length - 1 ? "\u00A0" : ""}
            </span>
          );
        })}
      </>
    );

  return (
    <div className="home-living">
      <div className="home-scene">
        {page?.videoUrl ? (
          <video
            ref={sceneRef}
            className="home-pan"
            src={page.videoUrl}
            poster={page.posterUrl ?? undefined}
            muted
            loop
            playsInline
            autoPlay={autoplayAllowed}
            preload={autoplayAllowed ? "metadata" : "none"}
            aria-label={`Scene from ${FEATURED_TITLE}`}
          />
        ) : (
          page?.posterUrl ? (
            <div
              className="home-pan"
              style={{ backgroundImage: `url(${page.posterUrl})` }}
              role="img"
              aria-label={`Scene from ${FEATURED_TITLE}`}
            />
          ) : (
            <div className="home-pan home-pan-placeholder" role="img" aria-hidden />
          )
        )}
      </div>

      <div className="home-narr">
        {canNarrate ? (
          <button
            type="button"
            className="home-pbtn"
            aria-label={ariaLabelFor(playerState)}
            onClick={handlePlayClick}
            disabled={loading}
          >
            {iconFor(playerState) === "play" ? <PlayIcon /> : <PauseIcon />}
          </button>
        ) : null}
        <div className="home-ntext">
          <div className="home-ntitle">{FEATURED_TITLE}</div>
          <div className="home-quote">{quoteContent}</div>
        </div>
        {/* Hidden audio element — driven by audioSrc state. */}
        <audio
          ref={audioRef}
          onTimeUpdate={onTimeUpdate}
          onEnded={onEnded}
          preload="none"
          aria-hidden
        />
        <div className="home-bar" aria-hidden>
          <i style={{ width: `${(progress * 100).toFixed(1)}%` }} />
        </div>
      </div>
    </div>
  );
}

/* Inline icons so this component stays self-contained. The library
 * brief uses the same path strings. */
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden focusable="false" fill="currentColor">
      <path d="M7 4.6v14.8a.6.6 0 0 0 .9.5l12-7.4a.6.6 0 0 0 0-1L7.9 4.1a.6.6 0 0 0-.9.5z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden focusable="false" fill="currentColor">
      <rect x="6.5" y="4.5" width="4" height="15" rx="1.2" />
      <rect x="13.5" y="4.5" width="4" height="15" rx="1.2" />
    </svg>
  );
}
