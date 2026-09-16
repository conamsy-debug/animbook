import { useEffect, useState } from "react";
import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton } from "@clerk/nextjs";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { LoadingState, EmptyState } from "@/components/States";
import { apiFetch, type BookSummary } from "@/lib/api";
import { useToastStore } from "@/lib/store";

const HAS_CLERK = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

const consumerWorlds = ["Otherworlds", "Human Stories", "True Stories", "Deep Dives", "Thrills", "Spirit & Soul", "Young Minds", "The World"];

const verticals: { id: string; label: string; promise: string; accent: string }[] = [
  { id: "CONSUMER", label: "Consumer", promise: "Stories become worlds.", accent: "#1B6B8A" },
  { id: "KIDS", label: "Kids", promise: "Bedtime stories that breathe.", accent: "#D9872A" },
  { id: "EDU", label: "Edu", promise: "See the idea. Understand it.", accent: "#1A6B3C" },
  { id: "FAITH", label: "Faith", promise: "Sacred texts, respectfully illuminated.", accent: "#6B2D8B" },
  { id: "DOCS", label: "Docs", promise: "Knowledge with a camera.", accent: "#56738A" },
  { id: "VERSE", label: "Verse", promise: "Poetry in motion.", accent: "#9D4C73" },
  { id: "COMICS", label: "Comics", promise: "Original art, newly alive.", accent: "#C94B32" },
  { id: "BUSINESS", label: "Business", promise: "Ideas your team remembers.", accent: "#B58B27" },
  { id: "WELLNESS", label: "Wellness", promise: "Gentle journeys inward.", accent: "#3F8172" },
  { id: "LAW", label: "Law", promise: "Civic understanding, made visible.", accent: "#7A6650" },
  { id: "TRAVEL", label: "Travel", promise: "Go before you arrive.", accent: "#14818E" },
  { id: "ORIGINALS", label: "Originals", promise: "Made for the medium.", accent: "#C49A1C" }
];

