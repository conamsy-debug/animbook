import Link from "next/link";
import type { BookSummary } from "@/lib/api";
import type { FanCover } from "@/lib/homepage/fanCovers";
import { verticalCardBackground } from "@/lib/homepage/fanCovers";

interface VerticalLike {
  id: string;
  label: string;
  promise: string;
  blurb: string;
  accent: string;
}

interface Props {
  vertical: VerticalLike;
  books: BookSummary[];
  /** Number of books in this vertical — drives the dim state. */
  count: number;
}

/**
 * VerticalCard — one of twelve tiles in the homepage grid.
 *
 *  - 360px tall, vertical-color background (mixed toward ink), 1px border.
 *  - Hover/focus: lifts 5px, border lightens, fan spreads.
 *  - Zero books: dimmed to 55% opacity, no arrow, no fan.
 *  - Fan: up to 3 mini-covers in the bottom-right corner. Generated
 *    frames for books without cover art.
 */
export function VerticalCard({ vertical, books, count }: Props) {
  const empty = count === 0;
  const fan: FanCover[] = empty ? [] : books.slice(0, 3).map((book) => ({
    book,
    hasCover: Boolean(book.coverUrl)
  }));

  const bg = verticalCardBackground(vertical.accent);
  const countLabel = empty
    ? "0 books"
    : `${count} ${count === 1 ? "book" : "books"}`;

  const body = (
    <>
      <div className="home-vlabel" style={{ color: vertical.accent }}>{vertical.label}</div>
      <div className="home-vtag">{vertical.promise}</div>
      <div className="home-vdesc">{vertical.blurb}</div>
      <div className="home-vcount" style={{ color: vertical.accent }}>
        {countLabel}{!empty && <ArrowRight />}
      </div>
      {fan.length > 0 && (
        <div className="home-fan" aria-hidden>
          {fan.map((f, i) => (
            <FanMini key={f.book.id} cover={f} index={i} accent={vertical.accent} />
          ))}
        </div>
      )}
    </>
  );

  if (empty) {
    return (
      <div
        className="home-vcard dim"
        style={{ background: bg }}
        aria-disabled
      >
        {body}
      </div>
    );
  }
  return (
    <Link
      href={`/library?vertical=${vertical.id}`}
      className="home-vcard"
      style={{ background: bg }}
      aria-label={`${vertical.label} — ${vertical.promise}`}
    >
      {body}
    </Link>
  );
}

/** One fan mini. Real covers use `<img>`; no-cover books get a
 *  generated frame with the vertical color. */
function FanMini({ cover, index, accent }: { cover: FanCover; index: number; accent: string }) {
  const cls = `home-mini home-m${index}`;
  if (cover.hasCover) {
    return (
      <div className={cls} style={{ backgroundImage: `url(${cover.book.coverUrl})` }} />
    );
  }
  // Generated frame: vertical accent at ~40–62% toward ink + a tiny inset.
  return (
    <div className={`${cls} home-mini-gen`} style={{ color: accent }}>
      <div className="home-mg">
        <span style={{ color: accent }}>{cover.book.title}</span>
      </div>
    </div>
  );
}

function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
