/**
 * AnimBook TV — Dream log overview.
 */
import { useEffect, useState } from "react";
import { api } from "./api";
import { useFocusGroup } from "./useFocus";

interface Props {
  onBack(): void;
}

export function DreamView({ onBack }: Props) {
  const [items, setItems] = useState<{ id: string; bookId: string; startedAt: string; ambientTrack: string; pagesRead: number; fellAsleepAt: string | null }[]>([]);
  const { containerRef } = useFocusGroup(".focusable");

  useEffect(() => {
    api.dreamSessions().then((r) => setItems(r.items ?? [])).catch(() => undefined);
  }, []);

  return (
    <div ref={containerRef} tabIndex={0} style={{ padding: 48, minHeight: "100vh", outline: "none" }}>
      <header style={{ marginBottom: 32 }}>
        <p style={{ fontFamily: "monospace", letterSpacing: 4, color: "#3f8172", textTransform: "uppercase", margin: 0 }}>
          AnimBook DREAM
        </p>
        <h1 style={{ fontSize: 72, margin: "8px 0 0", letterSpacing: -1 }}>The drift log</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 22, maxWidth: 1200, marginTop: 16 }}>
          The WELLNESS sleep-mode sessions you've taken. The Reader drops to a softer palette, slow narration, and an ambient track.
        </p>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 20 }}>
        {items.map((s) => (
          <article
            key={s.id}
            className="focusable"
            tabIndex={0}
            style={{
              padding: 20,
              borderRadius: 18,
              background: "var(--surface)",
              border: "2px solid var(--border)"
            }}
          >
            <p style={{ fontFamily: "monospace", color: "#3f8172", letterSpacing: 3, textTransform: "uppercase", margin: 0 }}>
              {s.ambientTrack.replace("_", " ")}
            </p>
            <p style={{ fontSize: 26, margin: "8px 0" }}>{s.bookId}</p>
            <p style={{ color: "var(--text-muted)", fontSize: 18, margin: 0 }}>
              pages read: {s.pagesRead} · {new Date(s.startedAt).toLocaleString()}
            </p>
            {s.fellAsleepAt && (
              <p style={{ fontFamily: "monospace", color: "#3f8172", letterSpacing: 2, textTransform: "uppercase", marginTop: 8, fontSize: 14 }}>
                Fell asleep at {new Date(s.fellAsleepAt).toLocaleTimeString()}
              </p>
            )}
          </article>
        ))}
      </section>

      <nav style={{ marginTop: 48 }}>
        <button className="focusable" onClick={onBack} style={backBtn}>
          ← Library
        </button>
      </nav>
    </div>
  );
}

const backBtn: React.CSSProperties = {
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