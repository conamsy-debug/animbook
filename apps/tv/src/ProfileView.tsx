/**
 * AnimBook TV — Profile / API status.
 */
import { useEffect, useState } from "react";
import { api } from "./api";
import { useFocusGroup } from "./useFocus";

interface Props {
  onBack(): void;
}

export function ProfileView({ onBack }: Props) {
  const [status, setStatus] = useState<string>("…");
  const { containerRef } = useFocusGroup(".focusable");

  useEffect(() => {
    fetch(`${api.base}/api/health`)
      .then((r) => r.json())
      .then((j) => setStatus(`${j.status} · ${j.service}`))
      .catch((e) => setStatus(`offline · ${e.message}`));
  }, []);

  return (
    <div ref={containerRef} tabIndex={0} style={{ padding: 48, minHeight: "100vh", outline: "none" }}>
      <header style={{ marginBottom: 32 }}>
        <p style={{ fontFamily: "monospace", letterSpacing: 4, color: "var(--text-muted)", textTransform: "uppercase", margin: 0 }}>
          AnimBook · profile
        </p>
        <h1 style={{ fontSize: 72, margin: "8px 0 0", letterSpacing: -1 }}>API status</h1>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 20 }}>
        <article className="focusable" tabIndex={0} style={card}>
          <p style={label}>API base</p>
          <p style={value}>{api.base}</p>
        </article>
        <article className="focusable" tabIndex={0} style={card}>
          <p style={label}>Health</p>
          <p style={value}>{status}</p>
        </article>
        <article className="focusable" tabIndex={0} style={card}>
          <p style={label}>14 of 14 next-gen</p>
          <p style={{ ...value, fontSize: 22, lineHeight: 1.4 }}>
            MEMORY · ORACLE · LENS · ECHO · LIVE · LIVE TRANSLATION · DREAM · WORLDS · STAGE · SIGNAL · NETWORK · ARCHIVE · SCHOOL · STUDIO PRO
          </p>
        </article>
      </section>

      <nav style={{ marginTop: 48 }}>
        <button className="focusable" onClick={onBack} style={backBtn}>
          ← Library
        </button>
      </nav>
    </div>
  );
}

const card: React.CSSProperties = {
  padding: 24,
  borderRadius: 18,
  background: "var(--surface)",
  border: "2px solid var(--border)"
};

const label: React.CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: 14,
  letterSpacing: 3,
  textTransform: "uppercase",
  color: "var(--text-muted)",
  margin: 0
};

const value: React.CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: 24,
  color: "var(--text)",
  marginTop: 8
};

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