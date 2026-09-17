import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { ReaderStage, READER_ASPECTS, type ReaderAspect } from "@/components/ReaderStage";
import { ApiError } from "@/lib/api";
import { BOOK_VOICE, VOICE_KEY, loadVoices, voiceErrorMessage, type VoiceOption } from "@/lib/voices";
import { ReaderControls } from "@/components/ReaderControls";
import { CheckpointOverlay } from "@/components/CheckpointOverlay";
import { BedtimeStylesheet, BedtimeToggle } from "@/components/BedtimeToggle";
import { AchievementToasts, type Achievement } from "@/components/AchievementToasts";
import { OracleChoices } from "@/components/OracleChoices";
import { TranslationPopover } from "@/components/TranslationPopover";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { LoadingState, EmptyState } from "@/components/States";
import { apiFetch, type BookSummary, type PageRecord } from "@/lib/api";
import { useLibraryStore, useReaderStore, useToastStore } from "@/lib/store";
import { stopSpeaking } from "@/lib/speech";
import { useNarration } from "@/lib/useNarration";

interface MemoryProfile {
  palette: string;
  pacing: string;
  cameraStyle: string;
  narrationSpeed: number;
  fontSize: number;
  motionLevel: number;
  lensEnabled: boolean;
  echoEnabled: boolean;
}

interface DreamProfile {
  palette: string;
  pacing: string;
  cameraStyle: string;
  narrationSpeed: number;
  fontSize: number;
  motionLevel: number;
  flipDurationMs: number;
  dimScreen: boolean;
  ambientTrack: string;
  caption: string;
}

