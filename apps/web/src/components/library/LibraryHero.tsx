import { useEffect, useRef } from "react";
import Link from "next/link";
import type { BookSummary } from "@/lib/api";
import { splitTitle } from "@/lib/library/series";
import { PlayIcon, ReadIcon, ListenIcon, DetailsIcon } from "./icons";
import { subcategoryLabel, verticalById } from "@/lib/verticals";

interface Props {
  book: BookSummary;
}

/**
 * LibraryHero — featured book with blurred backdrop, poster, text block,
 * load sequence, and parallax. Rendered once at the top of /library when
 * no filter or search is active.
 */
export function LibraryHero({ book }: Props) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const bgRef = useRef<HTMLDivElement | null>(null);
  const posterRef = useRef<HTMLDivElement | null>(null);

  const { series, title } = splitTitle(book.title);
  const displayTitle = series ? `${series} · ${title}` : book.title;
  const verticalLabel = subcategoryLabel(book.vertical, book.subcategory) ?? verticalById(book.vertical)?.label ?? book.vertical;
  const bookHref = `/book/${book.slug}`;
  // Clamp synopsis to ~3 lines via CSS — see `.lib-hdesc`.
  const synopsis = book.synopsis ?? "";

  // Parallax: track mouse over the hero and translate the poster + backdrop
  // via CSS variables. Pointer-only (no touch) and respect reduced motion.
  useEffect(() => {
    const section = sectionRef.current;
    const bg = bgRef.current;
    const poster = posterRef.current;
    if (!section || !bg || !poster) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(hover: none)").matches) return;
    let raf = 0;
    function onMove(e: MouseEvent) {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = section!.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2; // -1..1
        const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
        const txPoster = (x * 10).toFixed(2);
        const tyPoster = (y * 8).toFixed(2);
        const rxPoster = (x * 4).toFixed(2);
        const ryPoster = (y * 3).toFixed(2);
        const txBg = (-x * 16).toFixed(2);
        const tyBg = (-y * 10).toFixed(2);
        poster!.style.transform = `perspective(1200px) translate3d(${txPoster}px, ${tyPoster}px, 0) rotateY(${ryPoster}deg) rotateX(${-rxPoster}deg)`;
        bg!.style.transform = `translate3d(${txBg}px, ${tyBg}px, 0)`;
      });
    }
    function onLeave() {
      poster!.style.transform = "";
      bg!.style.transform = "";
    }
    section.addEventListener("mousemove", onMove);
    section.addEventListener("mouseleave", onLeave);
    return () => {
      section.removeEventListener("mousemove", onMove);
      section.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section ref={sectionRef} className="lib-hero" aria-label="Featured book">
      <div ref={bgRef} className="lib-bgwrap">
        <div
          className="lib-bg"
          style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}
          aria-hidden
        />
      </div>

      <div ref={posterRef} className="lib-hposter">
        {book.coverUrl ? (
          <img
            className="lib-pimg"
            src={book.coverUrl}
            alt={`Cover of ${book.title}`}
            width={400}
            height={600}
            // Hero cover is the LCP element — load eagerly with high priority.
            loading="eager"
            decoding="sync"
            // @ts-expect-error fetchpriority is a valid HTML attribute
            fetchpriority="high"
          />
        ) : (
          <div className="lib-pimg lib-pimg-placeholder" aria-hidden />
        )}
      </div>

      <div className="lib-hcopy">
        {series && <div className="lib-hser">{series}</div>}
        <h1 className="lib-htitle">{title}</h1>
        <div className="lib-hmeta">
          <span>{verticalLabel}</span>
          {book.author && <span>{book.author}</span>}
          <span>{book.totalPages} pp</span>
        </div>
        {synopsis && <p className="lib-hdesc">{synopsis}</p>}
        <div className="lib-hcta">
          <Link href={bookHref} className="lib-btn lib-btn-gold">
            <PlayIcon /> Watch
          </Link>
          <Link href={bookHref} className="lib-btn lib-btn-glass">
            <ReadIcon /> Read
          </Link>
          <Link href={bookHref} className="lib-ib lib-ib-lg" aria-label={`Listen to ${book.title}`} data-tip="Listen">
            <ListenIcon />
          </Link>
          <Link href={bookHref} className="lib-ib lib-ib-lg" aria-label={`Details for ${book.title}`} data-tip="Details">
            <DetailsIcon />
          </Link>
        </div>
      </div>
      {/* Keep the title visible to screen readers even when series prefix
          is shown above. The "Lagos Nights · The Lagoon" pattern means the
          series is the eyebrow, the title is the headline. */}
      <span className="sr">{displayTitle}</span>
    </section>
  );
}
