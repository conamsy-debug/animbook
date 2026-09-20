import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/lib/store";
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

interface EduBook {
  id: string;
  slug: string;
  title: string;
  totalPages: number;
}

interface InstitutionDetail {
  institution: { id: string; name: string; type: string; seatCount: number; licenseExpiresAt: string | null };
  seatedUserIds: string[];
}

export default function TeacherDashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [students, setStudents] = useState<StudentRecord[] | null>(null);
  const [eduBooks, setEduBooks] = useState<EduBook[]>([]);
  const [selectedBookSlug, setSelectedBookSlug] = useState<string | null>(null);
  const [institutionDetail, setInstitutionDetail] = useState<InstitutionDetail | null>(null);
  const [seatedStudents, setSeatedStudents] = useState<{ id: string; name: string; email: string }[]>([]);
  const [seatEmail, setSeatEmail] = useState("");
  const [seatStatus, setSeatStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectionMode, setProjectionMode] = useState(false);
  const toast = useToastStore((s) => s.push);

  /** Load dashboard + roster + available EDU books once on mount.
   *  Wrapped in a 12s timeout so a hung API (Railway restart, 502)
   *  doesn't leave the dashboard on "Loading class analytics…" forever. */
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [dash, roster, books] = await Promise.all([
          apiFetch<DashboardResponse>("/api/edu/teacher/dashboard").catch(() => null),
          apiFetch<{ students: StudentRecord[] }>("/api/edu/teacher/students").catch(() => null),
          apiFetch<{ items: EduBook[] }>("/api/books?vertical=EDU&status=PUBLISHED&limit=20").catch(() => null)
        ]);
        if (cancelled) return;
        if (dash) {
          setData(dash);
          setSelectedBookSlug(dash.summary.bookSlug);
        } else {
          // No data + no error means the API returned a non-200 that
          // the .catch swallowed into null. Surface it as a soft error.
          setError("Teacher dashboard API is offline. Try again in a moment.");
        }
        setStudents(roster?.students ?? []);
        setEduBooks(books?.items ?? []);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    const timeout = window.setTimeout(() => {
      if (!cancelled) setError("Teacher dashboard is taking longer than expected. The API may be down — try again in a moment.");
    }, 12_000);
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  /** If the teacher has an institution, hydrate its detail (seats + roster). */
  const institutionId = data?.institutions?.[0]?.id ?? null;
  useEffect(() => {
    if (!institutionId) return;
    let cancelled = false;
    async function load() {
      try {
        const detail = await apiFetch<InstitutionDetail>(`/api/institutions/${institutionId}`);
        if (cancelled) return;
        setInstitutionDetail(detail);
        const seats = await apiFetch<{ seatedUserIds: string[]; students: { id: string; name: string; email: string }[] }>(`/api/institutions/${institutionId}/seats`);
        if (!cancelled) setSeatedStudents(seats.students);
      } catch (err) {
        // Non-fatal — the dashboard already shows what it can.
        if (!cancelled) console.warn("Institution hydrate failed:", err);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [institutionId]);

  async function seatStudent() {
    if (!institutionId || !seatEmail.trim()) return;
    setSeatStatus(null);
    try {
      await apiFetch(`/api/institutions/${institutionId}/seats`, {
        method: "POST",
        json: { studentEmail: seatEmail.trim().toLowerCase() }
      });
      setSeatStatus({ ok: true, msg: `${seatEmail} seated.` });
      setSeatEmail("");
      // refresh seats
      const seats = await apiFetch<{ students: { id: string; name: string; email: string }[] }>(`/api/institutions/${institutionId}/seats`);
      setSeatedStudents(seats.students);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSeatStatus({ ok: false, msg });
    }
  }

  async function unseatStudent(studentId: string) {
    if (!institutionId) return;
    await apiFetch(`/api/institutions/${institutionId}/seats/${studentId}`, { method: "DELETE" });
    setSeatedStudents((prev) => prev.filter((s) => s.id !== studentId));
  }

  const frameworkPills = useMemo(() => data?.frameworks ?? [], [data]);

  async function startProjection() {
    if (!data) return;
    try {
      const res = await apiFetch<{ sessionId: string; bookSlug: string; attendeeUrl: string; pageNum: number }>("/api/edu/classroom/projection", {
        method: "POST",
        json: {
          bookSlug: data.summary.bookSlug,
          pageNum: 1
        }
      });
      if (typeof window !== "undefined") {
        // Teacher drives via Live. Attendee URL opens the Live page that
        // auto-subscribes to page.flipped events; share that link with
        // the class and they'll see every flip as it happens.
        const host = window.open(`/live/${res.sessionId}`, "_blank", "noopener,noreferrer");
        if (!host) setProjectionMode(true);
        try {
          await navigator.clipboard?.writeText(`${window.location.origin}${res.attendeeUrl}`);
          toast(`Live session started · attendee link copied`);
        } catch {
          toast(`Live session started · share ${res.attendeeUrl}`);
        }
      }
    } catch (err) {
      // Projection failure should NOT take down the dashboard — surface
      // it as a toast and leave the rest of the analytics intact.
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Could not start projection: ${msg}`);
    }
  }

  if (error) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <div className="empty-state">
            Teacher dashboard offline · {error}
            <div style={{ marginTop: 16 }}>
              <button type="button" className="btn primary" onClick={() => {
                setError(null);
                setData(null);
                setSelectedBookSlug(null);
                // Force a remount by reloading — simpler than threading a
                // refresh key through every effect.
                if (typeof window !== "undefined") window.location.reload();
              }}>
                Retry
              </button>
            </div>
          </div>
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

  const seatRemaining = institutionDetail ? Math.max(0, institutionDetail.institution.seatCount - seatedStudents.length) : null;

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header className="section-header">
          <div className="left">
            <span className="dot" style={{ background: "#1A6B3C" }} />
            <h1>Teacher Dashboard</h1>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {eduBooks.length > 0 ? (
              <select
                value={selectedBookSlug ?? data.summary.bookSlug}
                onChange={(e) => setSelectedBookSlug(e.target.value)}
                style={{ minWidth: 200 }}
              >
                {eduBooks.map((b) => (
                  <option key={b.id} value={b.slug}>{b.title}</option>
                ))}
              </select>
            ) : (
              <span className="badge">{data.summary.bookTitle}</span>
            )}
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

        {institutionDetail && (
          <section className="card" style={{ marginTop: 16, borderColor: "#1A6B3C" }}>
            <h3>{institutionDetail.institution.name}</h3>
            <p className="muted" style={{ marginBottom: 12 }}>
              {seatedStudents.length} / {institutionDetail.institution.seatCount} seats filled
              {seatRemaining !== null && seatRemaining <= 5 && seatRemaining > 0 && (
                <span style={{ color: "#C49A1C" }}> · {seatRemaining} seat{seatRemaining === 1 ? "" : "s"} left</span>
              )}
              {seatRemaining === 0 && (
                <span style={{ color: "#D46A0A" }}> · at capacity</span>
              )}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="email"
                placeholder="seat@school.edu"
                value={seatEmail}
                onChange={(e) => setSeatEmail(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="button" className="btn primary" onClick={seatStudent} disabled={!seatEmail.trim()}>
                Seat student
              </button>
            </div>
            {seatStatus && (
              <p style={{ color: seatStatus.ok ? "var(--wellness)" : "var(--comics)", marginTop: 8 }}>
                {seatStatus.msg}
              </p>
            )}
            {seatedStudents.length > 0 && (
              <ul style={{ marginTop: 12, listStyle: "none", padding: 0 }}>
                {seatedStudents.map((s) => (
                  <li key={s.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                    <span><strong>{s.name}</strong> <span className="muted">· {s.email}</span></span>
                    <button type="button" className="btn ghost" onClick={() => unseatStudent(s.id)}>Release</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

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