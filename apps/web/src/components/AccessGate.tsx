import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { Topbar } from "@/components/Topbar";
import { LoadingState } from "@/components/States";

/**
 * Strip the locale prefix from a pathname so the open-route check
 * works regardless of the active locale (`/fr/library` and
 * `/library` should both be open to visitors).
 */
function stripLocale(pathname: string): string {
  const seg = pathname.split("/")[1];
  if (
    [
      "en",
      "fr",
      "es",
      "pt-BR",
      "sw",
      "ar",
      "hi",
      "zh-CN",
      "de"
    ].includes(seg)
  ) {
    const rest = pathname.split("/").slice(2).join("/");
    return rest ? `/${rest}` : "/";
  }
  return pathname;
}

/**
 * Visitors can look around (home, library, book pages, pricing, legal) but
 * need a free account to read, watch, listen or use the features.
 */
const OPEN_PREFIXES = ["/library", "/book", "/author", "/pricing", "/legal", "/sign-in", "/sign-up", "/worlds", "/docs", "/404"];

export function isOpenRoute(pathname: string): boolean {
  const stripped = stripLocale(pathname);
  if (stripped === "/" || stripped === "/_error") return true;
  return OPEN_PREFIXES.some((p) => stripped === p || stripped.startsWith(`${p}/`));
}

export function AccessGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const tCommon = useTranslations("common");
  const tGate = useTranslations("gate");
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
          <LoadingState message={tCommon("opening")} />
        </main>
      </div>
    );
  }
  if (isSignedIn) return <>{children}</>;

  const back = encodeURIComponent(router.asPath);
  // Keep the user on the same locale — built-in i18n would otherwise
  // route a bare `/library` link back to the canonical English URL.
  const activeLocale = router.locale ?? "en";
  const libraryHref = activeLocale === "en" ? "/library" : `/${activeLocale}/library`;
  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <section className="gate-card">
          <span className="label">{tGate("label")}</span>
          <h1>{tGate("title")}</h1>
          <p className="muted">{tGate("body")}</p>
          <ul className="gate-points">
            <li>{tGate("point1")}</li>
            <li>{tGate("point2")}</li>
            <li>{tGate("point3")}</li>
          </ul>
          <div className="hero-actions">
            <Link href={`/sign-up?redirect_url=${back}`} className="btn primary">
              {tGate("createAccount")}
            </Link>
            <Link href={`/sign-in?redirect_url=${back}`} className="btn ghost">
              {tGate("haveAccount")}
            </Link>
            <Link href={libraryHref} className="btn">
              {tCommon("keepBrowsing")}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
