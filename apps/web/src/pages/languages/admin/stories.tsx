import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { LANGUAGES_ENABLED } from "@/features/languages/config";
import {
  fetchAdminStories,
  type ReviewStatus,
  type ReviewStorySummary
} from "@/features/languages/api";

/**
 * /languages/admin/stories — AnimBook Languages admin review queue.
 *
 * Lists every Story with `reviewStatus` matching the active filter,
 * newest-updated first. Default filter is `in_review` so the landing
 * matches the spec's "reviewer opens the queue, sees what's pending"
 * flow.
 *
 * Click a row → `/languages/admin/stories/[storyId]` for the detail +
 * edit + approve/reject surface.
 *
 * The page reads the status filter from `?status=...` so the URL is
 * shareable. We default to `in_review` to mirror the spec.
 */
export default function LanguagesAdminStoriesPage() {
  const [status, setStatus] = useState<ReviewStatus>("in_review");
  const [stories, setStories] = useState<ReviewStorySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!LANGUAGES_ENABLED) return;
    const controller = new AbortController();
    fetchAdminStories({ status }, controller.signal)
      .then((rows) => {
        setStories(rows);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err.message);
          setStories([]);
        }
      });
    return () => controller.abort();
  }, [status]);

  if (!LANGUAGES_ENABLED) return <NotAvailable />;

  return (
    <div className="app-shell lib-page lang-page">
      <Head>
        <title>Admin · Stories · AnimBook Languages</title>
      </Head>
      <Topbar variant="cinematic" />
      <main className="container lang-page lang-admin">
        <ErrorBoundary
          fallback={(err, reset) => (
            <ErrorState
              title="Couldn't load review queue"
              error={err}
              onRetry={reset}
            />
          )}
        >
          <header className="lang-admin-header">
            <h1>Story review queue</h1>
            <p>
              Review, edit and regenerate audio for each language
              version, then approve or reject it. Approved stories appear
              to learners immediately.
            </p>
          </header>

          <nav className="lang-admin-tabs" aria-label="Status filter">
            {(["draft", "in_review", "approved", "rejected"] as ReviewStatus[]).map(
              (s) => (
                <button
                  key={s}
                  type="button"
                  className={`lang-admin-tab${status === s ? " is-active" : ""}`}
                  onClick={() => setStatus(s)}
                >
                  {labelForStatus(s)}
                </button>
              )
            )}
          </nav>

          {error ? (
            <ErrorState
              title="Couldn't load stories"
              error={new Error(error)}
              onRetry={() => setStatus((s) => s)}
            />
          ) : stories === null ? (
            <p className="lang-admin-loading">Loading…</p>
          ) : stories.length === 0 ? (
            <div className="lang-admin-empty">
              <p className="lang-admin-empty-eyebrow">All clear</p>
              <p className="lang-admin-empty-title">
                No stories in <strong>{labelForStatus(status)}</strong>.
              </p>
              <p className="lang-admin-empty-hint">
                Nothing to review right now. Approved stories appear to
                learners immediately; drafts need a content job before
                they can be reviewed.
              </p>
            </div>
          ) : (
            <ul className="lang-admin-list">
              {stories.map((s) => (
                <li key={s.id} className="lang-admin-row">
                  <Link
                    href={`/languages/admin/stories/${encodeURIComponent(s.id)}`}
                    className="lang-admin-row-link"
                  >
                    <div className="lang-admin-row-meta">
                      <span className="lang-admin-row-target">{s.targetLang}</span>
                      <span className="lang-admin-row-cefr">{s.cefrLevel}</span>
                      {s.isPublished ? (
                        <span className="lang-admin-row-pill is-published">
                          published
                        </span>
                      ) : null}
                    </div>
                    <h2>{s.title || s.masterStoryTitle}</h2>
                    <p className="lang-admin-row-master">
                      From: {s.masterStoryTitle}
                    </p>
                    <p className="lang-admin-row-time">
                      Updated {formatTime(s.updatedAt)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}

function labelForStatus(s: ReviewStatus): string {
  switch (s) {
    case "draft":
      return "Draft";
    case "in_review":
      return "In review";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function NotAvailable() {
  return (
    <div className="app-shell lib-page lang-page">
      <Topbar variant="cinematic" />
      <main className="container lang-page lang-admin">
        <p className="lang-not-available">
          AnimBook Languages is not enabled in this build.
        </p>
      </main>
    </div>
  );
}
