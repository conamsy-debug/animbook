import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { EmptyState, LoadingState } from "@/components/States";
import { LibraryHero } from "@/components/library/LibraryHero";
import { LibraryRow } from "@/components/library/LibraryRow";
import { LibraryPosterCard } from "@/components/library/LibraryPosterCard";
import { apiFetch, type BookSummary } from "@/lib/api";
import { VERTICALS, verticalById } from "@/lib/verticals";
import { useFeaturedRotator } from "@/lib/homepage/useFeaturedRotator";
import { deriveRows } from "@/lib/library/rowDerivation";
import { useResilientFetch } from "@/lib/useResilientFetch";

/**
 * Library page — AnimBook redesign.
 *
 * Default render (vertical=ALL, no query):
 *   CinematicTopbar · Hero · Chips (overlapping) · Rows
 *
 * Filtered/searched render (vertical != ALL OR query != ""):
 *   CinematicTopbar · Chips · Wrapped grid of poster cards
 */
export default function LibraryPage() {
  const router = useRouter();
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [query, setQuery] = useState("");

  const { data, loading, error } = useResilientFetch<{ items: BookSummary[] }>(
    "/api/books?status=PUBLISHED&limit=100",
    { tag: "[LIBRARY]" }
  );

  // Keep local `books` in sync with the hook so downstream `useMemo`s
  // don't recompute every render on parent state changes.
  useEffect(() => {
    if (data?.items) setBooks(data.items);
  }, [data]);

  const vertical = typeof router.query.vertical === "string" ? router.query.vertical.toUpperCase() : "ALL";
  const sub = typeof router.query.sub === "string" ? router.query.sub : null;

  useEffect(() => {
    if (typeof router.query.q === "string") setQuery(router.query.q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of books) map.set(b.vertical, (map.get(b.vertical) ?? 0) + 1);
    return map;
  }, [books]);

  const inVertical = useMemo(() => books.filter((b) => vertical === "ALL" || b.vertical === vertical), [books, vertical]);

  const subCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of inVertical) if (b.subcategory) map.set(b.subcategory, (map.get(b.subcategory) ?? 0) + 1);
    return map;
  }, [inVertical]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inVertical.filter(
      (b) =>
        (!sub || b.subcategory === sub) &&
        (!q || `${b.title} ${b.subtitle ?? ""} ${b.author} ${b.synopsis}`.toLowerCase().includes(q))
    );
  }, [inVertical, sub, query]);

  function navigate(nextQuery: Record<string, string>) {
    void router.replace({ pathname: "/library", query: nextQuery }, undefined, { shallow: true, scroll: false });
  }

  const choose = useCallback((id: string, subId: string | null = null) => {
    const next: Record<string, string> = {};
    if (id !== "ALL") next.vertical = id;
    if (subId) next.sub = subId;
    if (query.trim()) next.q = query.trim();
    navigate(next);
  }, [query]);

  /** Wire the "Explore all" link on each row. Vertical / series rows push
   *  their own filter into the URL so the library's filter mechanism
   *  takes over. */
  const onExploreRow = useCallback((filter: { kind: "originals" | "series" | "vertical"; series?: string; filterLabel: string }) => {
    const next: Record<string, string> = {};
    if (filter.kind === "vertical") {
      const v = VERTICALS.find((vv) => vv.label === filter.filterLabel);
      if (v) next.vertical = v.id;
    } else if (filter.kind === "originals") {
      next.vertical = "ORIGINALS";
    }
    // Series rows: no vertical filter exists yet — drop the user into
    // the full All view with the series name as the search query so
    // they can find the books. (The brief allows this when no series
    // field exists.)
    if (filter.kind === "series" && filter.series) {
      next.q = filter.series;
      delete next.vertical;
    }
    navigate(next);
  }, []);

  const rows = useMemo(() => deriveRows({ books }), [books]);
  // Hero cycles through the strongest books every minute. No page
  // fetcher — the hero only needs cover/title/synopsis, all already on
  // the book record. Hovering the hero pauses rotation so the reader
  // can study the book, parallax, and CTAs without it slipping away.
  const heroRef = useRef<HTMLDivElement | null>(null);
  const { book: featured } = useFeaturedRotator({
    books,
    intervalMs: 60_000,
    pauseOnHoverRef: heroRef
  });
  const current = verticalById(vertical);
  const isFiltered = vertical !== "ALL" || query.trim().length > 0;

  return (
    <div className="app-shell lib-page">
      <Topbar
        variant="cinematic"
        searchValue={query}
        onSearchChange={(next) => {
          setQuery(next);
          // Reflect in URL without losing other params.
          const url: Record<string, string> = {};
          if (vertical !== "ALL") url.vertical = vertical;
          if (sub) url.sub = sub;
          if (next.trim()) url.q = next.trim();
          navigate(url);
        }}
      />

      <ErrorBoundary
        fallback={(err, reset) => (
          <main className="container">
            <ErrorState error={err} onRetry={reset} title="The library failed to load" />
          </main>
        )}
      >
        <main className="lib-main">
          {/* Hero: shown in default view only, behind the chips. The
           *  `key={featured.id}` forces the hero to remount every time
           *  the rotator advances — the parallax/load animation then
           *  re-runs for the new book, so each rotation gets its own
           *  cinematic entrance instead of an abrupt prop swap. The
           *  wrapper `ref` is what the rotator watches to implement
           *  pause-on-hover. */}
          {!isFiltered && featured && (
            <div ref={heroRef}>
              <LibraryHero key={featured.id} book={featured} />
            </div>
          )}

          {/* Chips overlap the hero by 64px in default view; sit normally in filtered view. */}
          <nav
            className={`lib-chips${!isFiltered ? " over-hero" : ""}`}
            aria-label="Filter by vertical"
          >
            <button
              type="button"
              className={`lib-chip${vertical === "ALL" ? " on" : ""}`}
              onClick={() => choose("ALL")}
              aria-pressed={vertical === "ALL"}
            >
              All <span className="lib-n">{books.length || ""}</span>
            </button>
            {VERTICALS.map((v) => {
              const n = counts.get(v.id) ?? 0;
              const empty = !loading && n === 0;
              return (
                <button
                  key={v.id}
                  type="button"
                  className={`lib-chip${vertical === v.id ? " on" : ""}`}
                  onClick={() => choose(v.id)}
                  disabled={empty}
                  aria-pressed={vertical === v.id}
                  title={empty ? "Coming soon" : undefined}
                >
                  {v.label} {n > 0 && <span className="lib-n">{n}</span>}
                </button>
              );
            })}
          </nav>

          {/* Subcategory chips: only when a vertical is active. */}
          {current && !isFiltered && vertical !== "ALL" && (
            <nav className="lib-chips subs" aria-label={`Shelves in ${current.label}`}>
              <button type="button" className={`lib-chip${!sub ? " on" : ""}`} onClick={() => choose(current.id)} aria-pressed={!sub}>
                All {current.label} <span className="lib-n">{inVertical.length || ""}</span>
              </button>
              {current.subcategories.map((option) => {
                const n = subCounts.get(option.id) ?? 0;
                const empty = !loading && n === 0;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`lib-chip${sub === option.id ? " on" : ""}`}
                    onClick={() => choose(current.id, option.id)}
                    disabled={empty}
                    aria-pressed={sub === option.id}
                    title={empty ? "Nothing on this shelf yet" : undefined}
                  >
                    {option.label} {n > 0 && <span className="lib-n">{n}</span>}
                  </button>
                );
              })}
            </nav>
          )}

          {loading && books.length === 0 && (
            <LoadingState variant="card" skeleton={8} message="Curating your library…" />
          )}

          {error && (
            <EmptyState
              title="The library is offline"
              message={error}
              retry={{ label: "Retry", onClick: () => router.replace(router.asPath) }}
            />
          )}

          {/* Default view: rows */}
          {!loading && !error && !isFiltered && rows.length > 0 && (
            <div className="lib-rows">
              {rows.map((row) => (
                <LibraryRow key={row.id} row={row} onExplore={onExploreRow} />
              ))}
            </div>
          )}

          {/* Filtered / searched view: grid */}
          {!loading && !error && isFiltered && (
            <div className="lib-grid">
              {shown.length === 0 ? (
                <EmptyState
                  title="No AnimBooks match your search."
                  message="Try another word, or clear the filters."
                  cta={{ href: "/library", label: "Clear filters" }}
                />
              ) : (
                shown.map((book) => (
                  <LibraryPosterCard key={book.id} book={book} gridMode />
                ))
              )}
            </div>
          )}
        </main>
      </ErrorBoundary>
    </div>
  );
}
