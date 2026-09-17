import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { BookCard } from "@/components/BookCard";
import { EmptyState, LoadingState } from "@/components/States";
import { apiFetch, type BookSummary } from "@/lib/api";
import { VERTICALS, verticalById } from "@/lib/verticals";

export default function LibraryPage() {
  const router = useRouter();
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const vertical = typeof router.query.vertical === "string" ? router.query.vertical.toUpperCase() : "ALL";

  useEffect(() => {
    if (typeof router.query.q === "string") setQuery(router.query.q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ items: BookSummary[] }>("/api/books?status=PUBLISHED&limit=100")
      .then((json) => {
        if (!cancelled) setBooks(json.items);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of books) map.set(b.vertical, (map.get(b.vertical) ?? 0) + 1);
    return map;
  }, [books]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books.filter(
      (b) =>
        (vertical === "ALL" || b.vertical === vertical) &&
        (!q || `${b.title} ${b.author} ${b.synopsis}`.toLowerCase().includes(q))
    );
  }, [books, vertical, query]);

  function choose(id: string) {
    const nextQuery: Record<string, string> = {};
    if (id !== "ALL") nextQuery.vertical = id;
    if (query.trim()) nextQuery.q = query.trim();
    void router.replace({ pathname: "/library", query: nextQuery }, undefined, { shallow: true, scroll: false });
  }

  const current = verticalById(vertical);

  return (
    <div className="app-shell">
      <Topbar />
      <ErrorBoundary
        fallback={(err, reset) => (
          <main className="container">
            <ErrorState error={err} onRetry={reset} title="The library failed to load" />
          </main>
        )}
      >
        <main className="container library-page">
          <header className="library-head">
            <div>
              <span className="label">The AnimBook library</span>
              <h1>{current ? current.label : "Every AnimBook"}</h1>
              <p className="muted">{current ? current.blurb : "Read, watch and listen. Pick a vertical or search for a title."}</p>
            </div>
            <label className="search-box">
              <span className="visually-hidden">Search the library</span>
              <svg viewBox="0 0 24 24" aria-hidden>
                <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="m16 16 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                placeholder="Search titles, authors, stories…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </header>

          <nav className="filter-chips" aria-label="Filter by vertical">
            <button type="button" className={vertical === "ALL" ? "active" : ""} onClick={() => choose("ALL")}>
              All <span>{books.length || ""}</span>
            </button>
            {VERTICALS.map((v) => {
              const n = counts.get(v.id) ?? 0;
              return (
                <button
                  key={v.id}
                  type="button"
                  className={vertical === v.id ? "active" : ""}
                  onClick={() => choose(v.id)}
                  disabled={!loading && n === 0}
                  style={vertical === v.id ? { background: v.accent, borderColor: v.accent } : undefined}
                  title={!loading && n === 0 ? "Coming soon" : undefined}
                >
                  {v.label} {n > 0 && <span>{n}</span>}
                </button>
              );
            })}
          </nav>

          {loading && <LoadingState variant="card" skeleton={8} message="Curating your library…" />}
          {error && <EmptyState title="The library is offline" message="Please try again in a moment." cta={{ href: "/library", label: "Retry" }} />}
          {!loading && !error && shown.length === 0 && (
            <EmptyState
              title={query ? "No books match your search" : "No books here yet"}
              message={query ? "Try another word, or clear the search." : "This vertical is coming soon."}
              cta={{ href: "/library", label: "See all books" }}
            />
          )}
          <div className="grid">
            {shown.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        </main>
      </ErrorBoundary>
    </div>
  );
}
