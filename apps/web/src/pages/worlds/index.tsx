import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { useResilientFetch } from "@/lib/useResilientFetch";

interface WorldListItem {
  id: string;
  slug: string;
  name: string;
  synopsis: string;
  accentColor: string;
  styleId: string | null;
  bookCount: number;
}

export default function WorldsIndex() {
  const { data, loading, error, stuck, retry } = useResilientFetch<{ items: WorldListItem[] }>(
    "/api/worlds",
    { tag: "[WORLDS]" }
  );
  const worlds = data?.items ?? null;

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header className="section-header">
          <div className="left">
            <span className="dot" style={{ background: "#C49A1C" }} />
            <h1>AnimBook WORLDS</h1>
          </div>
          <span className="label">Persistent animated universes</span>
        </header>

        {loading && !worlds && !error && (
          <div className="empty-state">
            Loading worlds…
            {stuck && (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    if (typeof window !== "undefined") window.location.reload();
                  }}
                >
                  Still loading? Tap to retry.
                </button>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="empty-state">
            Worlds offline · {error}
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn primary" onClick={retry}>
                Retry
              </button>
            </div>
          </div>
        )}

        {worlds && worlds.length === 0 && (
          <div className="empty-state">No worlds yet. The Lagos Nights trilogy is the first one.</div>
        )}
        {worlds && worlds.length > 0 && (
          <div className="grid">
            {worlds.map((world) => (
              <Link key={world.id} href={`/worlds/${world.slug}`} className="book-card" style={{ borderColor: world.accentColor }}>
                <div
                  className="cover"
                  style={{
                    background: `linear-gradient(135deg, ${world.accentColor}, var(--surface))`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  <span className="label" style={{ color: "var(--text)" }}>{world.bookCount} books</span>
                </div>
                <span className="by" style={{ color: world.accentColor }}>{world.styleId ?? "Painterly"}</span>
                <h3>{world.name}</h3>
                <p className="muted" style={{ fontSize: ".9rem" }}>{world.synopsis.slice(0, 140)}{world.synopsis.length > 140 ? "…" : ""}</p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}