export default function ReaderPage() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : null;
  const isProjection = typeof router.query.projection === "string";
  const [book, setBook] = useState<BookSummary | null>(null);
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [checkpointDismissed, setCheckpointDismissed] = useState<Record<string, boolean>>({});
  const [bedtime, setBedtime] = useState(false);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [memory, setMemory] = useState<MemoryProfile | null>(null);
  const [dreamProfile, setDreamProfile] = useState<DreamProfile | null>(null);
  const [dreamActive, setDreamActive] = useState(false);
  const [dreamSessionId, setDreamSessionId] = useState<string | null>(null);
  const [oracleOpen, setOracleOpen] = useState(false);
  const [translationWord, setTranslationWord] = useState<string | null>(null);
  const { pageIndex, flipNext, flipPrev } = useReaderStore();
  // Select pieces, not the whole store: depending on the store object made the
  // load effect re-run after every library update, reloading the book and
  // resetting the reader to page 1.
  const hydrateLibrary = useLibraryStore((s) => s.hydrate);
  const libraryEntries = useLibraryStore((s) => s.entries);
  const toast = useToastStore((s) => s.push);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      try {
        const [bookRes, pagesRes, memRes, dreamRes] = await Promise.all([
          apiFetch<BookSummary>(`/api/books/${encodeURIComponent(id!)}`),
          apiFetch<{ pages: PageRecord[] }>(`/api/books/${encodeURIComponent(id!)}/pages`),
          apiFetch<{ profile: MemoryProfile }>("/api/memory/settings").catch(() => null),
          apiFetch<{ active: boolean; profile: DreamProfile }>(`/api/dream/profile/${encodeURIComponent(id!)}`).catch(() => null)
        ]);
        if (cancelled) return;
        setBook(bookRes);
        setPages(pagesRes.pages);
        if (memRes) setMemory(memRes.profile);
        if (dreamRes && dreamRes.active && dreamRes.profile) {
          setDreamProfile(dreamRes.profile);
          setDreamActive(true);
        }
        setLoading(false);
        try {
          const lib = await apiFetch<{ items: { bookId: string; progressPage: number; mode: string; lastRead: string; completed: boolean; id: string }[] }>("/api/library");
          hydrateLibrary(
            lib.items.map((e) => ({
              id: e.id,
              bookId: e.bookId,
              progressPage: e.progressPage,
              mode: e.mode as "WATCH" | "BOTH" | "READ",
              completed: e.completed,
              lastRead: e.lastRead,
              book: bookRes
            }))
          );
        } catch {
          // Library hydration is best-effort.
        }
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
      stopSpeaking();
    };
  }, [id, hydrateLibrary]);

  // Open a DREAM session once the book + profile are settled.
  useEffect(() => {
    if (!dreamActive || !book || dreamSessionId) return;
    if (book.vertical !== "WELLNESS") return;
    let cancelled = false;
    (async () => {
      try {
        const opened = await apiFetch<{ session: { id: string } }>("/api/dream/sessions", {
          method: "POST",
          json: { bookId: book.slug, ambientTrack: dreamProfile?.ambientTrack ?? "ocean_waves" }
        });
        if (!cancelled && opened.session?.id) {
          setDreamSessionId(opened.session.id);
          toast(`DREAM mode on · ${dreamProfile?.ambientTrack?.replace("_", " ") ?? "ambient"}`);
        }
      } catch {
        // DREAM is optional; the UI still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dreamActive, book, dreamSessionId, dreamProfile, toast]);

  // Close the DREAM session on unmount.
  useEffect(() => {
    return () => {
      if (!dreamSessionId) return;
      try {
        navigator.sendBeacon?.(
          `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/dream/sessions/${dreamSessionId}/end`,
          new Blob([JSON.stringify({ reason: "reader_left", fellAsleep: false })], { type: "application/json" })
        );
      } catch {
        // best effort
      }
    };
  }, [dreamSessionId]);

  // Push the current page index into the DREAM session every 4 pages.
  useEffect(() => {
    if (!dreamSessionId) return;
    if (pageIndex === 0) return;
    if (pageIndex % 4 !== 0) return;
    void apiFetch(`/api/dream/sessions/${dreamSessionId}`, {
      method: "PUT",
      json: { pagesRead: pageIndex + 1 }
    }).catch(() => undefined);
  }, [pageIndex, dreamSessionId]);

  useEffect(() => {
    if (!book || !pages.length) return;
    const page = pages[pageIndex];
    if (!page) return;
    if (book.vertical !== "EDU") return;
    if (isProjection) return;
    if (checkpointDismissed[page.id]) return;
    const handle = window.setTimeout(() => setCheckpointOpen(true), 1200);
    return () => window.clearTimeout(handle);
  }, [pageIndex, book, pages, checkpointDismissed, isProjection]);

  useEffect(() => {
    if (!memory?.echoEnabled) return;
    if (typeof window === "undefined") return;
    if (!("vibrate" in navigator)) return;
    const t = window.setTimeout(() => {
      try {
        navigator.vibrate?.(16);
      } catch {
        // ignore
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [pageIndex, memory?.echoEnabled]);

  useEffect(() => {
    if (!book || !pages.length) return;
    const timer = window.setTimeout(() => {
      apiFetch(`/api/library/${book.slug}/progress`, {
        method: "PUT",
        json: { progressPage: pageIndex + 1, mode: bedtime && book.vertical === "KIDS" ? "READ" : undefined },
        demoUserId: undefined
      })
        .then((res) => {
          const newAch = (res as { newAchievements?: { code: string; title: string }[] }).newAchievements;
          if (Array.isArray(newAch) && newAch.length > 0) {
            setAchievements((prev) => [
              ...prev,
              ...newAch.map((entry) => ({
                code: entry.code,
                title: entry.title,
                description: entry.code === "first_flip"
                  ? "You flipped your first AnimPage. The world is awake."
                  : entry.code === "book_completed"
                  ? "You read an AnimBook all the way to the end."
                  : entry.code === "three_in_seven"
                  ? "Three AnimBooks in seven days. The medium loves you back."
                  : entry.code === "bedtime_streak"
                  ? "Five bedtime-mode sessions. Sweet dreams, official."
                  : "Achievement unlocked."
              }))
            ]);
          }
        })
        .catch(() => {
          /* swallow progress-write failures */
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [pageIndex, book, pages.length, bedtime]);

  const currentPage = useMemo(() => pages[pageIndex] ?? null, [pages, pageIndex]);

  const narrationRate =
    (dreamActive ? (dreamProfile?.narrationSpeed ?? 0.7) : (memory?.narrationSpeed ?? 1)) *
    (bedtime && book?.vertical === "KIDS" ? 0.78 : 1);
  // Screen size (frame shape) — remembered per browser.
  const [aspect, setAspect] = useState<ReaderAspect>("16:9");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("animbook:aspect");
      if (saved && READER_ASPECTS.some((a) => a.id === saved)) setAspect(saved as ReaderAspect);
    } catch {
      // storage unavailable
    }
  }, []);
  function changeAspect(next: ReaderAspect) {
    setAspect(next);
    try {
      window.localStorage.setItem("animbook:aspect", next);
    } catch {
      // ignore
    }
  }

  // Full screen: the whole reader (video, text and player) when the browser
  // allows it; otherwise (iPhone Safari) the video's own full-screen player.
  const readerRef = useRef<HTMLElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const el = readerRef.current;
    if (el && document.fullscreenEnabled && el.requestFullscreen) {
      void el.requestFullscreen().catch(() => undefined);
      return;
    }
    const video = el?.querySelector("video") as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    video?.webkitEnterFullscreen?.();
  }

  // Auto-turn: when narration finishes a page, move on after a short pause.
  const [autoFlip, setAutoFlip] = useState(true);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("animbook:autoflip");
      if (saved !== null) setAutoFlip(saved === "1");
    } catch {
      // storage unavailable
    }
  }, []);
  function toggleAutoFlip() {
    setAutoFlip((on) => {
      try {
        window.localStorage.setItem("animbook:autoflip", on ? "0" : "1");
      } catch {
        // ignore
      }
      return !on;
    });
  }
  const autoFlipTimer = useRef<number | null>(null);
  const flipStateRef = useRef({ autoFlip, pageIndex, total: pages.length });
  flipStateRef.current = { autoFlip, pageIndex, total: pages.length };
  // Narrator choice — "book" is the book's own recording; others are recorded on demand.
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voice, setVoice] = useState<string>(BOOK_VOICE);
  useEffect(() => {
    loadVoices()
      .then((r) => {
        if (!r.available) return;
        setVoices(r.voices);
        try {
          const saved = window.localStorage.getItem(VOICE_KEY);
          if (saved && r.voices.some((v) => v.id === saved)) setVoice(saved);
        } catch {
          // storage unavailable
        }
      })
      .catch(() => setVoices([]));
  }, []);
  function changeVoice(next: string) {
    setVoice(next);
    try {
      window.localStorage.setItem(VOICE_KEY, next);
    } catch {
      // ignore
    }
  }
  function handleVoiceError(err: unknown) {
    toast(voiceErrorMessage(err));
    if (err instanceof ApiError && (err.status === 401 || err.status === 429)) changeVoice(BOOK_VOICE);
  }

  const narration = useNarration(currentPage, narrationRate, {
    voice,
    nextPage: pages[pageIndex + 1] ?? null,
    onVoiceError: handleVoiceError,
    onFinished: () => {
      const { autoFlip: on, pageIndex: idx, total } = flipStateRef.current;
      if (!on) return;
      if (autoFlipTimer.current) window.clearTimeout(autoFlipTimer.current);
      if (idx >= total - 1) {
        narrationRef.current?.pause();
        toast("The end");
        return;
      }
      autoFlipTimer.current = window.setTimeout(() => {
        autoFlipTimer.current = null;
        flipNext();
      }, 1400);
    }
  });
  const narrationRef = useRef(narration);
  narrationRef.current = narration;
  useEffect(() => () => {
    if (autoFlipTimer.current) window.clearTimeout(autoFlipTimer.current);
  }, []);
  const [userPaused, setUserPaused] = useState(false);

  function playNarration() {
    setUserPaused(false);
    narration.play();
  }

  function pauseNarration() {
    if (autoFlipTimer.current) {
      window.clearTimeout(autoFlipTimer.current);
      autoFlipTimer.current = null;
    }
    setUserPaused(true);
    narration.pause();
  }

  function handleWordTap(word: string) {
    if (typeof window === "undefined") return;
    if (window.getSelection?.()?.toString()) return;
    setTranslationWord(word.replace(/[^a-zA-Z’'-]/g, "").toLowerCase());
  }

  if (loading) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <LoadingState message="Opening the AnimBook…" />
        </main>
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <EmptyState
            title="Could not open this AnimBook"
            message={error ?? "The book record is missing or unreachable."}
            cta={{ href: "/", label: "Back to library" }}
          />
        </main>
      </div>
    );
  }

  return (
    <div
      className="app-shell"
      style={{
        background: bedtime || memory?.palette === "cool" || dreamActive ? "#0A0710" : undefined,
        opacity: dreamActive ? 0.92 : 1
      }}
    >
      <Topbar />
      <BedtimeStylesheet enabled={bedtime || dreamActive} />
      <main
        className={`reader${fullscreen ? " is-fullscreen" : ""}`}
        ref={readerRef}
        style={isProjection ? { minHeight: "100vh" } : undefined}
      >
        {dreamActive && (
          <div className="dream-banner" role="status" aria-live="polite">
            <span className="dream-dot" aria-hidden />
            <span className="dream-text">{dreamProfile?.caption ?? "DREAM mode"}</span>
            <span className="dream-track">{dreamProfile?.ambientTrack?.replace("_", " ")}</span>
          </div>
        )}
        {book.vertical === "KIDS" && !dreamActive && (
          <div style={{ position: "absolute", top: 12, right: 12, zIndex: 6 }}>
            <BedtimeToggle enabled={bedtime} onToggle={setBedtime} />
          </div>
        )}
        {book.vertical === "VERSE" && (
          <div style={{ position: "absolute", top: 12, right: 12, zIndex: 6 }}>
            <button type="button" className="btn" onClick={() => setOracleOpen(true)}>
              Ask the Oracle
            </button>
          </div>
        )}
        <ErrorBoundary
          fallback={(err, reset) => (
            <ErrorState error={err} onRetry={reset} title="The page wouldn’t render" compact />
          )}
        >
          <ReaderStage
            book={book}
            pages={pages}
            bedtime={bedtime || dreamActive}
            lensEnabled={memory?.lensEnabled ?? false}
            onWordTap={handleWordTap}
            paletteHint={dreamActive ? (dreamProfile?.palette ?? "cool") : (memory?.palette ?? "default")}
            motionScale={dreamActive ? (dreamProfile?.motionLevel ?? 0.4) : (memory?.motionLevel ?? 1)}
            fontSize={dreamActive ? (dreamProfile?.fontSize ?? 22) : (memory?.fontSize ?? 18)}
            paused={userPaused}
            aspect={aspect}
          />
          <ReaderControls narration={narration} onPlay={playNarration} onPause={pauseNarration} onNext={flipNext} onPrev={flipPrev} autoFlip={autoFlip}
            onToggleAutoFlip={toggleAutoFlip}
            aspect={aspect}
            onAspectChange={changeAspect}
            fullscreen={fullscreen}
            onToggleFullscreen={toggleFullscreen}
            voices={voices}
            voice={voice}
            onVoiceChange={changeVoice}
            onVoiceNotice={(m) => toast(m)}
          />
        </ErrorBoundary>
        <AchievementToasts queue={achievements} onConsumed={(idx) => setAchievements((prev) => prev.filter((_, i) => i !== idx))} />
        {checkpointOpen && currentPage && book.vertical === "EDU" && (
          <CheckpointOverlay
            pageId={currentPage.id}
            pageNum={currentPage.pageNum}
            vertical={book.vertical}
            onClose={() => {
              setCheckpointOpen(false);
              setCheckpointDismissed((prev) => ({ ...prev, [currentPage.id]: true }));
            }}
            onResponded={(isCorrect) => toast(isCorrect ? "Nice — checkpoint answered correctly" : "Got it — see the explanation")}
          />
        )}
        {oracleOpen && currentPage && (
          <OracleChoices
            bookId={book.slug}
            rootPage={currentPage.pageNum}
            onClose={() => setOracleOpen(false)}
            onApply={(continuation) => {
              setOracleOpen(false);
              toast(`Oracle continuation: ${continuation.choiceLabel}`);
            }}
          />
        )}
        {translationWord && (
          <TranslationPopover
            word={translationWord}
            sourceLang={book.language}
            targetLang={libraryEntries.find((e) => e.bookId === book.id)?.narrationLanguage ?? "en"}
            bookId={book.slug}
            onClose={() => setTranslationWord(null)}
          />
        )}
      </main>
    </div>
  );
}