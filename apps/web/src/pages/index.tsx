import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { HomeHero } from "@/components/homepage/HomeHero";
import { LivingCard } from "@/components/homepage/LivingCard";
import { BeforeAfter } from "@/components/homepage/BeforeAfter";
import { VerticalSection } from "@/components/homepage/VerticalSection";
import { apiFetch, type BookSummary, type PageRecord } from "@/lib/api";
import { loadVoices } from "@/lib/voices";
import { useResilientFetch } from "@/lib/useResilientFetch";

/**
 * AnimBook homepage — redesigned.
 *
 * Reads the same two endpoints the old homepage did (no new backend
 * work):
 *  - GET /api/books?status=PUBLISHED&limit=100   → book list
 *  - GET /api/books/lagos-nights-2-the-lagoon/pages → featured page
 *
 * Plus a public narration voices fetch (signed-out users get the
 * narration endpoint's 401, but `loadVoices` already caches the result
 * and the player gracefully hides the play button when there's no
 * signed-in user).
 */
export default function HomePage() {
  const { isSignedIn } = useAuth();
  const [featuredPage, setFeaturedPage] = useState<PageRecord | null>(null);

  const { data: booksData, loading, error } = useResilientFetch<{ items: BookSummary[] }>(
    "/api/books?status=PUBLISHED&limit=100",
    { tag: "[HOME]" }
  );
  const books = booksData?.items ?? [];

  // Featured page — picks the first page with a real video.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ pages: PageRecord[] }>("/api/books/lagos-nights-2-the-lagoon/pages")
      .then(({ pages }) => {
        if (cancelled) return;
        const withVideo = pages.filter(
          (p) =>
            Boolean(p.videoUrl) &&
            /^https?:\/\//.test(p.videoUrl ?? "") &&
            !String(p.videoUrl ?? "").includes("placehold.co")
        );
        const pick = withVideo.find((p) => p.pageNum === 2) ?? withVideo[0] ?? null;
        setFeaturedPage(pick);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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
      <Topbar variant="cinematic" />

      <ErrorBoundary
        fallback={(err, reset) => (
          <main className="container">
            <ErrorState error={err} onRetry={reset} title="AnimBook failed to load" />
          </main>
        )}
      >
        <main>
          <HomeHero
            featuredPage={featuredPage}
            totalBooks={books.length}
            loading={loading}
          >
            <LivingCard
              page={featuredPage}
              defaultVoiceId={defaultVoiceId}
              signedIn={Boolean(isSignedIn)}
            />
          </HomeHero>

          <BeforeAfter page={featuredPage} />

          <VerticalSection books={books} loading={loading} />

          <footer className="home-app-footer container">
            <span>AnimBook · Built in Africa for readers everywhere</span>
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