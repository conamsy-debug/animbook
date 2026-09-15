import { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";

interface PublisherListItem {
  id: string;
  name: string;
  contactEmail: string;
  revenueSharePct: number;
  createdAt: string;
  _count?: { books: number };
}

interface DashboardData {
  publisher: PublisherListItem & { books: { id: string; slug: string; title: string; author: string; vertical: string; status: string; totalPages: number; language: string }[] };
  bookCount: number;
  totalRevenueCents: number;
  payoutCents: number;
  payoutUsd: string;
}

export default function PublishersPage() {
  const [publishers, setPublishers] = useState<PublisherListItem[]>([]);
  const [selected, setSelected] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await apiFetch<{ items: PublisherListItem[] }>("/api/publishers");
      if (cancelled) return;
      setPublishers(res.items);
      if (res.items.length > 0) {
        const dash = await apiFetch<DashboardData>(`/api/publishers/${res.items[0]!.id}/dashboard`);
        if (!cancelled) setSelected(dash);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function pickPublisher(id: string) {
    const dash = await apiFetch<DashboardData>(`/api/publishers/${id}/dashboard`);
    setSelected(dash);
  }

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header className="section-header">
          <div className="left">
            <span className="dot" style={{ background: "#B58B27" }} />
            <h1>Publisher Portal</h1>
          </div>
          <Link href="/creator" className="btn">Creator view</Link>
        </header>

        <section className="grid">
          {publishers.map((pub) => (
            <button
              key={pub.id}
              type="button"
              className="book-card"
              style={{ alignItems: "flex-start", textAlign: "left", borderColor: selected?.publisher.id === pub.id ? "#B58B27" : undefined }}
              onClick={() => pickPublisher(pub.id)}
            >
              <span className="by">{pub._count?.books ?? 0} books · {pub.revenueSharePct}% rev share</span>
              <h3>{pub.name}</h3>
              <p className="muted" style={{ fontSize: ".85rem" }}>{pub.contactEmail}</p>
            </button>
          ))}
        </section>

        {loading && <div className="empty-state">Loading publisher dashboard…</div>}
        {selected && (
          <section style={{ marginTop: 24 }}>
            <header className="section-header">
              <div className="left">
                <span className="dot" style={{ background: "#1A8A4A" }} />
                <h2>{selected.publisher.name} · Licensing dashboard</h2>
              </div>
              <span className="label">Last 50 royalty entries</span>
            </header>

            <section className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <Stat label="Books under contract" value={selected.bookCount} accent="#14818E" />
              <Stat label="Total revenue" value={`$${(selected.totalRevenueCents / 100).toFixed(2)}`} accent="#C49A1C" />
              <Stat label={`Payout @ ${selected.publisher.revenueSharePct}%`} value={`$${selected.payoutUsd}`} accent="#1A8A4A" />
            </section>

            <div className="grid" style={{ marginTop: 16 }}>
              {selected.publisher.books.map((book) => (
                <article key={book.id} className="card">
                  <span className="label">{book.vertical} · {book.status}</span>
                  <h3 style={{ marginTop: 6 }}>{book.title}</h3>
                  <p className="muted">by {book.author}</p>
                  <p className="muted" style={{ fontSize: ".85rem" }}>{book.totalPages} pages · {book.language.toUpperCase()}</p>
                  <Link href={`/book/${book.slug}`} className="btn" style={{ marginTop: 8 }}>View</Link>
                </article>
              ))}
            </div>
          </section>
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