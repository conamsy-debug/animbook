import { useEffect, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";

interface DreamSession {
  id: string;
  bookId: string;
  ambientTrack: string;
  pagesRead: number;
  startedAt: string;
  endedAt: string | null;
  fellAsleepAt: string | null;
  exitReason: string | null;
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<{ items: DreamSession[] }>("/api/dream/sessions?limit=20").catch(() => null),
      apiFetch<{ tracks: AmbientTrack[] }>("/api/dream/ambient").catch(() => null)
    ]).then(([sess, amb]) => {
      if (cancelled) return;
      setSessions(sess?.items ?? []);
      setTracks(amb?.tracks ?? []);
    }).catch((err) => {
      if (cancelled) return;
      setError((err as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const totalSessions = sessions?.length ?? 0;
  const fellAsleepCount = sessions?.filter((s) => s.fellAsleepAt).length ?? 0;
  const totalPages = sessions?.reduce((sum, s) => sum + s.pagesRead, 0) ?? 0;
  const closedCount = sessions?.filter((s) => s.endedAt).length ?? 0;

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header style={{ margin: "32px 0 16px" }}>
          <p className="label">AnimBook next-gen</p>
          <h1>DREAM</h1>
          <p className="muted" style={{ maxWidth: 640 }}>
            The AnimBook sleep-mode. When a reader opens a WELLNESS vertical book, the Reader auto-applies a softer palette, slower narration, dimmer backdrop, and a looping ambient track. The session is logged so the reader can look back at their drift.
          </p>
        </header>

        {error && <p className="muted">{error}</p>}

        <section className="dream-stat-grid">
          <div className="dream-stat">
            <span className="stat-value">{totalSessions}</span>
            <span className="stat-label">Sessions</span>
          </div>
          <div className="dream-stat">
            <span className="stat-value">{fellAsleepCount}</span>
            <span className="stat-label">Fell asleep</span>
          </div>
          <div className="dream-stat">
            <span className="stat-value">{totalPages}</span>
            <span className="stat-label">Pages read in DREAM</span>
          </div>
          <div className="dream-stat">
            <span className="stat-value">{closedCount}</span>
            <span className="stat-label">Closed</span>
          </div>
        </section>

        <section style={{ margin: "32px 0" }}>
          <p className="label">Ambient library</p>
          <h2>The soundtrack</h2>
          {tracks ? (
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              {tracks.map((t) => (
                <li key={t.slug} className="companion-card" style={{ margin: 0 }}>
                  <strong style={{ fontFamily: "var(--serif)", fontSize: "1.1rem" }}>{t.label}</strong>
                  <p className="muted" style={{ margin: 0 }}>{t.description}</p>
                  <p className="label" style={{ margin: 0 }}>{t.syllable}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">Loading ambient tracks…</p>
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
                    <strong style={{ fontFamily: "var(--serif)" }}>{s.bookId}</strong>
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
            <li>Reader opens a <strong>WELLNESS</strong> vertical AnimBook.</li>
            <li>The Reader calls <code>GET /api/dream/profile/:bookId</code> to pick up the auto-pacing profile.</li>
            <li>Soft palette + slow motion + dimmed backdrop + 0.7× narration are applied.</li>
            <li>Reader flips pages; the session is logged at <code>/api/dream/sessions</code>.</li>
            <li>Twenty minutes without a page flip is marked as <em>fell asleep</em>.</li>
          </ol>
        </section>
      </main>
    </div>
  );
}
