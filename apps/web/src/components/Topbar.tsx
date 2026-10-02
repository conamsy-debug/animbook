import Link from "next/link";
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import { useTranslations } from "use-intl";
import { useAuth } from "@clerk/nextjs";
import { AccountMenu } from "@/components/AccountMenu";
import { LogoMark } from "@/components/Logo";
import { SearchIcon, MenuIcon } from "@/components/library/icons";
// import { LanguageSwitcher } from "@/components/LanguageSwitcher"; // hidden until translations ship

// Public navigation. Account items (Profile / Creator / Publishers /
// Pricing) live in the account menu on the right.
const linkKeys = [
  { href: "/library", key: "library" },
  { href: "/worlds", key: "worlds" },
  { href: "/studio", key: "studio" },
  { href: "/edu", key: "edu" },
  { href: "/signal", key: "signal" },
  { href: "/memory", key: "memory" },
  { href: "/live", key: "live" },
  { href: "/dream", key: "dream" },
  { href: "/companion", key: "companion" },
  { href: "/archive", key: "archive" },
  { href: "/school", key: "school" },
  { href: "/network", key: "network" }
];

// AnimBook Languages (Phase 1). Hidden from the topbar until the LANGUAGES
// feature flag is on. NEXT_PUBLIC_* is inlined at build time by Next.js, so
// this evaluates once on the server during prerender and ships dead code
// (the languages.tsx page renders <NotAvailable />) when the flag is off.
const LANGUAGES_ENABLED = process.env.NEXT_PUBLIC_LANGUAGES_ENABLED === "true";
if (LANGUAGES_ENABLED) {
  // Insert directly after "EDU" so Languages sits with the other learning
  // surfaces (Library, Worlds, Studio, EDU) rather than in the experimental
  // section at the end. The matching `linkKeys.findIndex` keeps this stable
  // if the surrounding nav order shifts.
  const eduIdx = linkKeys.findIndex((l) => l.href === "/edu");
  const insertAt = eduIdx >= 0 ? eduIdx + 1 : linkKeys.length;
  linkKeys.splice(insertAt, 0, { href: "/languages", key: "languages" });
}

const HAS_CLERK = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

interface TopbarProps {
  /**
   * "cinematic" renders the new library design (translucent header that
   * overlays the hero, expanding search, gold underline on links).
   * Defaults to "default" — current behavior, unchanged.
   */
  variant?: "default" | "cinematic";
  /** Library-only: current search query and setter, owned by the page. */
  searchValue?: string;
  onSearchChange?: (next: string) => void;
}

export function Topbar({ variant = "default", searchValue, onSearchChange }: TopbarProps) {
  if (variant === "cinematic") {
    return (
      <CinematicTopbar
        searchValue={searchValue ?? ""}
        onSearchChange={onSearchChange ?? (() => {})}
      />
    );
  }
  return <DefaultTopbar />;
}

