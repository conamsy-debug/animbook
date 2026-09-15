/**
 * AnimBook TV — Reader.
 *
 * Full-screen reader with a left-side poster and right-side manuscript text.
 * ArrowRight advances a page; ArrowLeft returns. Pressing Enter on the
 * "Read aloud" tile invokes the browser SpeechSynthesis API for narration.
 */
import { useEffect, useMemo, useState } from "react";
import { api, type PageRecord } from "./api";
import { useFocusGroup } from "./useFocus";

interface Props {
  slug: string;
  onBack(): void;
}

export function ReaderView({ slug, onBack }: Props) {
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [index, setIndex] = useState(0);
  const [title, setTitle] = useState<string>("");
  const [author, setAuthor] = useState<string>("");
  const [vertical, setVertical] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    Promise.all([api.getBook(slug), api.getPages(slug)])
      .then(([book, pageRes]) => {
        setTitle(book.title);
        setAuthor(book.author);
        setVertical(book.vertical);
        setPages(pageRes.pages);
      })
      .catch((e) => setError(e.message));
  }, [slug]);

  const { containerRef } = useFocusGroup(".focusable");
  const current = pages[index];

  const narrationSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  function flip(delta: number) {
    setReading(false);
    window.speechSynthesis?.cancel();
    setIndex((idx) => Math.max(0, Math.min(pages.length - 1, idx + delta)));
  }

  function toggleRead() {
    if (!current || !narrationSupported) return;
    if (reading) {
      window.speechSynthesis.cancel();
      setReading(false);
      return;
    }
    const utt = new SpeechSynthesisUtterance(current.textExcerpt);
    utt.rate = 0.85;
    utt.pitch = 1;
    utt.onend = () => setReading(false);
    window.speechSynthesis.speak(utt);
    setReading(true);
  }

  const progress = useMemo(() => `${index + 1} / ${pages.length}`, [index, pages.length]);

  return (
    <div ref={containerRef} tabIndex={0} style={{ padding: 48, minHeight: "100vh", outline: "none" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24 }}>
        <div>
          <p style={{ fontFamily: "monospace", letterSpacing: 4, color: verticalAccent(vertical), textTransform: "uppercase", margin: 0 }}>
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
          <div style={{ borderRadius: 24, overflow: "hidden", background: "var(--card)", border: "2px solid var(--border)", aspectRatio: "4/5" }}>
            {current.posterUrl ? (
              <img src={current.posterUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-muted)" }}>{current.chapter}</div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <p style={{ fontFamily: "monospace", letterSpacing: 4, color: "var(--text-muted)", textTransform: "uppercase", margin: 0 }}>
              {current.chapter}
            </p>
            <p style={{ fontSize: 42, lineHeight: 1.45, flex: 1, margin: "16px 0 24px", maxWidth: 900 }}>
              {current.textExcerpt}
            </p>
            <nav style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
              <button className="focusable" onClick={onBack} style={navBtn}>
                ← Library
              </button>
              <button className="focusable" disabled={index === 0} onClick={() => flip(-1)} style={navBtn}>
                ‹ Prev
              </button>
              <button className="focusable" onClick={toggleRead} disabled={!narrationSupported} style={navBtn}>
                {reading ? "Stop" : "Read aloud"}
              </button>
              <button className="focusable" disabled={index >= pages.length - 1} onClick={() => flip(1)} style={navBtn}>
                Next ›
              </button>
            </nav>
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

function verticalAccent(v: string): string {
  switch (v) {
    case "CONSUMER":
      return "#1b6b8a";
    case "KIDS":
      return "#d9872a";
    case "EDU":
      return "#1a6b3c";
    case "FAITH":
      return "#6b2d8b";
    case "VERSE":
      return "#9d4c73";
    case "WELLNESS":
      return "#3f8172";
    case "TRAVEL":
      return "#14818e";
    case "ORIGINALS":
      return "#c49a1c";
    default:
      return "#1b6b8a";
  }
}