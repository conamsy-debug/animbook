import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { LoadingState, EmptyState } from "@/components/States";
import { apiFetch, type BookSummary, type PageRecord } from "@/lib/api";
import { useLibraryStore, useToastStore } from "@/lib/store";
import { getReleaseInfo, submitDailyTask, formatRelative, type ReleaseInfo } from "@/lib/release";
import { useUser } from "@clerk/nextjs";

export default function BookDetailPage() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : null;
  const [book, setBook] = useState<BookSummary | null>(null);
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<"idle" | "downloading" | "ready">("idle");
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskText, setTaskText] = useState("");
  const [taskBusy, setTaskBusy] = useState(false);
  const library = useLibraryStore();
  const toast = useToastStore((s) => s.push);
  const { isSignedIn } = useUser();

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    async function load() {
      try {
        const [bookRes, pagesRes, releaseRes] = await Promise.all([
          apiFetch<BookSummary>(`/api/books/${encodeURIComponent(slug!)}`),
          apiFetch<{ pages: PageRecord[] }>(`/api/books/${encodeURIComponent(slug!)}/pages`),
          getReleaseInfo(slug!).catch(() => null)
        ]);
        if (cancelled) return;
        setBook(bookRes);
        setPages(pagesRes.pages);
        setRelease(releaseRes?.release ?? null);
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

  async function submitTask() {
    if (!book || !release) return;
    const text = taskText.trim();
    if (text.length < 2) {
      toast("Write a sentence or two first");
      return;
    }
    setTaskBusy(true);
    try {
      const res = await submitDailyTask(book.id, release.myUnlockedChunk, text);
      setRelease(res.release);
      setTaskOpen(false);
      setTaskText("");
      toast("Next chunk unlocked");
      // Refresh the page list so the reader sees the new pages.
      try {
        const pagesRes = await apiFetch<{ pages: PageRecord[] }>(`/api/books/${encodeURIComponent(book.slug)}/pages`);
        setPages(pagesRes.pages);
      } catch {
        // non-fatal — banner is enough
      }
    } catch (err) {
      toast(`Couldn't submit: ${(err as Error).message}`);
    } finally {
      setTaskBusy(false);
    }
  }

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
        {release && release.mode !== "IMMEDIATE" && (
          <section className="release-banner">
            <div>
              <span className="label">{release.mode === "TIME" ? "On a schedule" : "Daily tasks"}</span>
              <p>
                <strong>{pages.length}</strong> of {book?.totalPages ?? pages.length} pages live ·{" "}
                {release.mode === "TIME" && release.nextChunkAt && (
                  <>next drop {formatRelative(release.nextChunkAt)}</>
                )}
                {release.mode === "TASK" && (
                  <>{release.myUnlockedChunk < release.totalChunks ? "finish today’s reflection to unlock the next chunk" : "you’ve unlocked every chunk"}</>
                )}
              </p>
              {release.mode === "TASK" && release.myUnlockedChunk < release.totalChunks && (
                <p className="muted small">
                  Unlocked {release.myUnlockedChunk} of {release.totalChunks} chunks so far.
                </p>
              )}
            </div>
            {release.mode === "TASK" && release.myUnlockedChunk < release.totalChunks && (
              <button type="button" className="btn primary" onClick={() => { if (!isSignedIn) { toast("Sign in to submit a reflection"); return; } setTaskOpen(true); }}>
                {isSignedIn ? "Submit today's reflection" : "Sign in to submit"}
              </button>
            )}
          </section>
        )}

        <section className="book-detail">
          <div className="cover-large" style={{ backgroundImage: book.coverUrl ? `url(${book.coverUrl})` : undefined }} />
          <div>
            <span className="label">{book.vertical}</span>
            <h1>{book.title}</h1>
            {book.subtitle && <p className="book-subtitle">{book.subtitle}</p>}
            <p className="muted">
              by{" "}
              {book.creator?.handle ? (
                <Link href={`/author/${book.creator.handle}`} className="author-link">
                  {book.creator.name}
                </Link>
              ) : (
                book.author
              )}
            </p>
            <p style={{ marginTop: 16 }}>{book.synopsis}</p>
            <p className="book-circle-line">
              <Link href={`/circles?bookId=${book.id}&title=${encodeURIComponent(book.title)}`} className="author-link">
                Start a reading circle for this book →
              </Link>
            </p>
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

      {taskOpen && release && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="task-title">
          <div className="modal-card">
            <h3 id="task-title">Today's reflection</h3>
            <p className="muted">{release.dailyTaskPrompt ?? "Write a short reflection to unlock the next chunk."}</p>
            <textarea
              rows={5}
              maxLength={2000}
              value={taskText}
              onChange={(e) => setTaskText(e.target.value)}
              placeholder="A sentence or two is plenty."
              autoFocus
            />
            <div className="panel-actions">
              <button type="button" className="btn ghost" onClick={() => { setTaskOpen(false); setTaskText(""); }}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={submitTask} disabled={taskBusy || taskText.trim().length < 2}>
                {taskBusy ? "Unlocking…" : "Unlock next chunk"}
              </button>
            </div>
          </div>
        </div>
      )}
      </ErrorBoundary>
    </div>
  );
}