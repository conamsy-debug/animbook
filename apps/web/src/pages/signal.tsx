import { useEffect, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/lib/store";

interface PageSignal {
  pageNum: number;
  readers: number;
  avgDwellMs: number;
  abandoned: number;
  scrolledBack: number;
  dropOffScore: number;
}

interface SignalResponse {
  book: { id: string; slug: string; title: string; totalPages: number };
  pageSignals: PageSignal[];
}

/** Slugs that have at least some signal data in production (per the
 *  probe-signal.mjs inventory). Used as a "try one of these" hint in
 *  the empty state when the typed slug has no events yet. */
const SLUGS_WITH_DATA = new Set([
  "the-quiet-hour",
  "morning-pages",
  "the-sleeping-coast"
]);

/** Default to a book that actually has signal data. "mitosis-a-living-cell-divides"
 *  is the only EDU book anyone is likely to type, but it has zero events in
 *  production — landing on the empty state on first visit is a worse UX
 *  than landing on a book with real telemetry to look at. */
const DEFAULT_SLUG = "the-quiet-hour";

export default function SignalPage() {
  const [data, setData] = useState<SignalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stuck, setStuck] = useState(false);
  const [bookSlug, setBookSlug] = useState(DEFAULT_SLUG);
  const [inputValue, setInputValue] = useState(DEFAULT_SLUG);
  const toast = useToastStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    async function load() {
      try {
        const res = await apiFetch<SignalResponse>(`/api/signal/teacher?bookSlug=${encodeURIComponent(bookSlug)}`);
        if (cancelled) return;
        setData(res);
        setLoading(false);
        if (res.pageSignals.length === 0) {
          // Soft hint, not a failure — empty data is a valid signal.
          console.info("[SIGNAL] no events for", bookSlug);
        }
      } catch (err) {
        if (cancelled) return;
        console.warn("[SIGNAL] fetch failed:", err);
        setError((err as Error).message);
        setLoading(false);
        toast(`Signal feed offline: ${(err as Error).message}`);
      }
    }
    // 4s → "tap to retry". 8s → hard error. Same pattern as /edu.
    const stuckTimer = window.setTimeout(() => {
      if (!cancelled) setStuck(true);
    }, 4_000);
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        console.warn("[SIGNAL] fetch timeout fired at 8s");
        setError("Signal feed is taking longer than expected. The API may be down — try again in a moment.");
        setLoading(false);
      }
    }, 8_000);
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(stuckTimer);
      window.clearTimeout(timeout);
    };
  }, [bookSlug]);

  function commitSlug() {
    const trimmed = inputValue.trim();
    if (!trimmed || trimmed === bookSlug) return;
    setBookSlug(trimmed);
  }

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header className="section-header">
          <div className="left">
            <span className="dot" style={{ background: "#1A6B3C" }} />
            <h1>AnimBook SIGNAL</h1>
          </div>
          <span className="label">Engagement intelligence · opt-in only</span>
        </header>

        <section className="card">
          <label>
            <span className="label">Book slug</span>
            <input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitSlug();
              }}
              placeholder="e.g. the-quiet-hour"
            />
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="btn primary" onClick={commitSlug} disabled={!inputValue.trim() || inputValue.trim() === bookSlug}>
              Load signals
            </button>
            <span className="muted small" style={{ alignSelf: "center" }}>
              Showing: <strong>{bookSlug}</strong>
            </span>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Try: <button type="button" className="link" onClick={() => { setInputValue("the-quiet-hour"); setBookSlug("the-quiet-hour"); }}>the-quiet-hour</button>, <button type="button" className="link" onClick={() => { setInputValue("morning-pages"); setBookSlug("morning-pages"); }}>morning-pages</button>, <button type="button" className="link" onClick={() => { setInputValue("the-sleeping-coast"); setBookSlug("the-sleeping-coast"); }}>the-sleeping-coast</button>
          </p>
        </section>

        {loading && !data && !error && (
          <div className="empty-state">
            Loading signal telemetry…
            {stuck && (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    if (typeof window !== "undefined") window.location.reload();
                  }}
                >
                  Still loading? Tap to retry.
                </button>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="empty-state">
            Signal feed offline · {error}
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setError(null);
                  setBookSlug((cur) => cur); // re-trigger effect
                }}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {data && data.pageSignals.length === 0 && !error && (
          <div className="empty-state">
            No signal events for <strong>{data.book.title}</strong> yet — readers will generate telemetry as they engage.
            <div style={{ marginTop: 8, fontSize: "0.85rem" }} className="muted">
              Other books with signal data:{" "}
              {[...SLUGS_WITH_DATA].filter((s) => s !== bookSlug).map((s) => (
                <button key={s} type="button" className="link" style={{ marginRight: 8 }} onClick={() => { setInputValue(s); setBookSlug(s); }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {data && data.pageSignals.length > 0 && (
          <>
            <section className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginTop: 16 }}>
              <Stat label="Pages monitored" value={data.book.totalPages} accent="#14818E" />
              <Stat label="Readers" value={data.pageSignals.reduce((sum, p) => sum + p.readers, 0)} accent="#C49A1C" />
              <Stat
                label="Avg dwell"
                value={`${Math.round(data.pageSignals.reduce((sum, p) => sum + p.avgDwellMs, 0) / Math.max(1, data.pageSignals.length))}ms`}
                accent="#1A8A4A"
              />
              <Stat
                label="Drop-off"
                value={data.pageSignals.reduce((sum, p) => sum + p.dropOffScore, 0)}
                accent="#D46A0A"
              />
            </section>

            <section style={{ marginTop: 24 }}>
              <header className="section-header">
                <div className="left">
                  <span className="dot" style={{ background: "#D46A0A" }} />
                  <h2>Drop-off risk by page</h2>
                </div>
                <span className="label">{data.pageSignals.length} page signals</span>
              </header>
              {data.pageSignals.length === 0 ? (
                <div className="empty-state">No signal data yet. Readers will start generating events as they read.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {data.pageSignals.slice(0, 10).map((entry) => (
                    <article key={entry.pageNum} className="card" style={{ borderColor: heatColor(entry.dropOffScore) }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
                        <div>
                          <span className="label">Page {entry.pageNum}</span>
                          <h3 style={{ marginTop: 4 }}>{entry.readers} readers · {Math.round(entry.avgDwellMs / 1000)}s avg</h3>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span className="badge" style={{ borderColor: heatColor(entry.dropOffScore) }}>Drop-off score · {entry.dropOffScore}</span>
                          <p className="muted" style={{ marginTop: 4 }}>{entry.abandoned} abandoned · {entry.scrolledBack} scrolled back</p>
                        </div>
                      </div>
                      <div className="bar-meter" style={{ marginTop: 8 }}>
                        <div className="fill" style={{ width: `${Math.min(100, entry.dropOffScore * 8)}%`, background: heatColor(entry.dropOffScore) }} />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <p className="muted" style={{ marginTop: 24 }}>
              <strong>Privacy.</strong> Signal data is opt-in, never sold to third parties, and surfaced only to the institution admin and the platform team. See the AnimBook transparency dashboard.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="card" style={{ borderColor: accent }}>
      <span className="label">{label}</span>
      <h2 style={{ marginTop: 8, color: accent }}>{value}</h2>
    </div>
  );
}

function heatColor(score: number): string {
  if (score >= 12) return "#D46A0A";
  if (score >= 6) return "#C49A1C";
  return "#1A8A4A";
}