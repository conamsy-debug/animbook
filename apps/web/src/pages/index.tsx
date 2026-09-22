import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { HomeHero } from "@/components/homepage/HomeHero";
import { LivingCard } from "@/components/homepage/LivingCard";
import { BeforeAfter } from "@/components/homepage/BeforeAfter";
import { VerticalSection } from "@/components/homepage/VerticalSection";
import { OracleMarquee } from "@/components/nextgen/OracleMarquee";
import { ConstellationStrip } from "@/components/nextgen/ConstellationStrip";
import { SplashScreen } from "@/components/SplashScreen";
import { apiFetch, type BookSummary, type PageRecord } from "@/lib/api";
import { loadVoices } from "@/lib/voices";
import { useResilientFetch } from "@/lib/useResilientFetch";
import { useFeaturedRotator } from "@/lib/homepage/useFeaturedRotator";

/**
 * AnimBook homepage — redesigned.
 *
 * Reads the same catalog endpoint the rest of the page uses:
 *  - GET /api/books?status=PUBLISHED&limit=100   → book list
 *  - GET /api/books/{slug}/pages (per candidate) → featured pages
 *
 * Plus a public narration voices fetch (signed-out users get the
 * narration endpoint's 401, but `loadVoices` already caches the result
 * and the player gracefully hides the play button when there's no
 * signed-in user).
 *
 * The LivingCard + BeforeAfter now rotate through a curated pool of
 * books every 60s. The rotator prefetches all candidate pages so the
 * crossfade has no blank-flash. Rotation skips when the user has
 * prefers-reduced-motion on or the tab is hidden, and is no-op when
 * the pool has fewer than two members.
 */
export default function HomePage() {
  const { isSignedIn } = useAuth();
  // Splash overlay — the brief asks for a 1-second logo intro
  // before the homepage opens. We render the splash as the very
  // first child of the page so it sits on top of the (covered)
  // topbar; after 1s we unmount it. The component itself reads
  // prefers-reduced-motion and shortens its own timer.
  const [splashVisible, setSplashVisible] = useState(true);

  const { data: booksData, loading } = useResilientFetch<{ items: BookSummary[] }>(
    "/api/books?status=PUBLISHED&limit=100",
    { tag: "[HOME]" }
  );
  const books = booksData?.items ?? [];

  // Stable fetcher so the rotator's effect doesn't re-run every render.
  const fetchPagesForBook = useCallback(async (slug: string): Promise<PageRecord[]> => {
    const { pages } = await apiFetch<{ pages: PageRecord[] }>(`/api/books/${slug}/pages`);
    return Array.isArray(pages) ? pages : [];
  }, []);

  // Wraps both the LivingCard (in HomeHero) and the BeforeAfter panel
  // so hovering anywhere over the showcase pauses the rotation. The
  // hook checks this ref via `:hover` at tick time — no listeners.
  const showcaseRef = useRef<HTMLDivElement | null>(null);

  const { book: featuredBook, page: featuredPage } = useFeaturedRotator({
    books,
    pageFetcher: fetchPagesForBook,
    pauseOnHoverRef: showcaseRef,
    // Rotation is currently paused while we tune the showcase — we
    // want the homepage LivingCard + BeforeAfter to lock on a single
    // book with a real cover so visitors always see something
    // finished. Remove this flag (or set it to false) to re-enable
    // the 60s rotation pool. The hook still picks the highest-tier
    // candidate from `pickFeaturedCandidates` (cover+synopsis first,
    // then cover-only) so the locked-in book has a picture cover.
    paused: true,
    // Pin to "A Poem for Lagos" specifically until we re-enable the
    // pool. Falls back to the natural pick if the slug ever goes
    // missing from the catalog.
    forceSlug: "a-poem-for-lagos"
  });

  // Default narrator voice id — used by LivingCard on play.
  const [defaultVoiceId, setDefaultVoiceId] = useState<string | null>(null);
  useEffect(() => {
    loadVoices()
      .then((res) => {
        if (res.voices.length > 0) setDefaultVoiceId(res.voices[0]!.id);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="app-shell home-page">
      {splashVisible && (
        <SplashScreen onComplete={() => setSplashVisible(false)} />
      )}
      <Topbar variant="cinematic" />

      <ErrorBoundary
        fallback={(err, reset) => (
          <main className="container">
            <ErrorState error={err} onRetry={reset} title="AnimBook failed to load" />
          </main>
        )}
      >
        <main>
          <div ref={showcaseRef} className="home-showcase">
            <HomeHero
              featuredPage={featuredPage}
              totalBooks={books.length}
              loading={loading}
            >
              <LivingCard
                page={featuredPage}
                bookTitle={featuredBook?.title ?? null}
                defaultVoiceId={defaultVoiceId}
                signedIn={Boolean(isSignedIn)}
              />
            </HomeHero>

            <BeforeAfter page={featuredPage} />
          </div>

          <VerticalSection books={books} loading={loading} />

          <OracleMarquee books={books} />

          <ConstellationStrip />

          <footer className="home-app-footer container">
            <span>AnimBook</span>
            <span className="home-footer-links">
              <Link href="/pricing">Pricing</Link>
              <Link href="/legal/privacy">Privacy</Link>
              <Link href="/legal/terms">Terms</Link>
            </span>
          </footer>
        </main>
      </ErrorBoundary>
    </div>
  );
}