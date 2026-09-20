import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { apiFetch, ApiError } from "@/lib/api";

interface ClassroomDetail {
  id: string;
  slug: string;
  name: string;
  schoolName: string | null;
  gradeBand: string | null;
  teacher: { id: string; name: string; email: string };
  members: { id: string; role: string; student: { id: string; name: string; email: string } }[];
  assignments: { id: string; title: string; brief: string; status: string; createdAt: string; _count?: { submissions: number } }[];
}

interface LibraryItem {
  id: string;
  slug: string;
  title: string;
  author: string;
  vertical: string;
  coverUrl: string | null;
  synopsis: string;
  totalPages: number;
}

interface StudioProjectLite {
  id: string;
  name: string;
  status: string;
  book: { id: string; slug: string; title: string; coverUrl: string | null; totalPages: number } | null;
}

export default function ClassroomPage() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : null;
  const [data, setData] = useState<ClassroomDetail | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Teacher forms
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [assignForm, setAssignForm] = useState({ title: "", brief: "", dueAt: "" });
  const [assignStatus, setAssignStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Student form
  const [myProjects, setMyProjects] = useState<StudioProjectLite[]>([]);
  const [submitForm, setSubmitForm] = useState<{ assignmentId: string; studioProjectId: string; pageCount: number }>({ assignmentId: "", studioProjectId: "", pageCount: 1 });
  const [submitStatus, setSubmitStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  async function refresh() {
    if (!slug) return;
    try {
      const [classroom, libraryRes] = await Promise.all([
        apiFetch<{ classroom: ClassroomDetail; role: string }>(`/api/school/classrooms/${slug}`),
        apiFetch<{ items: LibraryItem[] }>(`/api/school/classrooms/${slug}/library`)
      ]);
      setData(classroom.classroom);
      setRole(classroom.role);
      setLibrary(libraryRes.items);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    async function load() {
      try {
        const [classroom, libraryRes] = await Promise.all([
          apiFetch<{ classroom: ClassroomDetail; role: string }>(`/api/school/classrooms/${slug}`),
          apiFetch<{ items: LibraryItem[] }>(`/api/school/classrooms/${slug}/library`)
        ]);
        if (cancelled) return;
        setData(classroom.classroom);
        setRole(classroom.role);
        setLibrary(libraryRes.items);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Load the student's own studio projects once we know they're a student.
  useEffect(() => {
    if (role !== "STUDENT") return;
    apiFetch<{ items: StudioProjectLite[] }>("/api/studio/projects")
      .then((res) => setMyProjects(res.items))
      .catch(() => undefined);
  }, [role]);

  async function inviteStudent() {
    setInviteStatus(null);
    if (!inviteEmail.trim()) {
      setInviteStatus({ ok: false, msg: "Email is required" });
      return;
    }
    try {
      await apiFetch(`/api/school/classrooms/${slug}/members`, {
        method: "POST",
        json: { studentEmail: inviteEmail.trim().toLowerCase() }
      });
      setInviteStatus({ ok: true, msg: `${inviteEmail} joined the classroom.` });
      setInviteEmail("");
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? (err.details as { error?: string })?.error ?? err.message : (err as Error).message;
      setInviteStatus({ ok: false, msg });
    }
  }

  async function postAssignment() {
    setAssignStatus(null);
    if (!assignForm.title.trim() || !assignForm.brief.trim()) {
      setAssignStatus({ ok: false, msg: "Title and brief are required" });
      return;
    }
    try {
      await apiFetch(`/api/school/classrooms/${slug}/assignments`, {
        method: "POST",
        json: {
          title: assignForm.title.trim(),
          brief: assignForm.brief.trim(),
          dueAt: assignForm.dueAt ? new Date(assignForm.dueAt).toISOString() : undefined
        }
      });
      setAssignStatus({ ok: true, msg: `Assignment "${assignForm.title}" posted.` });
      setAssignForm({ title: "", brief: "", dueAt: "" });
      await refresh();
    } catch (err) {
      setAssignStatus({ ok: false, msg: (err as Error).message });
    }
  }

  async function submitAssignment() {
    if (!submitForm.assignmentId) return;
    setSubmitStatus(null);
    try {
      await apiFetch(`/api/school/assignments/${submitForm.assignmentId}/submit`, {
        method: "POST",
        json: {
          studioProjectId: submitForm.studioProjectId || undefined,
          pageCount: Math.max(1, Number(submitForm.pageCount) || 1)
        }
      });
      setSubmitStatus({ ok: true, msg: "Submitted. Your teacher can review it now." });
      await refresh();
    } catch (err) {
      setSubmitStatus({ ok: false, msg: (err as Error).message });
    }
  }

  if (error) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <div className="empty-state">Classroom offline · {error}</div>
        </main>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <div className="empty-state">Loading classroom…</div>
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
            <h1>{data.name}</h1>
          </div>
          <span className="label">{role === "TEACHER" ? "Teacher view" : "Student view"}</span>
        </header>

        <section className="card">
          <h3>Classroom</h3>
          <dl className="kvp">
            <dt>School</dt>
            <dd>{data.schoolName ?? "—"}</dd>
            <dt>Grade</dt>
            <dd>{data.gradeBand ?? "—"}</dd>
            <dt>Teacher</dt>
            <dd>{data.teacher.name}</dd>
            <dt>Students</dt>
            <dd>{data.members.length}</dd>
            <dt>Slug</dt>
            <dd><code>{data.slug}</code></dd>
          </dl>
        </section>

        {role === "TEACHER" && (
          <>
            <section className="card" style={{ marginTop: 16, borderColor: "#1A6B3C" }}>
              <h3>Invite a student</h3>
              <p className="muted">By email. The student must already have an AnimBook account; joining this classroom makes it a school account.</p>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input
                  type="email"
                  placeholder="student@school.edu"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn primary" onClick={inviteStudent}>Invite</button>
              </div>
              {inviteStatus && (
                <p style={{ color: inviteStatus.ok ? "var(--wellness)" : "var(--comics)", marginTop: 8 }}>
                  {inviteStatus.msg}
                </p>
              )}
            </section>

            <section className="card" style={{ marginTop: 16, borderColor: "#1A6B3C" }}>
              <h3>Post an assignment</h3>
              <p className="muted">Brief + optional due date. Students see it on their dashboard and submit a Studio project.</p>
              <label style={{ display: "block", marginTop: 8 }}>
                <span className="label">Title</span>
                <input
                  value={assignForm.title}
                  onChange={(e) => setAssignForm({ ...assignForm, title: e.target.value })}
                  placeholder="Write a 4-page bedtime story"
                />
              </label>
              <label style={{ display: "block", marginTop: 8 }}>
                <span className="label">Brief</span>
                <textarea
                  rows={3}
                  value={assignForm.brief}
                  onChange={(e) => setAssignForm({ ...assignForm, brief: e.target.value })}
                  placeholder="Use any 3 of the 5 senses on every page. End with a soft landing."
                />
              </label>
              <label style={{ display: "block", marginTop: 8 }}>
                <span className="label">Due date (optional)</span>
                <input
                  type="datetime-local"
                  value={assignForm.dueAt}
                  onChange={(e) => setAssignForm({ ...assignForm, dueAt: e.target.value })}
                />
              </label>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="button" className="btn primary" onClick={postAssignment}>Post assignment</button>
              </div>
              {assignStatus && (
                <p style={{ color: assignStatus.ok ? "var(--wellness)" : "var(--comics)", marginTop: 8 }}>
                  {assignStatus.msg}
                </p>
              )}
            </section>
          </>
        )}

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#14818E" }} />
              <h2>Roster</h2>
            </div>
            <span className="label">{data.members.length} members</span>
          </header>
          <div className="grid">
            {data.members.map((m) => (
              <article key={m.id} className="card">
                <span className="label">{m.role}</span>
                <h3 style={{ marginTop: 6 }}>{m.student.name}</h3>
                <p className="muted">{m.student.email}</p>
              </article>
            ))}
            {data.members.length === 0 && (
              <p className="muted">{role === "TEACHER" ? "No students yet — invite one above." : "Your classroom has no other students yet."}</p>
            )}
          </div>
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#C49A1C" }} />
              <h2>Assignments</h2>
            </div>
          </header>
          {data.assignments.length === 0 ? (
            <div className="empty-state">No assignments yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.assignments.map((a) => (
                <article key={a.id} className="card" style={{ borderColor: "#1A6B3C" }}>
                  <span className="label">{a.status} · {a._count?.submissions ?? 0} submissions</span>
                  <h3 style={{ marginTop: 6 }}>{a.title}</h3>
                  <p>{a.brief}</p>
                  {role === "STUDENT" && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: "pointer", color: "var(--accent, #C49A1C)" }}>Submit your AnimBook</summary>
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        <select
                          value={submitForm.studioProjectId}
                          onChange={(e) => setSubmitForm({ ...submitForm, assignmentId: a.id, studioProjectId: e.target.value })}
                        >
                          <option value="">(no Studio project)</option>
                          {myProjects.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}{p.book ? ` → ${p.book.title}` : ""}</option>
                          ))}
                        </select>
                        <label>
                          <span className="label">Page count</span>
                          <input
                            type="number"
                            min={1}
                            value={submitForm.pageCount}
                            onChange={(e) => setSubmitForm({ ...submitForm, pageCount: Math.max(1, Number(e.target.value) || 1) })}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => {
                            setSubmitForm({ ...submitForm, assignmentId: a.id });
                            void submitAssignment();
                          }}
                        >
                          Submit for {a.title}
                        </button>
                      </div>
                    </details>
                  )}
                </article>
              ))}
              {submitStatus && (
                <p style={{ color: submitStatus.ok ? "var(--wellness)" : "var(--comics)", marginTop: 4 }}>
                  {submitStatus.msg}
                </p>
              )}
            </div>
          )}
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#1B6B8A" }} />
              <h2>Class library</h2>
            </div>
            <span className="label">{library?.length ?? 0} curated books</span>
          </header>
          {library && library.length === 0 && (
            <div className="empty-state">No books in the class library yet.</div>
          )}
          {library && library.length > 0 && (
            <div className="grid">
              {library.map((book) => (
                <Link key={book.id} href={`/book/${book.slug}`} className="book-card">
                  <div className="cover" style={{ backgroundImage: book.coverUrl ? `url(${book.coverUrl})` : undefined }} />
                  <span className="by" style={{ color: "#1B6B8A" }}>{book.vertical} · {book.author}</span>
                  <h3>{book.title}</h3>
                  <p className="muted">{book.synopsis.slice(0, 110)}{book.synopsis.length > 110 ? "…" : ""}</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
