import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";

interface ArchiveDetail {
  id: string;
  slug: string;
  title: string;
  steward: string;
  region: string;
  communityContext: string | null;
  sensitivityTier: string;
  partnerOrg: string | null;
  partnerUrl: string | null;
  status: string;
  consents: {
    id: string;
    subjectName: string;
    relationship: string;
    consentText: string;
    grantedAt: string;
    expiresAt: string | null;
    scope: string;
  }[];
  culturalNotes: {
    id: string;
    category: string;
    note: string;
    iconographicConcerns: string[];
    voiceGuidance: string | null;
    reviewerName: string | null;
    createdAt: string;
  }[];
  book: { id: string; slug: string; title: string; totalPages: number; vertical: string } | null;
}

export default function ArchiveDetailPage() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : null;
  const [data, setData] = useState<ArchiveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ project: ArchiveDetail }>(`/api/archive/projects/${slug}`);
        if (!cancelled) setData(res.project);
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
          <div className="empty-state">Archive project unavailable · {error}</div>
        </main>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <div className="empty-state">Loading archive project…</div>
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
            <span className="dot" style={{ background: "#7A6650" }} />
            <h1>{data.title}</h1>
          </div>
          <Link href="/archive" className="btn">All archive projects</Link>
        </header>

        <section className="hero-banner" style={{ background: "linear-gradient(140deg, rgba(122, 102, 80, 0.25), rgba(13, 27, 46, 0.4)), var(--surface)" }}>
          <span className="label">Sensitivity · {data.sensitivityTier}</span>
          <h1 style={{ fontSize: "clamp(2.2rem, 5vw, 3.6rem)" }}>{data.title}</h1>
          <p>{data.communityContext ?? "An AnimBook ARCHIVE project."}</p>
          <p className="muted">{data.steward} · {data.region}{data.partnerOrg ? ` · ${data.partnerOrg}` : ""}</p>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="badge">{data.status}</span>
            <span className="badge">{data.consents.length} consent record{data.consents.length === 1 ? "" : "s"}</span>
            <span className="badge">{data.culturalNotes.length} cultural note{data.culturalNotes.length === 1 ? "" : "s"}</span>
          </div>
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#1A8A4A" }} />
              <h2>Consent records</h2>
            </div>
            <span className="label">Subject consent before any publication</span>
          </header>
          {data.consents.length === 0 ? (
            <div className="empty-state">No consent records yet — required before this project can publish.</div>
          ) : (
            <div className="grid">
              {data.consents.map((consent) => (
                <article key={consent.id} className="card">
                  <span className="label">{consent.scope}</span>
                  <h3 style={{ marginTop: 6 }}>{consent.subjectName}</h3>
                  <p className="muted">{consent.relationship}</p>
                  <p style={{ fontSize: ".9rem" }}>{consent.consentText}</p>
                  <span className="label">Granted {new Date(consent.grantedAt).toLocaleDateString()}</span>
                </article>
              ))}
            </div>
          )}
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#9D4C73" }} />
              <h2>Cultural sensitivity notes</h2>
            </div>
            <span className="label">Iconography · Language · Voice · Provenance</span>
          </header>
          {data.culturalNotes.length === 0 ? (
            <div className="empty-state">No cultural notes yet.</div>
          ) : (
            <div className="grid">
              {data.culturalNotes.map((note) => (
                <article key={note.id} className="card" style={{ borderColor: "#9D4C73" }}>
                  <span className="label">{note.category}</span>
                  <h3 style={{ marginTop: 6 }}>{note.reviewerName ?? "Cultural reviewer"}</h3>
                  <p style={{ fontSize: ".9rem" }}>{note.note}</p>
                  {note.voiceGuidance && (
                    <p className="muted" style={{ fontSize: ".85rem", marginTop: 6 }}>Voice: {note.voiceGuidance}</p>
                  )}
                  {note.iconographicConcerns.length > 0 && (
                    <div className="world-strip">
                      {note.iconographicConcerns.map((concern) => (
                        <span key={concern} className="world-pill" style={{ color: "#D46A0A" }}>{concern}</span>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        {data.book && (
          <section style={{ marginTop: 24 }}>
            <header className="section-header">
              <div className="left">
                <span className="dot" style={{ background: "#1B6B8A" }} />
                <h2>Published AnimBook</h2>
              </div>
            </header>
            <Link href={`/book/${data.book.slug}`} className="book-card" style={{ display: "block", maxWidth: 320 }}>
              <span className="by">{data.book.vertical}</span>
              <h3>{data.book.title}</h3>
              <span className="label">{data.book.totalPages} pages</span>
            </Link>
          </section>
        )}
      </main>
    </div>
  );
}