export default function LibraryPage() {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const toast = useToastStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const json = await apiFetch<{ items: BookSummary[] }>("/api/books?status=PUBLISHED&limit=40");
        if (!cancelled) {
          setBooks(json.items);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
          toast("Could not reach AnimBook API");
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const featured = books.slice(0, 3);
  const staffPicks = books.filter((b) => b.vertical === "VERSE" || b.vertical === "TRAVEL").slice(0, 4);

  return (
    <div className="app-shell">
      <Topbar />
      <ErrorBoundary
        fallback={(err, reset) => (
          <main className="container">
            <ErrorState error={err} onRetry={reset} title="The library failed to load" />
          </main>
        )}
      >
      <main className="container">
        <section className="hero">
          <div className="hero-banner">
            <span className="label">AnimBook · A book that moves</span>
            <h1>Open a page. Watch a world come alive.</h1>
            <p>
              Every AnimBook pairs the original manuscript text with a generated animation and a narration you can flip when
              you are ready. Built in Africa for readers everywhere.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <SignedOut>
                {HAS_CLERK ? (
                  <>
                    <SignUpButton mode="modal" forceRedirectUrl="/library">
                      <button type="button" className="btn primary" aria-label="Create your account">
                        Get Started
                      </button>
                    </SignUpButton>
                    <SignInButton mode="modal" forceRedirectUrl="/library">
                      <button type="button" className="btn ghost" aria-label="Sign in">
                        Sign In
                      </button>
                    </SignInButton>
                  </>
                ) : (
                  <Link className="btn primary" href="/pricing">
                    Get Started
                  </Link>
                )}
              </SignedOut>
              <SignedIn>
                <Link className="btn primary" href="#consumer">
                  Start reading
                </Link>
              </SignedIn>
              <Link className="btn" href="/studio">
                AnimBook Studio
              </Link>
            </div>
          </div>
        </section>

        <section id="consumer" aria-labelledby="worlds-heading">
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#1B6B8A" }} />
              <h2 id="worlds-heading">The Consumer Library</h2>
            </div>
            <span className="label">Eight Worlds · One medium</span>
          </header>
          <div className="world-strip" aria-label="Genre worlds">
            {consumerWorlds.map((world) => (
              <span key={world} className="world-pill" style={{ color: "#1B6B8A" }}>
                {world}
              </span>
            ))}
          </div>
          {loading && <LoadingState variant="card" skeleton={8} message="Curating your library…" />}
          {error && (
            <EmptyState
              title="Library is offline"
              message={`AnimBook API is unreachable. ${error}`}
              cta={{ href: "/", label: "Retry" }}
            />
          )}
          <div className="grid">
            {books.map((book) => (
              <Link key={book.id} href={`/book/${book.slug}`} className="book-card" aria-label={`Open ${book.title}`}>
                <div className="cover" style={{ backgroundImage: book.coverUrl ? `url(${book.coverUrl})` : undefined }} />
                <span className="by" style={{ color: verticalAccent(book.vertical) }}>
                  {book.vertical} · {book.author}
                </span>
                <h3>{book.title}</h3>
                <p className="muted" style={{ margin: 0, fontSize: ".9rem" }}>
                  {book.synopsis.slice(0, 120)}{book.synopsis.length > 120 ? "…" : ""}
                </p>
                <span className="label">{book.totalPages} pages</span>
              </Link>
            ))}
          </div>
        </section>

        {featured.length > 0 && (
          <section aria-labelledby="featured-heading">
            <header className="section-header">
              <div className="left">
                <span className="dot" style={{ background: "#C49A1C" }} />
                <h2 id="featured-heading">Staff picks</h2>
              </div>
              <span className="label">Hand-curated</span>
            </header>
            <div className="grid">
              {staffPicks.concat(featured).slice(0, 4).map((book) => (
                <Link key={book.id} href={`/book/${book.slug}`} className="book-card">
                  <div className="cover" style={{ backgroundImage: book.coverUrl ? `url(${book.coverUrl})` : undefined }} />
                  <h3>{book.title}</h3>
                  <p className="muted">{book.synopsis.slice(0, 80)}{book.synopsis.length > 80 ? "…" : ""}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {books.some((b) => b.vertical === "KIDS") && (
          <section aria-labelledby="kids-heading">
            <header className="section-header">
              <div className="left">
                <span className="dot" style={{ background: "#D9872A" }} />
                <h2 id="kids-heading">Kids Library</h2>
              </div>
              <span className="label">Ages 2-10 · Bedtime mode ready</span>
            </header>
            <div className="grid">
              {books.filter((b) => b.vertical === "KIDS").map((book) => (
                <Link key={book.id} href={`/book/${book.slug}`} className="book-card">
                  <div className="cover" style={{ backgroundImage: book.coverUrl ? `url(${book.coverUrl})` : undefined }} />
                  <span className="by" style={{ color: "#D9872A" }}>KIDS · {book.author}</span>
                  <h3>{book.title}</h3>
                  <p className="muted">{book.synopsis.slice(0, 110)}{book.synopsis.length > 110 ? "…" : ""}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {books.some((b) => b.vertical === "BUSINESS") && (
          <section aria-labelledby="business-heading">
            <header className="section-header">
              <div className="left">
                <span className="dot" style={{ background: "#B58B27" }} />
                <h2 id="business-heading">Business Library</h2>
              </div>
              <span className="label">SCORM 2004 · Cohort reading</span>
            </header>
            <div className="grid">
              {books.filter((b) => b.vertical === "BUSINESS").map((book) => (
                <Link key={book.id} href={`/book/${book.slug}`} className="book-card">
                  <div className="cover" style={{ backgroundImage: book.coverUrl ? `url(${book.coverUrl})` : undefined }} />
                  <span className="by" style={{ color: "#B58B27" }}>BUSINESS · {book.author}</span>
                  <h3>{book.title}</h3>
                  <p className="muted">{book.synopsis.slice(0, 110)}{book.synopsis.length > 110 ? "…" : ""}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {books.some((b) => b.vertical === "FAITH") && (
          <section aria-labelledby="faith-heading">
            <header className="section-header">
              <div className="left">
                <span className="dot" style={{ background: "#6B2D8B" }} />
                <h2 id="faith-heading">Faith Library</h2>
              </div>
              <span className="label">Theological advisor review</span>
            </header>
            <div className="grid">
              {books.filter((b) => b.vertical === "FAITH").map((book) => (
                <Link key={book.id} href={`/book/${book.slug}`} className="book-card">
                  <div className="cover" style={{ backgroundImage: book.coverUrl ? `url(${book.coverUrl})` : undefined }} />
                  <span className="by" style={{ color: "#6B2D8B" }}>FAITH · {book.author}</span>
                  <h3>{book.title}</h3>
                  <p className="muted">{book.synopsis.slice(0, 110)}{book.synopsis.length > 110 ? "…" : ""}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {books.some((b) => b.vertical === "WELLNESS") && (
          <section aria-labelledby="wellness-heading">
            <header className="section-header">
              <div className="left">
                <span className="dot" style={{ background: "#3F8172" }} />
                <h2 id="wellness-heading">Wellness Library</h2>
              </div>
              <span className="label">Sleep · Mindfulness · DREAM ready</span>
            </header>
            <div className="grid">
              {books.filter((b) => b.vertical === "WELLNESS").map((book) => (
                <Link key={book.id} href={`/book/${book.slug}`} className="book-card">
                  <div className="cover" style={{ backgroundImage: book.coverUrl ? `url(${book.coverUrl})` : undefined }} />
                  <span className="by" style={{ color: "#3F8172" }}>WELLNESS · {book.author}</span>
                  <h3>{book.title}</h3>
                  <p className="muted">{book.synopsis.slice(0, 110)}{book.synopsis.length > 110 ? "…" : ""}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="nextgen-heading">
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#3F8172" }} />
              <h2 id="nextgen-heading">Next-gen features</h2>
            </div>
            <span className="label">14 of 14 shipped</span>
          </header>
          <div className="grid">
            <article className="card" style={{ borderColor: "#3F8172" }}>
              <span className="world-pill" style={{ color: "#3F8172" }}>DREAM</span>
              <h3 style={{ marginTop: 12, fontSize: "1.2rem" }}>Sleep-mode for WELLNESS books.</h3>
              <p className="muted" style={{ marginTop: 8 }}>
                The Reader auto-applies a softer palette, slower narration, and a looping ambient track the moment a WELLNESS AnimBook opens. Twenty minutes of stillness counts as falling asleep.
              </p>
              <Link href="/dream" className="btn" style={{ marginTop: 8, display: "inline-block" }}>Open DREAM</Link>
            </article>
            <article className="card" style={{ borderColor: "#3F8172" }}>
              <span className="world-pill" style={{ color: "#3F8172" }}>STUDIO PRO</span>
              <h3 style={{ marginTop: 12, fontSize: "1.2rem" }}>AR + NFC companion for every AnimBook.</h3>
              <p className="muted" style={{ marginTop: 8 }}>
                Every book mints a deterministic AR marker and a unique NFC tag id. Point your camera at the cover or tap the tag — the AnimBook opens on the page you chose.
              </p>
              <Link href="/companion" className="btn" style={{ marginTop: 8, display: "inline-block" }}>Open Companion</Link>
            </article>
            <article className="card" style={{ borderColor: "#1B6B8A" }}>
              <span className="world-pill" style={{ color: "#1B6B8A" }}>MEMORY</span>
              <h3 style={{ marginTop: 12, fontSize: "1.2rem" }}>Adaptive reading profile.</h3>
              <p className="muted" style={{ marginTop: 8 }}>
                Palette, pacing, narration speed, motion level, and the Lens / Echo toggles adapt to the way you read.
              </p>
              <Link href="/memory" className="btn" style={{ marginTop: 8, display: "inline-block" }}>Open Memory</Link>
            </article>
            <article className="card" style={{ borderColor: "#9D4C73" }}>
              <span className="world-pill" style={{ color: "#9D4C73" }}>ORACLE</span>
              <h3 style={{ marginTop: 12, fontSize: "1.2rem" }}>Branching narratives.</h3>
              <p className="muted" style={{ marginTop: 8 }}>
                VERSE AnimBooks offer a tap-to-branch continuation. The Oracle writes the next page in the same hand.
              </p>
            </article>
            <article className="card" style={{ borderColor: "#14818E" }}>
              <span className="world-pill" style={{ color: "#14818E" }}>LIVE</span>
              <h3 style={{ marginTop: 12, fontSize: "1.2rem" }}>Host a reading. Watch others flip.</h3>
              <p className="muted" style={{ marginTop: 8 }}>
                Start a live session, push page events over Server-Sent Events, the room follows in real time.
              </p>
              <Link href="/live" className="btn" style={{ marginTop: 8, display: "inline-block" }}>Open Live</Link>
            </article>
            <article className="card" style={{ borderColor: "#C49A1C" }}>
              <span className="world-pill" style={{ color: "#C49A1C" }}>WORLDS</span>
              <h3 style={{ marginTop: 12, fontSize: "1.2rem" }}>Shared character universes.</h3>
              <p className="muted" style={{ marginTop: 8 }}>
                Lagos Nights, The Vineyard, more to come. The same characters, the same style — different nights.
              </p>
              <Link href="/worlds" className="btn" style={{ marginTop: 8, display: "inline-block" }}>Open Worlds</Link>
            </article>
          </div>
        </section>

        <section aria-labelledby="verticals-heading">
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#C49A1C" }} />
              <h2 id="verticals-heading">Twelve Verticals</h2>
            </div>
            <span className="label">The full platform</span>
          </header>
          <div className="grid">
            {verticals.map((v) => (
              <article key={v.id} className="card" style={{ borderColor: v.accent }}>
                <span className="world-pill" style={{ color: v.accent }}>{v.label}</span>
                <h3 style={{ marginTop: 12, fontSize: "1.2rem" }}>{v.promise}</h3>
                <p className="muted" style={{ marginTop: 8 }}>
                  {verticalBlurb(v.id)}
                </p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="app-footer container">
        <span>AnimBook · A book that moves</span>
        <span>v0.11.0 · 11 phases shipped</span>
      </footer>
      </ErrorBoundary>
    </div>
  );
}

function verticalBlurb(id: string): string {
  switch (id) {
    case "CONSUMER": return "Originals and the public-domain canon. The night you can't put down.";
    case "KIDS": return "Bedtime mode + KIDS Reader with character voices. Safe, gentle, ready for the cot.";
    case "EDU": return "Curriculum-mapped, with checkpoints and a teacher dashboard. 7 question types, 7 frameworks.";
    case "FAITH": return "Sacred texts. Theological advisor review required. Respectful pacing and palette.";
    case "DOCS": return "How-tos and field manuals with an actual camera on every step. New in Phase 11.";
    case "VERSE": return "Poetry in motion. Tappable words for translation, Oracle branching for open forms.";
    case "COMICS": return "Original art newly alive, panel-by-panel. Schema-ready — content partner TBD.";
    case "BUSINESS": return "L&D AnimBooks with SCORM 2004 packaging for cohort reading and completion tracking.";
    case "WELLNESS": return "Sleep stories at 0.7× narration. DREAM profile auto-applies on open.";
    case "LAW": return "Civic understanding made visible. Schema-ready — content partner TBD.";
    case "TRAVEL": return "Go before you arrive. Slow pans over street, mosque, market.";
    case "ORIGINALS": return "Made for the medium. New work that couldn't exist on the page.";
    default: return "A new medium, one vertical at a time.";
  }
}

function verticalAccent(vertical: string): string {
  const v = verticals.find((x) => x.id === vertical);
  return v?.accent ?? "#1B6B8A";
}