function DefaultTopbar() {
  const router = useRouter();
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tTopbar = useTranslations("topbar");
  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <Link href="/" className="brand" aria-label={tCommon("appName")}>
          <LogoMark size={30} />
          <span className="brand-word">{tCommon("appName")}</span>
        </Link>
        <nav className="nav" aria-label={tCommon("primaryNav") ?? "Primary"}>
          {linkKeys.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={router.pathname === link.href || (link.href !== "/" && router.pathname.startsWith(link.href)) ? "active" : ""}
            >
              {t(link.key)}
            </Link>
          ))}
        </nav>
        <div className="topbar-actions">
          {/* <LanguageSwitcher className="topbar-lang" /> hidden until translations ship */}
          {HAS_CLERK ? (
            <DefaultTopbarAuth />
          ) : (
            <Link href="/pricing" className="btn primary" aria-label={t("createAccount")}>
              {t("getStarted")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

/** Avatar when signed in; Sign in / Get started otherwise (also while sign-in is loading). */
function DefaultTopbarAuth() {
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const t = useTranslations("nav");
  if (isSignedIn) return <AccountMenu />;
  const onAuthPage = router.pathname.startsWith("/sign-");
  const back = encodeURIComponent(router.pathname === "/" || onAuthPage ? "/library" : router.asPath);
  return (
    <>
      <Link href={`/sign-in?redirect_url=${back}`} className="btn ghost" aria-label={t("signIn")}>
        {t("signIn")}
      </Link>
      <Link href={`/sign-up?redirect_url=${back}`} className="btn primary" aria-label={t("createAccount")}>
        {t("getStarted")}
      </Link>
    </>
  );
}

/**
 * Cinematic topbar — translucent overlay for the new /library design.
 *
 * - Sticky, 76px tall, overlays the hero (negative margin equal to its height
 *   applied by the `.lib-nav` rule).
 * - Left: LogoMark + AnimBook wordmark.
 * - Center: nav links with sliding gold underline on hover/active.
 * - Right: expanding search button (40px → 250px wide), profile avatar.
 * - On phones (<700px): collapses the links into a "More" sheet.
 */
function CinematicTopbar({ searchValue, onSearchChange }: { searchValue: string; onSearchChange: (next: string) => void }) {
  const router = useRouter();
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tTopbar = useTranslations("topbar");
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Open the search field on mount if there is already a query (so URL-driven
  // searches render the input visible, not just a button).
  useEffect(() => {
    if (searchValue && searchValue.length > 0) setSearchOpen(true);
    // We intentionally only react to the initial value, not every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <header className="lib-nav">
      <div className="lib-nav-inner">
        <Link href="/" className="lib-brand" aria-label={tCommon("appName")}>
          <LogoMark size={30} />
          <span className="lib-brand-word">{tCommon("appName")}</span>
        </Link>
        <nav className="lib-navlinks" aria-label={tCommon("primaryNav") ?? "Primary"}>
          {linkKeys.map((link) => {
            const active = router.pathname === link.href || (link.href !== "/" && router.pathname.startsWith(link.href));
            return (
              <Link key={link.href} href={link.href} className={active ? "on" : undefined}>
                {t(link.key)}
              </Link>
            );
          })}
        </nav>
        <div className="lib-navtools">
          {/* <LanguageSwitcher className="lib-nav-lang" /> hidden until translations ship */}
          <form
            className={`lib-sform${searchOpen ? " open" : ""}`}
            onSubmit={(e) => e.preventDefault()}
            role="search"
            aria-label={tTopbar("searchLibrary")}
          >
            <button
              type="button"
              className="lib-navbtn"
              aria-label={searchOpen ? tTopbar("closeSearch") : tTopbar("openSearch")}
              onClick={() => setSearchOpen((o) => !o)}
            >
              <SearchIcon />
            </button>
            <input
              className="lib-sinput"
              type="search"
              placeholder={tTopbar("searchPlaceholder")}
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              tabIndex={searchOpen ? 0 : -1}
            />
          </form>
          {HAS_CLERK ? <CinematicTopbarAuth /> : (
            <Link href="/pricing" className="lib-navbtn" aria-label={t("createAccount")}>
              <MenuIcon />
            </Link>
          )}
          <button
            type="button"
            className="lib-navbtn"
            aria-label={tTopbar("more")}
            onClick={() => setMoreOpen((o) => !o)}
          >
            <MenuIcon />
          </button>
        </div>
        {moreOpen && (
          <div className="lib-navmore" role="menu">
            {linkKeys.map((link) => (
              <Link key={link.href} href={link.href} className="lib-navmore-item" role="menuitem">
                {t(link.key)}
              </Link>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

/** Avatar when signed in (Clerk); show a generic account chip otherwise. */
function CinematicTopbarAuth() {
  const { isSignedIn } = useAuth();
  if (isSignedIn) return <AccountMenu />;
  return (
    <Link href="/sign-in" className="lib-navbtn" aria-label="Sign in">
      <span className="lib-account-initials">AI</span>
    </Link>
  );
}
