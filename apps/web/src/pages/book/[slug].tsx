import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { LoadingState, EmptyState } from "@/components/States";
import { apiFetch, type BookSummary, type PageRecord } from "@/lib/api";
import { useLibraryStore, useToastStore } from "@/lib/store";

export default function BookDetailPage() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : null;
  const [book, setBook] = useState<BookSummary | null>(null);
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<"idle" | "downloading" | "ready">("idle");
  const library = useLibraryStore();
  const toast = useToastStore((s) => s.push);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    async function load() {
      try {
        const [bookRes, pagesRes] = await Promise.all([
          apiFetch<BookSummary>(`/api/books/${encodeURIComponent(slug!)}`),
          apiFetch<{ pages: PageRecord[] }>(`/api/books/${encodeURIComponent(slug!)}/pages`)
        ]);
        if (cancelled) return;
        setBook(bookRes);
        setPages(pagesRes.pages);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function addToLibrary() {
    if (!book) return;
    try {
      await apiFetch(`/api/library/${book.slug}`, { method: "POST", json: { mode: "BOTH" } });
      toast("Added to your library");
    } catch (err) {
      toast(`Could not add: ${(err as Error).message}`);
    }
  }

  async function downloadForOffline() {
    if (!book) return;
    setDownloadState("downloading");
    try {
      const manifest = await apiFetch<{ assets: { url: string; kind: string }[] }>(`/api/offline/${book.slug}/manifest`);
      const cache = await caches.open("animbook-offline");
      await Promise.all(
        manifest.assets.map(async (asset) => {
          try {
            const res = await fetch(asset.url);
            if (res.ok) await cache.put(asset.url, res.clone());
          } catch {
            // ignore individual asset failures
          }
        })
      );
      await apiFetch(`/api/offline/${book.slug}/download`, { method: "POST" });
      setDownloadState("ready");
      toast(`Downloaded ${manifest.assets.length} assets for offline reading`);
    } catch (err) {
      setDownloadState("idle");
      toast(`Offline download failed: ${(err as Error).message}`);
    }
  }

  if (loading) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <LoadingState message="Loading book…" />
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
            title="This book is unavailable"
            message={error ?? "The record is missing or the AnimBook was unpublished."}
            cta={{ href: "/library", label: "Back to library" }}
          />
        </main>
      </div>
    );
  }

  const previewPages = pages.slice(0, 2);

  return (
    <div className="app-shell">
      <Topbar />
      <ErrorBoundary
        fallback={(err, reset) => (
          <main className="container">
            <ErrorState error={err} onRetry={reset} title="The book page failed to render" />
          </main>
        )}
      >
      <main className="container">
        <section className="book-detail">
          <div className="cover-large" style={{ backgroundImage: book.coverUrl ? `url(${book.coverUrl})` : undefined }} />
          <div>
            <span className="label">{book.vertical}</span>
            <h1>{book.title}</h1>
            {book.subtitle && <p className="book-subtitle">{book.subtitle}</p>}
            <p className="muted">by {book.author}</p>
            <p style={{ marginTop: 16 }}>{book.synopsis}</p>
            <dl className="kvp">
              <dt>Pages</dt>
              <dd>{book.totalPages}</dd>
              <dt>Language</dt>
              <dd>{book.language}</dd>
              <dt>Narration languages</dt>
              <dd>{(book as unknown as { narrationLanguages?: string[] }).narrationLanguages?.join(", ") ?? book.language}</dd>
              <dt>Style</dt>
              <dd>{book.styleId ?? "Painterly Mysticism (default)"}</dd>
              <dt>Age rating</dt>
              <dd>{book.ageRating ?? "All ages"}</dd>
            </dl>
            <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
              <Link href={`/read/${book.slug}`} className="btn primary">
                Open reader
              </Link>
              <button type="button" className="btn" onClick={addToLibrary}>
                Add to library
              </button>
              <button type="button" className="btn" onClick={downloadForOffline} disabled={downloadState !== "idle"}>
                {downloadState === "idle" ? "Download for offline" : downloadState === "downloading" ? "Downloading…" : "✓ Offline ready"}
              </button>
            </div>
          </div>
        </section>

        <section>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#C49A1C" }} />
              <h2>Sample AnimPages</h2>
            </div>
            <span className="label">First 2 of {pages.length}</span>
          </header>
          <div className="grid">
            {previewPages.map((page) => (
              <article key={page.id} className="page-card">
                <div className="meta">
                  <span>Page {page.pageNum}</span>
                  <span>{page.emotionalRegister ?? "—"}</span>
                </div>
                <p className="excerpt">{page.textExcerpt}</p>
                {page.posterUrl && (
                  <img className="sample-poster" src={page.posterUrl} alt={`Page ${page.pageNum} preview`} loading="lazy" />
                )}
              </article>
            ))}
          </div>
        </section>

        <section>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#0A7B8A" }} />
              <h2>In your library?</h2>
            </div>
            <span className="label">{library.entries.length} saved books</span>
          </header>
          {library.entries.length === 0 ? (
            <EmptyState
              title="No saved books yet"
              message="Tap Add to library above to start your shelf."
            />
          ) : (
            <ul>
              {library.entries.map((entry) => (
                <li key={entry.id}>
                  <Link href={`/read/${entry.bookId}`}>Open {entry.bookId}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      </ErrorBoundary>
    </div>
  );
}