import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";

interface WorldMember {
  id: string;
  ordinal: number;
  sharedCharacters: string[];
  book: {
    id: string;
    slug: string;
    title: string;
    author: string;
    vertical: string;
    language: string;
    totalPages: number;
    coverUrl: string | null;
    synopsis: string;
  };
}

interface WorldDetail {
  id: string;
  slug: string;
  name: string;
  synopsis: string;
  accentColor: string;
  styleId: string | null;
  members: WorldMember[];
}

export default function WorldDetailPage() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : null;
  const [world, setWorld] = useState<WorldDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ world: WorldDetail }>(`/api/worlds/${slug}`);
        if (!cancelled) setWorld(res.world);
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
          <div className="empty-state">World not found · {error}</div>
        </main>
      </div>
    );
  }
  if (!world) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <div className="empty-state">Loading world…</div>
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
            <span className="dot" style={{ background: world.accentColor }} />
            <h1>{world.name}</h1>
          </div>
          <Link href="/worlds" className="btn">All worlds</Link>
        </header>

        <section className="hero-banner" style={{ background: `linear-gradient(140deg, ${world.accentColor}40, rgba(196, 154, 28, 0.12)), var(--surface)` }}>
          <span className="label">{world.styleId ?? "Painterly"}</span>
          <h1 style={{ fontSize: "clamp(2.2rem, 5vw, 3.6rem)" }}>{world.name}</h1>
          <p>{world.synopsis}</p>
          <p className="muted">{world.members.length} books · {world.members[0]?.sharedCharacters?.length ?? 0} shared characters</p>
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: world.accentColor }} />
              <h2>Books in this world</h2>
            </div>
          </header>
          <div className="grid">
            {world.members.map((member) => (
              <Link key={member.id} href={`/book/${member.book.slug}`} className="book-card" style={{ borderColor: world.accentColor }}>
                <div className="cover" style={{ backgroundImage: member.book.coverUrl ? `url(${member.book.coverUrl})` : undefined }} />
                <span className="by" style={{ color: world.accentColor }}>Book {member.ordinal + 1} · {member.book.vertical}</span>
                <h3>{member.book.title}</h3>
                <p className="muted">{member.book.synopsis.slice(0, 110)}{member.book.synopsis.length > 110 ? "…" : ""}</p>
                <span className="label">{member.book.totalPages} pages</span>
              </Link>
            ))}
          </div>
        </section>

        {world.members[0]?.sharedCharacters && world.members[0].sharedCharacters.length > 0 && (
          <section style={{ marginTop: 24 }}>
            <header className="section-header">
              <div className="left">
                <span className="dot" style={{ background: "#9D4C73" }} />
                <h2>Shared characters</h2>
              </div>
              <span className="label">The recurring cast</span>
            </header>
            <div className="world-strip">
              {world.members[0].sharedCharacters.map((character) => (
                <span key={character} className="world-pill" style={{ color: world.accentColor }}>{character}</span>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}