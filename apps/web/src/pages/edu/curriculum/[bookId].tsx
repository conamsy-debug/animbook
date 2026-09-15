import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";

interface HeatmapResponse {
  framework: string;
  totalPages: number;
  mapping: { framework: string; standardCode: string; standardTitle: string; pageNums: number[]; coveragePct: number }[];
  gaps: { standardCode: string; reason: string }[];
  frameworks: string[];
}

export default function CurriculumMapPage() {
  const router = useRouter();
  const bookId = typeof router.query.bookId === "string" ? router.query.bookId : null;
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [framework, setFramework] = useState<string>("KENYA_CBC");

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    async function load() {
      try {
        const json = await apiFetch<HeatmapResponse>(`/api/edu/curriculum/map/${encodeURIComponent(bookId!)}?framework=${encodeURIComponent(framework)}`);
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [bookId, framework]);

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header className="section-header">
          <div className="left">
            <span className="dot" style={{ background: "#1A6B3C" }} />
            <h1>Curriculum Map</h1>
          </div>
          <Link href="/edu" className="btn">← Teacher dashboard</Link>
        </header>

        {error && <div className="empty-state">Heatmap unavailable · {error}</div>}
        {!data && !error && <div className="empty-state">Mapping {framework} for {bookId}…</div>}
        {data && (
          <>
            <section className="card" style={{ marginBottom: 16 }}>
              <label>
                <span className="label">Framework</span>
                <select value={framework} onChange={(e) => setFramework(e.target.value)}>
                  {data.frameworks.map((fw) => (
                    <option key={fw} value={fw}>{fw}</option>
                  ))}
                </select>
              </label>
              <p className="muted" style={{ marginTop: 12 }}>
                {data.totalPages} pages mapped to {data.mapping.length} standard{data.mapping.length === 1 ? "" : "s"}.
                {data.gaps.length > 0 ? ` ${data.gaps.length} gap${data.gaps.length === 1 ? "" : "s"} flagged.` : " No gaps flagged."}
              </p>
            </section>

            <section>
              <header className="section-header">
                <div className="left">
                  <span className="dot" style={{ background: "#1A8A4A" }} />
                  <h2>Coverage heatmap</h2>
                </div>
                <span className="label">{data.framework}</span>
              </header>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {data.mapping.map((entry) => (
                  <article key={entry.standardCode} className="card" style={{ borderColor: heatColour(entry.coveragePct) }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <span className="label">{entry.standardCode}</span>
                        <h3 style={{ marginTop: 6 }}>{entry.standardTitle}</h3>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span className="badge">{entry.coveragePct}% coverage</span>
                        <p className="muted" style={{ marginTop: 6 }}>
                          Pages: {entry.pageNums.length === 0 ? "—" : entry.pageNums.join(", ")}
                        </p>
                      </div>
                    </div>
                    <div className="bar-meter" style={{ marginTop: 12 }}>
                      <div className="fill" style={{ width: `${entry.coveragePct}%`, background: heatColour(entry.coveragePct) }} />
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {data.gaps.length > 0 && (
              <section style={{ marginTop: 24 }}>
                <header className="section-header">
                  <div className="left">
                    <span className="dot" style={{ background: "#D46A0A" }} />
                    <h2>Coverage gaps</h2>
                  </div>
                </header>
                <ul>
                  {data.gaps.map((gap, idx) => (
                    <li key={idx}>
                      <strong>{gap.standardCode}</strong> — <span className="muted">{gap.reason}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function heatColour(pct: number): string {
  if (pct >= 75) return "#1A8A4A";
  if (pct >= 40) return "#C49A1C";
  return "#D46A0A";
}