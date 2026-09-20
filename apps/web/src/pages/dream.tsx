import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { apiFetch, type BookSummary } from "@/lib/api";
import { useAmbient, type AmbientTrackName } from "@/lib/useAmbient";

interface DreamSession {
  id: string;
  bookId: string;
  ambientTrack: string;
  pagesRead: number;
  startedAt: string;
  endedAt: string | null;
  fellAsleepAt: string | null;
  exitReason: string | null;
  book: { id: string; slug: string; title: string; author: string; coverUrl: string | null } | null;
}

interface AmbientTrack {
  slug: string;
  label: string;
  description: string;
  syllable: string;
}

export default function DreamPage() {
  const [sessions, setSessions] = useState<DreamSession[] | null>(null);
  const [tracks, setTracks] = useState<AmbientTrack[] | null>(null);
  const [wellnessBooks, setWellnessBooks] = useState<BookSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<AmbientTrackName | null>(null);
  const ambient = useAmbient(previewing, { enabled: previewing !== null, volume: 0.55 });
  // Stop the preview when the user navigates away.
  useEffect(() => () => { ambient.stop(); }, [ambient]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<{ items: DreamSession[] }>("/api/dream/sessions?limit=20").catch(() => null),
      apiFetch<{ tracks: AmbientTrack[] }>("/api/dream/ambient").catch(() => null),
      apiFetch<{ items: BookSummary[] }>("/api/books?vertical=WELLNESS&status=PUBLISHED&limit=12").catch(() => null)
    ]).then(([sess, amb, books]) => {
      if (cancelled) return;
      setSessions(sess?.items ?? []);
      setTracks(amb?.tracks ?? []);
      setWellnessBooks(books?.items ?? []);
    }).catch((err) => {
      if (!cancelled) setError((err as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const list = sessions ?? [];
    return {
      total: list.length,
      fellAsleep: list.filter((s) => s.fellAsleepAt).length,
      pages: list.reduce((sum, s) => sum + s.pagesRead, 0),
      closed: list.filter((s) => s.endedAt).length
    };
  }, [sessions]);

  function togglePreview(slug: string) {
    if (previewing === slug) {
      ambient.stop();
      setPreviewing(null);
    } else {
      setPreviewing(slug as AmbientTrackName);
    }
  }

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header style={{ margin: "32px 0 16px" }}>
          <p className="label">AnimBook next-gen</p>
          <h1>DREAM</h1>
          <p className="muted" style={{ maxWidth: 640 }}>
            The AnimBook sleep-mode. When you open a WELLNESS vertical book, the Reader
            auto-applies a softer palette, slower narration, dimmer backdrop, and a
            looping ambient track. The session is logged so you can look back at your
            drift.
          </p>
        </header>

        {error && <p className="muted">{error}</p>}

        <section className="dream-stat-grid" aria-label="Dream statistics">
          <div className="dream-stat">
            <span className="stat-value">{stats.total}</span>
            <span className="stat-label">Sessions</span>
          </div>
          <div className="dream-stat">
            <span className="stat-value">{stats.fellAsleep}</span>
            <span className="stat-label">Fell asleep</span>
          </div>
          <div className="dream-stat">
            <span className="stat-value">{stats.pages}</span>
            <span className="stat-label">Pages in DREAM</span>
          </div>
          <div className="dream-stat">
            <span className="stat-value">{stats.closed}</span>
            <span className="stat-label">Closed</span>
          </div>
        </section>

        <section style={{ margin: "32px 0" }}>
          <p className="label">Ambient library</p>
          <h2>The soundtrack</h2>
          <p className="muted small" style={{ marginBottom: 16 }}>
            Tap a track to preview the synth. Browser autoplay rules apply — the first
            click is what unlocks the audio.
          </p>
          {tracks ? (
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              {tracks.map((t) => {
                const active = previewing === t.slug;
                return (
                  <li
                    key={t.slug}
                    className="companion-card dream-track-card"
                    data-active={active ? "true" : "false"}
                  >
                    <strong style={{ fontFamily: "var(--serif)", fontSize: "1.1rem" }}>{t.label}</strong>
                    <p className="muted" style={{ margin: 0 }}>{t.description}</p>
                    <p className="label" style={{ margin: 0 }}>{t.syllable}</p>
                    <button
                      type="button"
                      className="dream-play"
                      onClick={() => togglePreview(t.slug)}
                      aria-pressed={active}
                    >
                      {active ? "■ Stop preview" : "▶ Preview"}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="empty-state">Loading ambient tracks…</p>
          )}
        </section>

        <section style={{ margin: "32px 0" }}>
          <p className="label">WELLNESS books</p>
          <h2>Open a book to dream on</h2>
          {wellnessBooks == null ? (
            <p className="empty-state">Loading WELLNESS books…</p>
          ) : wellnessBooks.length === 0 ? (
            <p className="empty-state">
              No WELLNESS AnimBooks published yet. Use Studio to seed one with{" "}
              <code>vertical: &quot;WELLNESS&quot;</code>.
            </p>
          ) : (
            <ul className="dream-books">
              {wellnessBooks.map((b) => (
                <li key={b.id} className="dream-book-card">
                  <h3>{b.title}</h3>
                  <p className="muted small" style={{ margin: 0 }}>{b.author} · {b.totalPages} pp</p>
                  <Link href={`/read/${b.slug ?? b.id}`}>Open in DREAM →</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ margin: "32px 0" }}>
          <p className="label">Recent sessions</p>
          <h2>The drift log</h2>
          {sessions == null ? (
            <p className="empty-state">Loading sessions…</p>
          ) : sessions.length === 0 ? (
            <p className="empty-state">No DREAM sessions yet · open a WELLNESS AnimBook to start one.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
              {sessions.map((s) => (
                <li key={s.id} className="companion-card" style={{ margin: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <strong style={{ fontFamily: "var(--serif)" }}>
                      {s.book?.title ?? s.bookId}
                    </strong>
                    <span className="label">{new Date(s.startedAt).toLocaleString()}</span>
                  </div>
                  <p className="muted" style={{ margin: 0 }}>
                    ambient: {s.ambientTrack.replace("_", " ")} · pages read: {s.pagesRead} · {s.endedAt ? "closed" : "in progress"}
                  </p>
                  {s.fellAsleepAt && (
                    <p className="label" style={{ margin: 0, color: "var(--wellness)" }}>
                      Fell asleep at {new Date(s.fellAsleepAt).toLocaleTimeString()}
                    </p>
                  )}
                  {s.exitReason && (
                    <p className="muted" style={{ margin: 0 }}>exit reason: {s.exitReason}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ margin: "48px 0 32px" }}>
          <p className="label">How DREAM works</p>
          <ol style={{ color: "var(--text-muted)", paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Open a <strong>WELLNESS</strong> vertical AnimBook.</li>
            <li>The Reader calls <code>GET /api/dream/profile/:bookId</code> to pick up the auto-pacing profile.</li>
            <li>Soft palette + slow motion + dimmed backdrop + 0.7× narration are applied.</li>
            <li>The Reader renders the dream-banner with a Sound toggle — first tap unlocks the Web Audio synth.</li>
            <li>Page flips are logged at <code>/api/dream/sessions</code>.</li>
            <li>Twenty minutes without a page flip is marked as <em>fell asleep</em>.</li>
          </ol>
        </section>
      </main>
    </div>
  );
}
