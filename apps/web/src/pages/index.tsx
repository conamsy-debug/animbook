import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { BookCard } from "@/components/BookCard";
import { HeroActions } from "@/components/HeroActions";
import { HeroPreview } from "@/components/HeroPreview";
import { LoadingState } from "@/components/States";
import { apiFetch, type BookSummary } from "@/lib/api";
import { VERTICALS } from "@/lib/verticals";

const FEATURES: { tag: string; title: string; text: string; href?: string; cta?: string; accent: string }[] = [
  {
    tag: "Narration",
    title: "Your choice of narrator.",
    text: "Every page is read aloud. Pick the book's own narrator or another voice, and let the pages turn by themselves.",
    href: "/library",
    cta: "Start listening",
    accent: "#C49A1C"
  },
  {
    tag: "Worlds",
    title: "Shared character universes.",
    text: "Lagos Nights and more: the same characters and the same look, across different books.",
    href: "/worlds",
    cta: "Open Worlds",
    accent: "#C49A1C"
  },
  {
    tag: "Dream",
    title: "Sleep mode for wellness books.",
    text: "Softer colours, slower narration and a gentle ambient track the moment a wellness book opens.",
    href: "/dream",
    cta: "Open Dream",
    accent: "#3F8172"
  },
  {
    tag: "Memory",
    title: "A reader that learns you.",
    text: "Colours, pace, narration speed and motion adapt to the way you read.",
    href: "/memory",
    cta: "Open Memory",
    accent: "#1B6B8A"
  },
  {
    tag: "Live",
    title: "Read together, live.",
    text: "Host a reading and everyone in the room follows your pages in real time.",
    href: "/live",
    cta: "Open Live",
    accent: "#14818E"
  },
  {
    tag: "Companion",
    title: "Books that open from the shelf.",
    text: "Point your camera at a cover or tap its tag and the AnimBook opens on the page you chose.",
    href: "/companion",
    cta: "Open Companion",
    accent: "#9D4C73"
  }
];

export default function HomePage() {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ items: BookSummary[] }>("/api/books?status=PUBLISHED&limit=100")
      .then((json) => {
        if (!cancelled) setBooks(json.items);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of books) map.set(b.vertical, (map.get(b.vertical) ?? 0) + 1);
    return map;
  }, [books]);

  const newest = books.slice(0, 12);

  return (
    <div className="app-shell">
      <Topbar />
      <ErrorBoundary
        fallback={(err, reset) => (
          <main className="container">
            <ErrorState error={err} onRetry={reset} title="AnimBook failed to load" />
          </main>
        )}
      >
        <main className="container home">
          <section className="hero">
            <div className="hero-banner hero-split">
              <div className="hero-copy">
              <span className="label">AnimBook · A book that moves</span>
              <h1>Open a page. Watch a world come alive.</h1>
              <p>
                Every AnimBook pairs the original text with its own animation and a narrator you can choose. Read it, watch
                it, or listen. Built in Africa for readers everywhere.
              </p>
              <HeroActions />
              <ul className="hero-stats" aria-label="AnimBook at a glance">
                <li>
                  <strong>{loading ? "—" : books.length}</strong> AnimBooks
                </li>
                <li>
                  <strong>12</strong> verticals
                </li>
                <li>
                  <strong>5</strong> narrator voices
                </li>
              </ul>
              </div>
              <HeroPreview />
            </div>
          </section>

          <section aria-labelledby="verticals-heading" className="home-section">
            <header className="section-header">
              <div className="left">
                <span className="dot" style={{ background: "#C49A1C" }} />
                <h2 id="verticals-heading">Explore twelve verticals</h2>
              </div>
              <Link href="/library" className="section-link">
                All books →
              </Link>
            </header>
            <div className="vertical-grid">
              {VERTICALS.map((v) => {
                const n = counts.get(v.id) ?? 0;
                const empty = !loading && n === 0;
                const body = (
                  <>
                    <span className="vertical-bar" style={{ background: v.accent }} aria-hidden />
                    <span className="vertical-name" style={{ color: v.accent }}>
                      {v.label}
                    </span>
                    <span className="vertical-promise">{v.promise}</span>
                    <span className="vertical-blurb">{v.blurb}</span>
                    <span className="vertical-count">
                      {loading ? "…" : empty ? "Coming soon" : `${n} ${n === 1 ? "book" : "books"} →`}
                    </span>
                  </>
                );
                return empty ? (
                  <div key={v.id} className="vertical-tile is-empty" aria-disabled>
                    {body}
                  </div>
                ) : (
                  <Link key={v.id} href={`/library?vertical=${v.id}`} className="vertical-tile" aria-label={`${v.label} books`}>
                    {body}
                  </Link>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="nextgen-heading" className="home-section">
            <header className="section-header">
              <div className="left">
                <span className="dot" style={{ background: "#3F8172" }} />
                <h2 id="nextgen-heading">Next-gen features</h2>
              </div>
              <span className="label">Only on AnimBook</span>
            </header>
            <div className="feature-grid">
              {FEATURES.map((f) => (
                <article key={f.tag} className="feature-card">
                  <span className="feature-tag" style={{ color: f.accent, borderColor: f.accent }}>
                    {f.tag}
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                  {f.href && (
                    <Link href={f.href} className="feature-link" style={{ color: f.accent }}>
                      {f.cta} →
                    </Link>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="new-heading" className="home-section">
            <header className="section-header">
              <div className="left">
                <span className="dot" style={{ background: "#1B6B8A" }} />
                <h2 id="new-heading">New on AnimBook</h2>
              </div>
              <Link href="/library" className="section-link">
                See the full library →
              </Link>
            </header>
            {loading && <LoadingState variant="card" skeleton={5} message="Finding new books…" />}
            {failed && <p className="muted">The library is taking a moment to load. Try again shortly.</p>}
            {!loading && !failed && (
              <div className="shelf" role="list">
                {newest.map((book) => (
                  <div key={book.id} role="listitem" className="shelf-item">
                    <BookCard book={book} compact />
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
        <footer className="app-footer container">
          <span>AnimBook · Built in Africa for readers everywhere</span>
          <span className="footer-links">
            <Link href="/pricing">Pricing</Link>
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/terms">Terms</Link>
          </span>
        </footer>
      </ErrorBoundary>
    </div>
  );
}
