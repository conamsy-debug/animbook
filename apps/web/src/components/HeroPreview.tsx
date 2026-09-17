import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, type PageRecord } from "@/lib/api";

const FEATURED_BOOK = { slug: "lagos-nights-2-the-lagoon", title: "Lagos Nights · The Lagoon" };

const isReal = (url: string | null | undefined) => Boolean(url && /^https?:\/\//.test(url) && !url.includes("placehold.co"));

/** A looping page from a finished AnimBook, shown beside the welcome text. */
export function HeroPreview() {
  const [page, setPage] = useState<PageRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ pages: PageRecord[] }>(`/api/books/${FEATURED_BOOK.slug}/pages`)
      .then(({ pages }) => {
        const withVideo = pages.filter((p) => isReal(p.videoUrl));
        const pick = withVideo.find((p) => p.pageNum === 2) ?? withVideo[0] ?? null;
        if (!cancelled) setPage(pick);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!page) return <div className="hero-preview is-empty" aria-hidden />;
  return (
    <Link href={`/book/${FEATURED_BOOK.slug}`} className="hero-preview" aria-label={`Preview: ${FEATURED_BOOK.title}`}>
      <video
        src={page.videoUrl!}
        poster={isReal(page.posterUrl) ? page.posterUrl! : undefined}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
      />
      <span className="hero-preview-caption">
        <span className="label">{FEATURED_BOOK.title}</span>
        <span className="hero-preview-text">“{page.textExcerpt.slice(0, 110)}{page.textExcerpt.length > 110 ? "…" : ""}”</span>
      </span>
    </Link>
  );
}
