import Link from "next/link";
import { useMemo } from "react";
import type { BookSummary } from "@/lib/api";

interface Props {
  /** Books loaded by the homepage via useResilientFetch. The marquee
   *  picks the first published Verse book and links "Ask the Oracle"
   *  to its reader. Empty list → quiet skeleton. */
  books: BookSummary[];
}

/**
 * OracleMarquee — Verse-only next-gen feature presented as a marquee
 * section. Static visual preview (no /api/oracle/... calls). The
 * "Ask the Oracle" button navigates to the first Verse book's
 * reader, where the real Oracle modal lives.
 *
 * Visual layers (back to front):
 *  - Verse-paper background with a soft top + bottom vignette
 *  - A single tall "page" card with eyebrow / title / verse / rule / button
 *  - (S4) Three continuation cards below the page card, staggered entrance
 *
 * The marquee reads `books` once and finds the first Verse book. The
 * link target is `/read/<slug>?from=oracle` so analytics can attribute
 * the visit to the homepage marquee.
 */
export function OracleMarquee({ books }: Props) {
  const verseBook = useMemo(
    () => books.find((b) => b.vertical === "VERSE" && typeof b.slug === "string" && b.slug.length > 0),
    [books]
  );

  const loading = books.length === 0;

  return (
    <section className="home-oracle" aria-labelledby="home-oracle-heading">
      <div className="home-oracle-vignette" aria-hidden />

      <div className="home-oracle-inner">
        <header className="home-oracle-head">
          <span className="home-oracle-kicker">AnimBook · ORACLE</span>
          <h2 id="home-oracle-heading" className="home-oracle-h">
            The book reads you back.
          </h2>
          <p className="home-oracle-sub">
            Verse books branch. Read to the turn, and AnimBook writes the next page from the choice you make.
          </p>
        </header>

        {loading ? (
          <div className="home-oracle-page home-oracle-skel" aria-hidden>
            <div className="home-oracle-page-eyebrow" />
            <div className="home-oracle-page-title" />
            <div className="home-oracle-page-line" />
            <div className="home-oracle-page-line" />
            <div className="home-oracle-page-line" />
          </div>
        ) : (
          <article className="home-oracle-page">
            <span className="home-oracle-page-eyebrow">From the page</span>
            <h3 className="home-oracle-page-title">Lagos Nights · The Letter</h3>
            <div className="home-oracle-page-rule" aria-hidden />
            <p className="home-oracle-page-verse">
              The postman came twice that week — once with the storm,
              once with the answer she had stopped waiting for.
            </p>
            <p className="home-oracle-page-verse">
              She did not open it. She set it on the table and watched
              the rain write on the envelope, one slow line at a time.
            </p>
            <p className="home-oracle-page-verse">
              Then she opened it. The letter asked a single question.
            </p>
            <div className="home-oracle-page-rule" aria-hidden />
            <div className="home-oracle-page-cta">
              {verseBook ? (
                <Link
                  href={`/read/${verseBook.slug}?from=oracle`}
                  className="home-oracle-btn"
                >
                  Ask the Oracle
                </Link>
              ) : (
                <span className="home-oracle-btn home-oracle-btn-disabled" aria-disabled>
                  Ask the Oracle — no Verse book yet
                </span>
              )}
              <span className="home-oracle-cta-hint">
                Three continuations. One choice. The next page writes itself.
              </span>
            </div>
          </article>
        )}

        {/* (S4 will add the three continuation cards here.) */}
      </div>
    </section>
  );
}
