import { useAuth, useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/Logo";

/**
 * Branded sign-in / sign-up page. Clerk's form opens as a pop-up over it
 * (the pop-up keeps Clerk's own styling), then returns the reader to the
 * page they came from.
 */
const HAS_CLERK = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function AuthScreen({ mode }: { mode: "sign-in" | "sign-up" }) {
  if (!HAS_CLERK) {
    return (
      <div className="auth-screen">
        <div className="auth-panel">
          <h1>Sign-in isn&apos;t configured</h1>
          <p className="muted">This build has no Clerk key, so accounts are unavailable.</p>
          <Link href="/library" className="auth-back">
            ← Browse the library
          </Link>
        </div>
      </div>
    );
  }
  return <ClerkAuthScreen mode={mode} />;
}

function ClerkAuthScreen({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const clerk = useClerk();
  const { isLoaded, isSignedIn } = useAuth();
  const opened = useRef(false);
  const [slow, setSlow] = useState(false);

  const raw = typeof router.query.redirect_url === "string" ? router.query.redirect_url : "/library";
  // Only allow returning to pages on this site.
  const target = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/library";

  const open = () => {
    const common = { forceRedirectUrl: target, signInForceRedirectUrl: target, signUpForceRedirectUrl: target };
    if (mode === "sign-in") clerk.openSignIn(common);
    else clerk.openSignUp(common);
  };

  useEffect(() => {
    if (!router.isReady || !isLoaded) return;
    if (isSignedIn) {
      void router.replace(target);
      return;
    }
    if (!opened.current) {
      opened.current = true;
      open();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, isLoaded, isSignedIn]);

  useEffect(() => {
    if (isLoaded) return;
    const t = window.setTimeout(() => setSlow(true), 6000);
    return () => window.clearTimeout(t);
  }, [isLoaded]);

  const signIn = mode === "sign-in";
  const other = `/${signIn ? "sign-up" : "sign-in"}?redirect_url=${encodeURIComponent(target)}`;

  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <Link href="/" className="auth-brand" aria-label="AnimBook home">
          <LogoMark size={44} />
          <span>AnimBook</span>
        </Link>
        <h1>{signIn ? "Welcome back." : "Create your free account."}</h1>
        <p className="muted">
          {signIn
            ? "Sign in to pick up where you left off — your library, your narrator and your place in every book."
            : "Read, watch and listen to every AnimBook, choose your narrator, and keep your place in every book."}
        </p>
        <div className="hero-actions">
          <button type="button" className="btn primary" onClick={open} disabled={!isLoaded}>
            {!isLoaded ? "Loading…" : signIn ? "Sign in" : "Create account"}
          </button>
          <Link href={other} className="btn ghost">
            {signIn ? "New here? Create an account" : "I already have an account"}
          </Link>
        </div>
        {slow && !isLoaded && (
          <p className="muted auth-note">
            Sign-in is taking longer than usual. Check your connection, or try again in a moment.
          </p>
        )}
        <Link href="/library" className="auth-back">
          ← Keep browsing the library
        </Link>
      </div>
    </div>
  );
}
