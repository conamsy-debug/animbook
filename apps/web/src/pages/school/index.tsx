import { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { apiFetch, ApiError } from "@/lib/api";

interface ClassroomListItem {
  id: string;
  slug: string;
  name: string;
  schoolName: string | null;
  gradeBand: string | null;
  teacher?: { id: string; name: string };
  _count?: { members: number; assignments: number };
}

interface UserProfile {
  id: string;
  roles: string[];
}

export default function SchoolIndex() {
  const [items, setItems] = useState<ClassroomListItem[] | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", slug: "", schoolName: "", gradeBand: "" });
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<{ items: ClassroomListItem[] }>("/api/school/classrooms").catch(() => null),
      apiFetch<{ user: UserProfile }>("/api/school/me").catch(() => null)
    ]).then(([classrooms, me]) => {
      if (cancelled) return;
      setItems(classrooms?.items ?? []);
      setUser(me?.user ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const isTeacher = !!user?.roles?.includes("teacher");

  async function createClassroom() {
    if (busy) return;
    setBusy(true);
    setCreateError(null);
    try {
      await apiFetch("/api/school/classrooms", {
        method: "POST",
        json: {
          name: createForm.name.trim(),
          slug: createForm.slug.trim().toLowerCase(),
          schoolName: createForm.schoolName.trim() || undefined,
          gradeBand: createForm.gradeBand.trim() || undefined
        }
      });
      // Refresh list
      const res = await apiFetch<{ items: ClassroomListItem[] }>("/api/school/classrooms");
      setItems(res.items);
      setCreateForm({ name: "", slug: "", schoolName: "", gradeBand: "" });
      setCreating(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setCreateError("Your account isn't a teacher yet. Ask an admin to grant the role.");
      } else {
        setCreateError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header className="section-header">
          <div className="left">
            <span className="dot" style={{ background: "#1A6B3C" }} />
            <h1>AnimBook SCHOOL</h1>
          </div>
          <span className="label">Students as AnimBook creators</span>
        </header>

        {isTeacher && (
          <section className="card" style={{ marginBottom: 16, borderColor: "#1A6B3C" }}>
            {creating ? (
              <>
                <h3>Create a classroom</h3>
                <p className="muted">Teachers-only. Name it, slug it, share the slug with students.</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                  <label>
                    <span className="label">Class name</span>
                    <input
                      value={createForm.name}
                      onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                      placeholder="Year 8 Storytelling"
                    />
                  </label>
                  <label>
                    <span className="label">Slug (kebab-case)</span>
                    <input
                      value={createForm.slug}
                      onChange={(e) => setCreateForm({ ...createForm, slug: e.target.value })}
                      placeholder="year-8-storytelling"
                    />
                  </label>
                  <label>
                    <span className="label">School (optional)</span>
                    <input
                      value={createForm.schoolName}
                      onChange={(e) => setCreateForm({ ...createForm, schoolName: e.target.value })}
                      placeholder="Greenhill Academy"
                    />
                  </label>
                  <label>
                    <span className="label">Grade band (optional)</span>
                    <input
                      value={createForm.gradeBand}
                      onChange={(e) => setCreateForm({ ...createForm, gradeBand: e.target.value })}
                      placeholder="Year 8 / Age 13"
                    />
                  </label>
                </div>
                {createError && <p style={{ color: "var(--comics)", marginTop: 8 }}>{createError}</p>}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button type="button" className="btn primary" onClick={createClassroom} disabled={busy || !createForm.name || !createForm.slug}>
                    {busy ? "Creating…" : "Create classroom"}
                  </button>
                  <button type="button" className="btn" onClick={() => { setCreating(false); setCreateError(null); }}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>Teacher controls</h3>
                <p className="muted">You're signed in as a teacher. Spin up a new classroom in seconds.</p>
                <button type="button" className="btn primary" onClick={() => setCreating(true)} style={{ marginTop: 8 }}>
                  + Create classroom
                </button>
              </>
            )}
          </section>
        )}

        {!isTeacher && items && items.length === 0 && (
          <div className="empty-state">
            No classrooms yet. Ask your teacher to share a classroom slug, or apply for the teacher role.
          </div>
        )}
        {items && items.length > 0 && (
          <div className="grid">
            {items.map((item) => (
              <Link key={item.id} href={`/school/${item.slug}`} className="book-card" style={{ borderColor: "#1A6B3C" }}>
                <div
                  className="cover"
                  style={{
                    background: "linear-gradient(135deg, #1A6B3C, var(--surface))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  <span className="label" style={{ color: "var(--text)" }}>{item._count?.members ?? 0} students</span>
                </div>
                <span className="by" style={{ color: "#1A6B3C" }}>{item.schoolName ?? "Classroom"} · Grade {item.gradeBand ?? "—"}</span>
                <h3>{item.name}</h3>
                <p className="muted">Teacher · {item.teacher?.name ?? "—"}</p>
                <span className="label">{item._count?.assignments ?? 0} assignments</span>
              </Link>
            ))}
          </div>
        )}

        <section style={{ marginTop: 32 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#C49A1C" }} />
              <h2>How SCHOOL works</h2>
            </div>
          </header>
          <div className="grid">
            <article className="card">
              <h3>1 · Teacher creates a classroom</h3>
              <p className="muted">Name the class, share the slug with students, set the grade band.</p>
            </article>
            <article className="card">
              <h3>2 · Invite students</h3>
              <p className="muted">Students join by email; each gets a Library and Assignment queue.</p>
            </article>
            <article className="card">
              <h3>3 · Post an assignment</h3>
              <p className="muted">Brief + rubric + due date. Students create AnimBooks with the Studio.</p>
            </article>
            <article className="card">
              <h3>4 · Students submit</h3>
              <p className="muted">The submitted AnimBook lands in the class library for peer reading.</p>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}
