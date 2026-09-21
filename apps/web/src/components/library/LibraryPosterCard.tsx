import Link from "next/link";
import type { BookSummary } from "@/lib/api";
import { coverColorFor } from "@/lib/library/coverColors";
import { splitTitle } from "@/lib/library/series";
import { verticalAccent, verticalById, subcategoryLabel } from "@/lib/verticals";
import { PlayIcon, ReadIcon, ListenIcon, DetailsIcon } from "./icons";

interface Props {
  book: BookSummary;
  /** When true, render with grid-mode styling (no neighbor dimming).
   *  Defaults to row mode (the cinematic hover behavior). */
  gridMode?: boolean;
}

/**
 * LibraryPosterCard — 200×300 (2:3) poster card.
 *
 * Hover / focus-within scales the card, lifts it above its neighbors, dims
 * the rest of the track, and fades up a panel with title + meta + four
 * icon links (Watch / Read / Listen / Details). The card itself is a real
 * link to the book's landing page; the four icon buttons are real links
 * inside the card and don't break the outer link's behavior.
 *
 * Books without cover art fall back to a generated cover using
 * coverColorFor() — vertical palette + a 1px inset frame + the
 * vertical label + the title.
 */
export function LibraryPosterCard({ book, gridMode = false }: Props) {
  const hasCover = Boolean(book.coverUrl);
  const { series, title } = splitTitle(book.title);
  const accent = verticalAccent(book.vertical);
  const palette = coverColorFor(book.vertical, accent);
  const displayLabel = series ?? subcategoryLabel(book.vertical, book.subcategory) ?? verticalById(book.vertical)?.label ?? book.vertical;
  const fullTitle = series ? `${series} · ${title}` : book.title;
  const bookHref = `/book/${book.slug}`;

  return (
    <article className={`lib-card${gridMode ? " lib-card-grid" : ""}`}>
      <Link href={bookHref} className="lib-card-link" aria-label={`Open ${book.title}`}>
        <div className="lib-poster" style={hasCover
          ? { backgroundImage: `url(${book.coverUrl})` }
          : { background: palette.background, color: palette.foreground }}>
          {!hasCover && <GeneratedCover label={displayLabel} title={title} />}
        </div>
      </Link>

      <div className="lib-panel" aria-hidden={!hasCover && undefined}>
        <div className="lib-panel-title">{fullTitle}</div>
        <div className="lib-panel-meta">
          <span>{displayLabel}</span>
          <span>{book.totalPages} pp</span>
        </div>
        <div className="lib-panel-actions">
          <Link href={bookHref} className="lib-ib" aria-label={`Watch ${book.title}`} data-tip="Watch">
            <PlayIcon />
          </Link>
          <Link href={bookHref} className="lib-ib" aria-label={`Read ${book.title}`} data-tip="Read">
            <ReadIcon />
          </Link>
          <Link href={bookHref} className="lib-ib" aria-label={`Listen to ${book.title}`} data-tip="Listen">
            <ListenIcon />
          </Link>
          <Link href={bookHref} className="lib-ib" aria-label={`Details for ${book.title}`} data-tip="Details">
            <DetailsIcon />
          </Link>
        </div>
      </div>
    </article>
  );
}

/** Generated cover — vertical label top-left, title bottom-left, with a
 *  1px inset frame at 26% opacity. Long titles shrink in steps (the CSS
 *  handles the actual font-size scaling). */
function GeneratedCover({ label, title }: { label: string; title: string }) {
  return (
    <div className="lib-gen">
      <div className="lib-gen-label">{label}</div>
      <div className="lib-gen-title">{title}</div>
    </div>
  );
}
