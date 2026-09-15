/**
 * AnimBook TV — Worlds carousel.
 */
import { useEffect, useState } from "react";
import { api } from "./api";
import { useFocusGroup } from "./useFocus";

interface Props {
  onBack(): void;
}

export function WorldsView({ onBack }: Props) {
  const [items, setItems] = useState<{ id: string; slug: string; name: string; synopsis: string; accentColor: string }[]>([]);
  const { containerRef } = useFocusGroup(".focusable");

  useEffect(() => {
    api.listWorlds().then((r) => setItems(r.items ?? [])).catch(() => undefined);
  }, []);

  return (
    <div ref={containerRef} tabIndex={0} style={{ padding: 48, minHeight: "100vh", outline: "none" }}>
      <header style={{ marginBottom: 32 }}>
        <p style={{ fontFamily: "monospace", letterSpacing: 4, color: "var(--text-muted)", textTransform: "uppercase", margin: 0 }}>
          AnimBook next-gen
        </p>
        <h1 style={{ fontSize: 72, margin: "8px 0 0", letterSpacing: -1 }}>Worlds</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 22, maxWidth: 1200, marginTop: 16 }}>
          Shared-character universes. The same characters, the same style — different nights.
        </p>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 24 }}>
        {items.map((world) => (
          <article
            key={world.id}
            className="focusable"
            tabIndex={0}
            style={{
              padding: 24,
              borderRadius: 20,
              background: "var(--surface)",
              border: `2px solid ${world.accentColor}`,
              color: "var(--text)"
            }}
          >
            <p style={{ fontFamily: "monospace", color: world.accentColor, letterSpacing: 4, textTransform: "uppercase", margin: 0 }}>
              {world.name}
            </p>
            <p style={{ fontSize: 28, margin: "8px 0 12px" }}>An AnimBook universe</p>
            <p style={{ color: "var(--text-muted)", fontSize: 20, margin: 0 }}>{world.synopsis}</p>
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