/**
 * AnimBook TV — Companion overview.
 *
 * Lists the published AnimBooks and shows each one's companion link
 * (marker hash + NFC tag id). On Apple TV the reader can enter either
 * id with the on-screen keyboard to jump straight to the anchor page.
 */
import { useEffect, useState } from "react";
import { api, type BookSummary } from "./api";
import { useFocusGroup } from "./useFocus";

interface CompanionRow {
  book: BookSummary;
  link: { nfcTagId: string; markerHash: string; anchorPage: number } | null;
}

interface Props {
  onBack(): void;
}

export function CompanionView({ onBack }: Props) {
  const [rows, setRows] = useState<CompanionRow[]>([]);
  const { containerRef } = useFocusGroup(".focusable");

  useEffect(() => {
    (async () => {
      const books = (await api.listBooks()).items ?? [];
      const results: CompanionRow[] = [];
      for (const book of books.slice(0, 10)) {
        try {
          const res = await api.companionForBook(book.slug);
          results.push({ book, link: res.link ?? null });
        } catch {
          results.push({ book, link: null });
        }
      }
      setRows(results);
    })();
  }, []);

  return (
    <div ref={containerRef} tabIndex={0} style={{ padding: 48, minHeight: "100vh", outline: "none" }}>
      <header style={{ marginBottom: 32 }}>
        <p style={{ fontFamily: "monospace", letterSpacing: 4, color: "#3f8172", textTransform: "uppercase", margin: 0 }}>
          AnimBook STUDIO PRO
        </p>
        <h1 style={{ fontSize: 72, margin: "8px 0 0", letterSpacing: -1 }}>Companion</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 22, maxWidth: 1200, marginTop: 16 }}>
          Every AnimBook has an AR marker and an NFC tag id. Print the marker on the cover, tap the tag with your phone, and the book opens on the anchor page.
        </p>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 20 }}>
        {rows.map(({ book, link }) => (
          <article
            key={book.id}
            className="focusable"
            tabIndex={0}
            style={{
              padding: 20,
              borderRadius: 18,
              background: "var(--surface)",
              border: "2px solid var(--border)"
            }}
          >
            <p style={{ fontFamily: "monospace", letterSpacing: 3, textTransform: "uppercase", margin: 0, color: "var(--text-muted)" }}>
              {book.vertical} · {book.author}
            </p>
            <p style={{ fontSize: 30, margin: "8px 0" }}>{book.title}</p>
            {link ? (
              <div style={{ marginTop: 12 }}>
                <p style={{ fontFamily: "monospace", color: "var(--text-muted)", fontSize: 14, letterSpacing: 2, margin: 0 }}>
                  NFC tag
                </p>
                <p style={{ fontFamily: "monospace", color: "#3f8172", fontSize: 22, margin: "4px 0 8px", letterSpacing: 1.4 }}>
                  {link.nfcTagId}
                </p>
                <p style={{ fontFamily: "monospace", color: "var(--text-muted)", fontSize: 14, letterSpacing: 2, margin: 0 }}>
                  Anchor page
                </p>
                <p style={{ fontFamily: "monospace", color: "#3f8172", fontSize: 22, margin: "4px 0" }}>
                  {link.anchorPage}
                </p>
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: 16 }}>No companion link yet.</p>
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