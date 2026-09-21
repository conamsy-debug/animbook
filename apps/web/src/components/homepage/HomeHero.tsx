import { useEffect, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import type { PageRecord } from "@/lib/api";
import { VERTICALS } from "@/lib/verticals";

/** Number of curated narrator voices in production. Kept as a constant
 *  (not derived from a server fetch) because the client doesn't ship
 *  the voice catalog and the count rarely changes. Update alongside
 *  apps/api/src/config/voices.ts if a voice is added. */
const NARRATOR_VOICES = 5;

interface Props {
  /** The featured page (already fetched). Used to pull the still for the
   *  blurred backdrop when no video is available, and to pass to the
   *  living card. */
  featuredPage: PageRecord | null;
  /** Total books loaded for the "books" stat. */
  totalBooks: number;
  /** Loading state for the books stat ("—" while loading). */
  loading: boolean;
  /** Children: the LivingCard rendered beside the copy on desktop,
   *  below it on phone. */
  children?: React.ReactNode;
}

/**
 * HomeHero — backdrop + copy + buttons + stats + load sequence.
 *
 * Layered from back to front:
 *   (a) Blurred backdrop from the featured still (inset -6%) with a
 *       slow Ken Burns drift.
 *   (b) Horizontal scrim 90deg.
 *   (c) Bottom fade.
 *   (d) Copy block + LivingCard (slot via children).
 *
 * The cinematic nav lives outside this component but the hero relies
 * on the same negative-bottom-margin trick to overlay it.
 */
export function HomeHero({ featuredPage, totalBooks, loading, children }: Props) {
  const bgRef = useRef<HTMLDivElement | null>(null);
  const { isSignedIn } = useAuth();

  // Slow Ken Burns on the backdrop. Skip on reduced-motion and on touch.
  useEffect(() => {
    const bg = bgRef.current;
    if (!bg) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(hover: none)").matches) return;
    // The drift is pure CSS (animation: kb) — this effect is intentionally
    // empty for now; we keep the ref for future parallax hooks.
  }, []);

  const verticalCount = VERTICALS.length;
  const narratorCount = NARRATOR_VOICES;

  return (
    <section className="home-hero" aria-label="AnimBook">
      <div ref={bgRef} className="home-hbgwrap">
        <div
          className="home-hbg"
          style={featuredPage?.posterUrl ? { backgroundImage: `url(${featuredPage.posterUrl})` } : undefined}
          aria-hidden
        />
      </div>

      <div className="home-hcopy">
        <div className="home-hkick">A book that moves</div>
        <h1 className="home-hh">Open a page. Watch a world come alive.</h1>
        <p className="home-hp">
          Every AnimBook pairs the original text with its own animation and a narrator you can choose.
          Read it, watch it, or listen.
        </p>
        <div className="home-hcta">
          {isSignedIn ? (
            <Link href="/library" className="home-btn home-btn-gold">Open the library</Link>
          ) : (
            <Link
              href={`/sign-in?redirect_url=${encodeURIComponent("/library")}`}
              className="home-btn home-btn-gold"
            >
              Open the library
            </Link>
          )}
          <Link href="/studio" className="home-btn home-btn-glass">Create in Studio</Link>
        </div>
        <ul className="home-hstats" aria-label="AnimBook at a glance">
          <li className="home-hstat">
            <b>{loading ? "—" : totalBooks}</b>
            <span>AnimBooks</span>
          </li>
          <li className="home-hstat">
            <b>{verticalCount}</b>
            <span>verticals</span>
          </li>
          <li className="home-hstat">
            <b>{narratorCount}</b>
            <span>narrator voices</span>
          </li>
        </ul>
      </div>

      {children}
    </section>
  );
}
