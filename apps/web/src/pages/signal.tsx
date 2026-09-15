import { useEffect, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";

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

export default function SignalPage() {
  const [data, setData] = useState<SignalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookSlug, setBookSlug] = useState("mitosis-a-living-cell-divides");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<SignalResponse>(`/api/signal/teacher?bookSlug=${encodeURIComponent(bookSlug)}`);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [bookSlug]);

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
            <span className="label">Book</span>
            <input value={bookSlug} onChange={(e) => setBookSlug(e.target.value)} />
          </label>
        </section>

        {error && <div className="empty-state">Signal feed offline · {error}</div>}
        {data && (
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