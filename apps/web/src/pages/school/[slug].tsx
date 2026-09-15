import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";

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

export default function ClassroomPage() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : null;
  const [data, setData] = useState<ClassroomDetail | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          </dl>
        </section>

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
                </article>
              ))}
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