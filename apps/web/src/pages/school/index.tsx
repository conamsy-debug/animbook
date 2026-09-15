import { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";

interface ClassroomListItem {
  id: string;
  slug: string;
  name: string;
  schoolName: string | null;
  gradeBand: string | null;
  teacher: { id: string; name: string };
  _count?: { members: number; assignments: number };
}

export default function SchoolIndex() {
  const [items, setItems] = useState<ClassroomListItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ items: ClassroomListItem[] }>("/api/school/classrooms");
        if (!cancelled) setItems(res.items);
      } catch (err) {
        if (!cancelled) console.warn(err);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

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

        {items && items.length === 0 && (
          <div className="empty-state">No classrooms yet.</div>
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
                <p className="muted">Teacher · {item.teacher.name}</p>
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