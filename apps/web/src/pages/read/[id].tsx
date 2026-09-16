import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { ReaderStage } from "@/components/ReaderStage";
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
import { speakWithBrowser, stopSpeaking } from "@/lib/speech";

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
  const library = useLibraryStore();
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
          library.hydrate(
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
  }, [id, library]);

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

  function playNarration() {
    if (!currentPage) return;
    const baseRate = dreamActive ? (dreamProfile?.narrationSpeed ?? 0.7) : (memory?.narrationSpeed ?? 1);
    const rate = baseRate * (bedtime && book?.vertical === "KIDS" ? 0.78 : 1);
    speakWithBrowser(currentPage.textExcerpt, { voiceId: currentPage.speakerName ?? "narrator", name: currentPage.speakerName ?? "default", rate });
    toast(bedtime ? "Bedtime narration · slow & calm" : dreamActive ? `DREAM narration · ${Math.round(rate * 100)}%` : `Now reading as ${currentPage.speakerName ?? "narrator"}`);
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
      <main className="reader" style={isProjection ? { minHeight: "100vh" } : undefined}>
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
          />
          <ReaderControls onPlayNarration={playNarration} onNext={flipNext} onPrev={flipPrev} />
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
            targetLang={library.entries.find((e) => e.bookId === book.id)?.narrationLanguage ?? "en"}
            bookId={book.slug}
            onClose={() => setTranslationWord(null)}
          />
        )}
      </main>
    </div>
  );
}