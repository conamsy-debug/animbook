/**
 * AnimBook TV — Library with shelves.
 *
 * Three horizontal shelves:
 *   - Continue Reading   (from /api/library)
 *   - Featured           (the latest published books)
 *   - Worlds             (from /api/worlds)
 *
 * Each shelf is its own focus group so left/right arrows move inside
 * the shelf and up/down jumps between shelves.
 */
import { useEffect, useState } from "react";
import { api, type BookSummary } from "./api";
import { useTvShelfFocus } from "./useTvShelf";

interface LibraryEntry {
  id: string;
  bookId: string;
  book: BookSummary;
}

interface Props {
  onSelect(slug: string): void;
  onJumpDream(): void;
  onJumpCompanion(): void;
  onJumpProfile(): void;
}

export function TvLibrary({ onSelect, onJumpDream, onJumpCompanion, onJumpProfile }: Props) {
  const [all, setAll] = useState<BookSummary[]>([]);
  const [continueReading, setContinueReading] = useState<LibraryEntry[]>([]);
  const [worlds, setWorlds] = useState<{ id: string; slug: string; name: string; synopsis: string; accentColor: string }[]>([]);
  const { containerRef } = useTvShelfFocus();

  useEffect(() => {
    (async () => {
      try {
        const books = (await api.listBooks()).items ?? [];
        setAll(books);
        const lib = await fetch(`${api.base}/api/library`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const entries: LibraryEntry[] = (lib?.items ?? [])
          .map((e: { id: string; bookId: string; book: BookSummary }) => ({ id: e.id, bookId: e.bookId, book: e.book }))
          .filter((e: LibraryEntry) => e.book && (e.book as BookSummary).slug);
        setContinueReading(entries);
        const w = (await api.listWorlds()).items ?? [];
        setWorlds(w);
      } catch {
        setAll([]);
      }
    })();
  }, []);

  const featured = all.slice(0, 6);
  const kids = all.filter((b) => b.vertical === "KIDS").slice(0, 4);
  const wellness = all.filter((b) => b.vertical === "WELLNESS").slice(0, 4);

  return (
    <div ref={containerRef} tabIndex={0} style={{ padding: 48, minHeight: "100vh", outline: "none" }}>
      <header style={{ marginBottom: 28 }}>
        <p style={{ fontFamily: "monospace", letterSpacing: 6, color: "var(--text-muted)", textTransform: "uppercase", margin: 0 }}>
          AnimBook · tv
        </p>
        <h1 style={{ fontSize: 80, margin: "8px 0 0", letterSpacing: -1 }}>The Library</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 22, maxWidth: 1200, marginTop: 12 }}>
          Pick an AnimBook. Use the remote arrows to move the focus ring, press Enter (or the centre button) to open.
        </p>
      </header>

      <nav style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18, marginBottom: 32 }}>
        <button className="focusable" onClick={onJumpDream} style={navTile}>Dream log</button>
        <button className="focusable" onClick={onJumpCompanion} style={navTile}>Companion</button>
        <button className="focusable" onClick={onJumpProfile} style={navTile}>Profile</button>
      </nav>

      {continueReading.length > 0 && (
        <Shelf title="Continue reading">
          {continueReading.map((e) => (
            <BookTile
              key={e.id}
              book={e.book}
              onSelect={() => onSelect(e.book.slug)}
            />
          ))}
        </Shelf>
      )}

      <Shelf title="Featured">
        {featured.map((book) => (
          <BookTile key={book.id} book={book} onSelect={() => onSelect(book.slug)} />
        ))}
      </Shelf>

      {kids.length > 0 && (
        <Shelf title="Kids · bedtime ready">
          {kids.map((book) => (
            <BookTile key={book.id} book={book} onSelect={() => onSelect(book.slug)} />
          ))}
        </Shelf>
      )}

      {wellness.length > 0 && (
        <Shelf title="Wellness · DREAM ready">
          {wellness.map((book) => (
            <BookTile key={book.id} book={book} onSelect={() => onSelect(book.slug)} />
          ))}
        </Shelf>
      )}

      {worlds.length > 0 && (
        <Shelf title="Worlds">
          {worlds.map((world) => (
            <article
              key={world.id}
              tabIndex={0}
              className="focusable"
              style={{ ...worldCard, borderColor: world.accentColor }}
            >
              <p style={{ ...byStyle, color: world.accentColor }}>{world.name}</p>
              <p style={{ fontSize: 22, margin: "8px 0" }}>{world.synopsis}</p>
            </article>
          ))}
        </Shelf>
      )}
    </div>
  );
}

function Shelf({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="focus-shelf" style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 28, fontFamily: "monospace", letterSpacing: 4, textTransform: "uppercase", color: "var(--text-muted)", margin: "0 0 12px" }}>
        {title}
      </h2>
      <div style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 6, scrollSnapType: "x mandatory" }}>
        {children}
      </div>
    </section>
  );
}

function BookTile({ book, onSelect }: { book: BookSummary; onSelect(): void }) {
  return (
    <button className="focusable" onClick={onSelect} style={{ ...bookTile, scrollSnapAlign: "start" }}>
      <div style={coverStyle}>
        {book.coverUrl ? (
          <img src={book.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span style={{ color: "var(--text-muted)", fontSize: 18 }}>{book.title}</span>
        )}
      </div>
      <p style={byStyle}>{book.vertical} · {book.author}</p>
      <p style={{ fontSize: 24, fontWeight: 500, margin: "4px 0" }}>{book.title}</p>
      <p style={{ color: "var(--text-muted)", fontSize: 16, margin: 0 }}>{book.totalPages} pages</p>
    </button>
  );
}

const navTile: React.CSSProperties = {
  padding: "20px 28px",
  borderRadius: 16,
  background: "var(--surface)",
  border: "2px solid var(--border)",
  color: "var(--text)",
  fontSize: 22,
  textAlign: "left",
  fontFamily: "ui-monospace, monospace",
  letterSpacing: 1.4,
  textTransform: "uppercase"
};

const bookTile: React.CSSProperties = {
  flex: "0 0 280px",
  padding: 16,
  borderRadius: 18,
  background: "var(--surface)",
  border: "2px solid var(--border)",
  textAlign: "left"
};

const coverStyle: React.CSSProperties = {
  width: "100%",
  aspectRatio: "2/3",
  borderRadius: 12,
  background: "var(--card)",
  overflow: "hidden",
  display: "grid",
  placeItems: "center",
  marginBottom: 8
};

const byStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "ui-monospace, monospace",
  fontSize: 13,
  letterSpacing: 1.6,
  textTransform: "uppercase",
  color: "var(--gold)"
};

const worldCard: React.CSSProperties = {
  flex: "0 0 320px",
  padding: 18,
  borderRadius: 18,
  background: "var(--surface)",
  border: "2px solid",
  color: "var(--text)"
};