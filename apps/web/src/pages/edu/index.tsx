import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";
import type { TeacherDashboardSummary } from "../../domain/index.js";

interface DashboardResponse {
  summary: TeacherDashboardSummary;
  institutions: { id: string; name: string; seatCount: number }[];
  frameworks: string[];
}

interface StudentRecord {
  id: string;
  name: string;
  email: string;
  attempts: number;
  accuracy: number;
  avgTimeSeconds: number;
}

export default function TeacherDashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [students, setStudents] = useState<StudentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectionMode, setProjectionMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [dash, roster] = await Promise.all([
          apiFetch<DashboardResponse>("/api/edu/teacher/dashboard"),
          apiFetch<{ students: StudentRecord[] }>("/api/edu/teacher/students")
        ]);
        if (cancelled) return;
        setData(dash);
        setStudents(roster.students);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const frameworkPills = useMemo(() => data?.frameworks ?? [], [data]);

  async function startProjection() {
    if (!data) return;
    try {
      const res = await apiFetch<{ session: string; bookSlug: string; pageNum: number }>("/api/edu/classroom/projection", {
        method: "POST",
        json: {
          bookSlug: data.summary.bookSlug,
          pageNum: 1,
          sessionToken: `classroom-${Date.now()}`
        }
      });
      if (typeof window !== "undefined") {
        const projectionWindow = window.open(`/read/${res.bookSlug}?projection=${res.session}`, "_blank", "noopener,noreferrer");
        if (!projectionWindow) setProjectionMode(true);
      }
    } catch (err) {
      setError(`Could not start projection: ${(err as Error).message}`);
    }
  }

  if (error) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <div className="empty-state">Teacher dashboard offline · {error}</div>
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <div className="empty-state">Loading class analytics…</div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header className="section-header">
          <div className="left">
            <span className="dot" style={{ background: "#1A6B3C" }} />
            <h1>Teacher Dashboard</h1>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <span className="badge">{data.summary.bookTitle}</span>
            <Link href={`/edu/curriculum/${data.summary.bookSlug}`} className="btn">
              Curriculum map
            </Link>
            <button type="button" className="btn primary" onClick={startProjection}>
              Start classroom projection
            </button>
          </div>
        </header>

        <section className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <Stat label="Class size" value={data.summary.classSize} accent="#1A6B3C" />
          <Stat label="Active students" value={data.summary.activeStudents} accent="#14818E" />
          <Stat label="Avg progress" value={`${data.summary.averageProgress}%`} accent="#C49A1C" />
          <Stat label="Avg accuracy" value={`${data.summary.averageAccuracy}%`} accent="#1A8A4A" />
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#D46A0A" }} />
              <h2>Flagged pages</h2>
            </div>
            <span className="label">Pages where the class accuracy fell below 60%</span>
          </header>
          {data.summary.flaggedPages.length === 0 ? (
            <div className="empty-state">No flagged pages yet · the class is on track.</div>
          ) : (
            <div className="grid">
              {data.summary.flaggedPages.map((page) => (
                <article key={page.pageNum} className="card" style={{ borderColor: "#D46A0A" }}>
                  <span className="label">Page {page.pageNum}</span>
                  <h3 style={{ marginTop: 6 }}>{Math.round(page.accuracy * 100)}% accuracy</h3>
                  <p className="muted">{page.attempts} attempts · needs scaffolding</p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#0A7B8A" }} />
              <h2>Roster</h2>
            </div>
            <span className="label">{students?.length ?? 0} students with checkpoint responses</span>
          </header>
          {students && students.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th>Attempts</Th>
                  <Th>Accuracy</Th>
                  <Th>Avg time</Th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td>
                      <strong>{student.name}</strong>
                      <div className="muted">{student.email}</div>
                    </Td>
                    <Td>{student.attempts}</Td>
                    <Td>{student.accuracy}%</Td>
                    <Td>{student.avgTimeSeconds}s</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">No checkpoint responses yet. Ask students to read the AnimBook.</div>
          )}
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#6B2D8B" }} />
              <h2>Live responses</h2>
            </div>
            <span className="label">Most recent 20</span>
          </header>
          {data.summary.recentResponses.length === 0 ? (
            <div className="empty-state">No recent responses.</div>
          ) : (
            <ul className="timeline">
              {data.summary.recentResponses.map((response, idx) => (
                <li key={idx} className="row">
                  <strong>{response.studentName} · page {response.pageNum}</strong>
                  <span>{response.questionType} · {response.isCorrect ? "✓" : "✗"} · {response.timeTakenSeconds}s · {new Date(response.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#14818E" }} />
              <h2>Curriculum frameworks</h2>
            </div>
          </header>
          <div className="world-strip">
            {frameworkPills.map((fw) => (
              <span key={fw} className="world-pill" style={{ color: "#1A6B3C" }}>{fw}</span>
            ))}
          </div>
        </section>

        {projectionMode && (
          <div className="toast">Classroom projection armed — open the reader in full-screen to drive the class.</div>
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ textAlign: "left", padding: "8px 12px", fontFamily: "var(--mono)", fontSize: ".7rem", letterSpacing: ".16em", textTransform: "uppercase", color: "var(--text-muted)" }}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "8px 12px", verticalAlign: "top" }}>{children}</td>;
}