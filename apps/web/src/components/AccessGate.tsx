import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, type ReactNode } from "react";
import { Topbar } from "@/components/Topbar";
import { LoadingState } from "@/components/States";

/**
 * Visitors can look around (home, library, book pages, pricing, legal) but
 * need a free account to read, watch, listen or use the features.
 */
const OPEN_PREFIXES = ["/library", "/book", "/pricing", "/legal", "/sign-in", "/sign-up", "/worlds", "/docs", "/404"];

export function isOpenRoute(pathname: string): boolean {
  if (pathname === "/" || pathname === "/_error") return true;
  return OPEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function AccessGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  // If sign-in can't load (slow connection, blocker), show the sign-up card
  // after a few seconds instead of spinning forever.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (isLoaded) return;
    const t = window.setTimeout(() => setGaveUp(true), 6000);
    return () => window.clearTimeout(t);
  }, [isLoaded]);
  if (isOpenRoute(router.pathname)) return <>{children}</>;
  if (!isLoaded && !gaveUp) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <LoadingState message="Opening…" />
        </main>
      </div>
    );
  }
  if (isSignedIn) return <>{children}</>;

  const back = encodeURIComponent(router.asPath);
  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <section className="gate-card">
          <span className="label">Free account needed</span>
          <h1>Create your free account to continue.</h1>
          <p className="muted">
            Browsing the library is open to everyone. To read, watch and listen to AnimBooks — and to use Worlds, Dream,
            Memory, Live and Studio — sign up. It takes a minute.
          </p>
          <ul className="gate-points">
            <li>Every page animated and narrated</li>
            <li>Choose your narrator and let pages turn by themselves</li>
            <li>Your library and reading progress saved</li>
          </ul>
          <div className="hero-actions">
            <Link href={`/sign-up?redirect_url=${back}`} className="btn primary">
              Create free account
            </Link>
            <Link href={`/sign-in?redirect_url=${back}`} className="btn ghost">
              I already have an account
            </Link>
            <Link href="/library" className="btn">
              Keep browsing
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
