import { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";

interface CreatorProject {
  id: string;
  name: string;
  vertical: string;
  status: string;
  currentStage: string;
  expertReviewRequired: boolean;
  book?: {
    id: string;
    slug: string;
    title: string;
    status: string;
    vertical: string;
    totalPages: number;
    expertReviewStatus: string;
    requiresExpertReview: boolean;
  } | null;
}

interface RoyaltyEntry {
  id: string;
  amountCents: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  notes: string | null;
  book?: { id: string; slug: string; title: string; vertical: string };
}

export default function CreatorPortal() {
  const [projects, setProjects] = useState<CreatorProject[]>([]);
  const [royalties, setRoyalties] = useState<{ items: RoyaltyEntry[]; totalUsd: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [proj, roy] = await Promise.all([
          apiFetch<{ items: CreatorProject[] }>("/api/creator/projects"),
          apiFetch<{ items: RoyaltyEntry[]; totalUsd: string }>("/api/creator/royalties")
        ]);
        if (cancelled) return;
        setProjects(proj.items);
        setRoyalties({ items: roy.items, totalUsd: roy.totalUsd });
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <div className="empty-state">Creator portal offline · {error}</div>
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
            <span className="dot" style={{ background: "#C49A1C" }} />
            <h1>Creator Portal</h1>
          </div>
          <Link href="/studio" className="btn primary">New AnimBook</Link>
        </header>

        <section className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <Stat label="Active projects" value={projects.length} accent="#C49A1C" />
          <Stat label="Royalties (lifetime)" value={royalties ? `$${royalties.totalUsd}` : "—"} accent="#1A8A4A" />
          <Stat
            label="Awaiting review"
            value={projects.filter((p) => p.book?.requiresExpertReview && p.book?.expertReviewStatus !== "APPROVED").length}
            accent="#D46A0A"
          />
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#14818E" }} />
              <h2>Your projects</h2>
            </div>
          </header>
          {projects.length === 0 ? (
            <div className="empty-state">No Studio projects yet · open AnimBook Studio to start one.</div>
          ) : (
            <div className="grid">
              {projects.map((project) => (
                <article key={project.id} className="card" style={{ borderColor: verticalAccent(project.vertical) }}>
                  <span className="by" style={{ color: verticalAccent(project.vertical) }}>{project.vertical} · {project.status}</span>
                  <h3 style={{ marginTop: 6 }}>{project.book?.title ?? project.name}</h3>
                  <p className="muted">{project.currentStage.replace(/_/g, " ")}</p>
                  {project.book?.requiresExpertReview && (
                    <span className="badge" style={{ borderColor: project.book.expertReviewStatus === "APPROVED" ? "#1A8A4A" : "#D46A0A" }}>
                      Review · {project.book.expertReviewStatus}
                    </span>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    {project.book && (
                      <Link href={`/studio`} className="btn">
                        Open in Studio
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#1A8A4A" }} />
              <h2>Royalties</h2>
            </div>
            <span className="label">{royalties?.items.length ?? 0} entries</span>
          </header>
          {!royalties || royalties.items.length === 0 ? (
            <div className="empty-state">No royalty entries yet.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th>Period</Th>
                  <Th>Book</Th>
                  <Th>Amount</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {royalties.items.map((entry) => (
                  <tr key={entry.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td>{new Date(entry.periodStart).toLocaleDateString()} → {new Date(entry.periodEnd).toLocaleDateString()}</Td>
                    <Td>{entry.book?.title ?? "—"}</Td>
                    <Td>{(entry.amountCents / 100).toFixed(2)} {entry.currency}</Td>
                    <Td><span className="muted">{entry.notes ?? "—"}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
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

function verticalAccent(vertical: string): string {
  const map: Record<string, string> = {
    CONSUMER: "#1B6B8A",
    KIDS: "#D9872A",
    EDU: "#1A6B3C",
    FAITH: "#6B2D8B",
    DOCS: "#56738A",
    VERSE: "#9D4C73",
    COMICS: "#C94B32",
    BUSINESS: "#B58B27",
    WELLNESS: "#3F8172",
    LAW: "#7A6650",
    TRAVEL: "#14818E",
    ORIGINALS: "#C49A1C"
  };
  return map[vertical] ?? "#1B6B8A";
}