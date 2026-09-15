import { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";

interface ArchiveProjectListItem {
  id: string;
  slug: string;
  title: string;
  steward: string;
  region: string;
  sensitivityTier: string;
  partnerOrg: string | null;
  status: string;
  bookId: string | null;
  _count?: { consents: number; culturalNotes: number };
}

export default function ArchiveIndex() {
  const [items, setItems] = useState<ArchiveProjectListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ items: ArchiveProjectListItem[] }>("/api/archive/projects");
        if (!cancelled) setItems(res.items);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
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
            <span className="dot" style={{ background: "#7A6650" }} />
            <h1>AnimBook ARCHIVE</h1>
          </div>
          <span className="label">Oral history · Cultural sensitivity pipeline</span>
        </header>

        {error && <div className="empty-state">Archive offline · {error}</div>}
        {items && items.length === 0 && (
          <div className="empty-state">No archive projects yet.</div>
        )}
        {items && items.length > 0 && (
          <div className="grid">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/archive/${item.slug}`}
                className="book-card"
                style={{ borderColor: tierColor(item.sensitivityTier) }}
              >
                <div
                  className="cover"
                  style={{
                    background: `linear-gradient(135deg, ${tierColor(item.sensitivityTier)}, var(--surface))`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  <span className="label" style={{ color: "var(--text)" }}>{item.sensitivityTier}</span>
                </div>
                <span className="by" style={{ color: tierColor(item.sensitivityTier) }}>{item.region}</span>
                <h3>{item.title}</h3>
                <p className="muted" style={{ fontSize: ".85rem" }}>{item.steward}{item.partnerOrg ? ` · ${item.partnerOrg}` : ""}</p>
                <div className="bar-meter" style={{ marginTop: 8 }}>
                  <div className="fill" style={{ width: `${Math.min(100, (item._count?.consents ?? 0) * 30 + (item._count?.culturalNotes ?? 0) * 30)}%`, background: tierColor(item.sensitivityTier) }} />
                </div>
                <span className="label">{item._count?.consents ?? 0} consent · {item._count?.culturalNotes ?? 0} notes</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function tierColor(tier: string): string {
  switch (tier) {
    case "SACRED": return "#6B2D8B";
    case "HIGH": return "#D46A0A";
    case "MEDIUM": return "#1B6B8A";
    default: return "#56738A";
  }
}