/**
 * AnimBook TV — Reader with TTS.
 *
 * Auto-plays narration on enter. Pages auto-advance after the
 * SpeechSynthesis utterance finishes. Big body text, large chapter
 * labels. Two-line footer with "Read aloud" / "Pause" / "Stop" and
 * the page index.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type PageRecord } from "./api";
import { useFocusGroup } from "./useFocus";

interface Props {
  slug: string;
  onBack(): void;
}

export function TvReader({ slug, onBack }: Props) {
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [index, setIndex] = useState(0);
  const [title, setTitle] = useState<string>("");
  const [author, setAuthor] = useState<string>("");
  const [vertical, setVertical] = useState<string>("");
  const [poster, setPoster] = useState<string | null>(null);
  const [status, setStatus] = useState<"stopped" | "reading" | "paused">("stopped");
  const [error, setError] = useState<string | null>(null);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const advanceTimer = useRef<number | null>(null);
  const { containerRef } = useFocusGroup(".focusable");

  useEffect(() => {
    Promise.all([api.getBook(slug), api.getPages(slug)])
      .then(([book, pageRes]) => {
        setTitle(book.title);
        setAuthor(book.author);
        setVertical(book.vertical);
        setPoster(book.coverUrl);
        setPages(pageRes.pages);
      })
      .catch((e) => setError(e.message));
    return () => {
      stop();
    };
  }, [slug]);

  function speak(text: string, onEnd?: () => void): SpeechSynthesisUtterance | null {
    if (!supported) return null;
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.85;
    utt.pitch = 1;
    utt.volume = 1;
    utt.onend = () => {
      onEnd?.();
    };
    utteranceRef.current = utt;
    window.speechSynthesis.speak(utt);
    return utt;
  }

  function stop() {
    if (supported) window.speechSynthesis.cancel();
    utteranceRef.current = null;
    if (advanceTimer.current !== null) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  }

  function readCurrent() {
    const page = pages[index];
    if (!page) return;
    stop();
    setStatus("reading");
    speak(page.textExcerpt, () => {
      if (index < pages.length - 1) {
        advanceTimer.current = window.setTimeout(() => {
          setIndex((idx) => idx + 1);
        }, 700);
      } else {
        setStatus("stopped");
      }
    });
  }

  function pause() {
    if (!supported) return;
    if (status === "reading") {
      window.speechSynthesis.pause();
      setStatus("paused");
    } else if (status === "paused") {
      window.speechSynthesis.resume();
      setStatus("reading");
    }
  }

  function stopAll() {
    stop();
    setStatus("stopped");
  }

  // Auto-start narration on first focus, only once.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStartedRef.current && pages.length > 0 && supported) {
      autoStartedRef.current = true;
      // Wait a tick so the focus group has settled.
      const t = window.setTimeout(() => readCurrent(), 250);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [pages.length]);

  function flip(delta: number) {
    stop();
    setStatus("stopped");
    setIndex((idx) => Math.max(0, Math.min(pages.length - 1, idx + delta)));
  }

  const progress = useMemo(() => `${index + 1} / ${pages.length}`, [index, pages.length]);
  const current = pages[index];

  return (
    <div ref={containerRef} tabIndex={0} style={{ padding: 48, minHeight: "100vh", outline: "none" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24 }}>
        <div>
          <p style={{ fontFamily: "monospace", letterSpacing: 4, color: "var(--gold)", textTransform: "uppercase", margin: 0 }}>
            {vertical} · {author}
          </p>
          <h1 style={{ fontSize: 64, margin: "8px 0 0", letterSpacing: -1 }}>{title}</h1>
        </div>
        <p style={{ fontFamily: "monospace", color: "var(--text-muted)", fontSize: 22, margin: 0 }}>
          page {progress}
        </p>
      </header>

      {error && <p style={{ color: "#aa2020" }}>{error}</p>}

      {current ? (
        <section style={{ display: "grid", gridTemplateColumns: "5fr 7fr", gap: 48, alignItems: "stretch" }}>
          <div
            style={{
              borderRadius: 24,
              overflow: "hidden",
              background: "var(--card)",
              border: "2px solid var(--border)",
              aspectRatio: "4/5"
            }}
          >
            {current.posterUrl || poster ? (
              <img src={current.posterUrl ?? poster ?? ""} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-muted)" }}>{current.chapter}</div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <p style={{ fontFamily: "monospace", letterSpacing: 4, color: "var(--text-muted)", textTransform: "uppercase", margin: 0 }}>
              {current.chapter}
            </p>
            <p
              style={{
                fontSize: 52,
                lineHeight: 1.45,
                flex: 1,
                margin: "16px 0 24px",
                maxWidth: 1100,
                color: status === "paused" ? "var(--text-muted)" : "var(--text)"
              }}
            >
              {current.textExcerpt}
            </p>
            <nav style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
              <button className="focusable" onClick={onBack} style={navBtn}>
                ← Library
              </button>
              <button className="focusable" disabled={index === 0} onClick={() => flip(-1)} style={navBtn}>
                ‹ Prev
              </button>
              <button className="focusable" disabled={!supported} onClick={readCurrent} style={navBtn}>
                {status === "stopped" ? "Read aloud" : "Re-read"}
              </button>
              <button className="focusable" disabled={!supported || status === "stopped"} onClick={pause} style={navBtn}>
                {status === "paused" ? "Resume" : "Pause"}
              </button>
              <button className="focusable" disabled={status === "stopped"} onClick={stopAll} style={navBtn}>
                Stop
              </button>
              <button className="focusable" disabled={index >= pages.length - 1} onClick={() => flip(1)} style={navBtn}>
                Next ›
              </button>
            </nav>
            <p style={{ fontFamily: "monospace", color: "var(--text-muted)", fontSize: 14, marginTop: 18, letterSpacing: 2, textTransform: "uppercase" }}>
              status: {status} · speech: {supported ? "available" : "unavailable"}
            </p>
          </div>
        </section>
      ) : (
        <p>Loading…</p>
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = {
  padding: "20px 28px",
  borderRadius: 16,
  background: "var(--surface)",
  border: "2px solid var(--border)",
  color: "var(--text)",
  fontSize: 22,
  fontFamily: "ui-monospace, monospace",
  letterSpacing: 1.4,
  textTransform: "uppercase"
};