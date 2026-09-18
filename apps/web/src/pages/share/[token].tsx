import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";
import { useEffect, useState } from "react";
import type { ShareLandingData } from "../api/og-share";
import { getShareServerSideProps } from "../api/og-share";

type Props = { share: ShareLandingData | null; token: string };

/**
 * /share/<token> — the marketing landing page. SSR'd so social platforms
 * see real OG / Twitter Card tags when the link is unfurled.
 * - The trailer plays inline in the hero, falling back to the cover art
 *   when still generating or after ffmpeg fails.
 * - The "Read on AnimBook" CTA goes to /book/<slug>, with a utm_source=share
 *   so the click is attributed back to this token.
 */
export default function ShareLandingPage({ share }: Props) {
  const router = useRouter();
  const [trailerLoaded, setTrailerLoaded] = useState(false);

  useEffect(() => {
    // Re-fetch the latest status every 8s while the trailer is still
    // preparing, so the page auto-reveals the video the moment it's ready
    // without a full refresh.
    if (!share) return;
    if (share.status === "READY" || share.status === "FAILED" || share.status === "REVOKED") return;
    const id = setInterval(async () => {
      try {
        const fresh = await apiFetch<ShareLandingData>(`/api/share/${encodeURIComponent(share.token)}`);
        if (fresh.status === "READY" || fresh.status === "FAILED" || fresh.status === "REVOKED") {
          router.replace(router.asPath, undefined, { scroll: false });
        }
      } catch {
        // ignore — keep polling quietly
      }
    }, 8000);
    return () => clearInterval(id);
  }, [share, router]);

  if (!share) return null;
  const ogTitle = `${share.book.title} — ${share.book.author} | AnimBook`;
  const ogDescription = share.hook.length > 0
    ? share.hook
    : share.book.synopsis.slice(0, 200);
  const ogImage = share.thumbnailUrl ?? share.book.coverUrl ?? "";
  const ogUrl = `/share/${share.token}`;

  return (
    <>
      <Head>
        <title>{ogTitle}</title>
        <meta name="description" content={ogDescription} />
        <meta property="og:title" content={share.book.title} />
        <meta property="og:description" content={ogDescription} />
        <meta property="og:type" content="book" />
        <meta property="og:url" content={ogUrl} />
        {ogImage ? <meta property="og:image" content={ogImage} /> : null}
        <meta property="og:site_name" content="AnimBook" />
        <meta property="book:author" content={share.book.author} />
        <meta name="twitter:card" content={share.trailerUrl ? "player" : "summary_large_image"} />
        <meta name="twitter:title" content={share.book.title} />
        <meta name="twitter:description" content={ogDescription} />
        {share.trailerUrl ? (
          <>
            <meta name="twitter:player" content={share.trailerUrl} />
            <meta name="twitter:player:width" content="1280" />
            <meta name="twitter:player:height" content="720" />
            <meta property="og:video" content={share.trailerUrl} />
            <meta property="og:video:type" content="video/mp4" />
          </>
        ) : null}
        {ogImage ? <meta name="twitter:image" content={ogImage} /> : null}
        <link rel="canonical" href={ogUrl} />
      </Head>
      <Topbar />
      <main className={`share-landing vertical-${share.book.vertical}`}>
        <section className="share-hero">
          {share.trailerUrl && (share.status === "READY") ? (
            <video
              className="share-trailer"
              src={share.trailerUrl}
              autoPlay
              muted
              loop
              playsInline
              controls
              onLoadedData={() => setTrailerLoaded(true)}
              poster={share.thumbnailUrl ?? share.book.coverUrl ?? undefined}
            />
          ) : (
            <div className="share-cover-wrap">
              {share.book.coverUrl ? (
                <img className="share-cover" src={share.book.coverUrl} alt={share.book.title} />
              ) : (
                <div className="share-cover placeholder" />
              )}
              {share.status === "PENDING" || share.status === "GENERATING" ? (
                <div className="share-status pending">
                  <span className="spinner" />
                  The trailer is being prepared — about 3 minutes.
                </div>
              ) : share.status === "FAILED" ? (
                <div className="share-status failed">
                  Trailer generation didn&apos;t complete. You can still read the book below.
                </div>
              ) : null}
            </div>
          )}
          <div className="share-meta">
            <p className="share-eyebrow">A new kind of book</p>
            <h1 className="share-title">{share.book.title}</h1>
            {share.book.subtitle ? <p className="share-subtitle">{share.book.subtitle}</p> : null}
            <p className="share-author">by {share.book.author}</p>
            <p className="share-hook">{share.hook}</p>
            <Link
              className="share-cta"
              href={`/book/${share.book.slug}?utm_source=share&utm_medium=social&utm_campaign=${encodeURIComponent(share.token)}`}
            >
              Read on AnimBook →
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}

export const getServerSideProps = getShareServerSideProps;
