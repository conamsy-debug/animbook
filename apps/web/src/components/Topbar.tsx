import Link from "next/link";
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { AccountMenu } from "@/components/AccountMenu";
import { LogoMark } from "@/components/Logo";
import { SearchIcon, MenuIcon } from "@/components/library/icons";

// Public navigation. Account items (Profile / Creator / Publishers /
// Pricing) live in the account menu on the right.
const links = [
  { href: "/library", label: "Library" },
  { href: "/worlds", label: "Worlds" },
  { href: "/studio", label: "Studio" },
  { href: "/edu", label: "EDU" },
  { href: "/signal", label: "Signal" },
  { href: "/memory", label: "Memory" },
  { href: "/live", label: "Live" },
  { href: "/dream", label: "Dream" },
  { href: "/companion", label: "Companion" },
  { href: "/archive", label: "Archive" },
  { href: "/school", label: "School" },
  { href: "/network", label: "Network" }
];

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
  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <Link href="/" className="brand" aria-label="AnimBook home">
          <LogoMark size={30} />
          <span className="brand-word">AnimBook</span>
        </Link>
        <nav className="nav" aria-label="Primary">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={router.pathname === link.href || (link.href !== "/" && router.pathname.startsWith(link.href)) ? "active" : ""}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="topbar-actions">
          {HAS_CLERK ? (
            <DefaultTopbarAuth />
          ) : (
            <Link href="/pricing" className="btn primary" aria-label="Get started">
              Get Started
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
  if (isSignedIn) return <AccountMenu />;
  const onAuthPage = router.pathname.startsWith("/sign-");
  const back = encodeURIComponent(router.pathname === "/" || onAuthPage ? "/library" : router.asPath);
  return (
    <>
      <Link href={`/sign-in?redirect_url=${back}`} className="btn ghost" aria-label="Sign in">
        Sign in
      </Link>
      <Link href={`/sign-up?redirect_url=${back}`} className="btn primary" aria-label="Create account">
        Get started
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
        <Link href="/" className="lib-brand" aria-label="AnimBook home">
          <LogoMark size={30} />
          <span className="lib-brand-word">AnimBook</span>
        </Link>
        <nav className="lib-navlinks" aria-label="Primary">
          {links.map((link) => {
            const active = router.pathname === link.href || (link.href !== "/" && router.pathname.startsWith(link.href));
            return (
              <Link key={link.href} href={link.href} className={active ? "on" : undefined}>
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="lib-navtools">
          <form
            className={`lib-sform${searchOpen ? " open" : ""}`}
            onSubmit={(e) => e.preventDefault()}
            role="search"
            aria-label="Search the library"
          >
            <button
              type="button"
              className="lib-navbtn"
              aria-label={searchOpen ? "Close search" : "Open search"}
              onClick={() => setSearchOpen((o) => !o)}
            >
              <SearchIcon />
            </button>
            <input
              className="lib-sinput"
              type="search"
              placeholder="Search titles, authors…"
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              tabIndex={searchOpen ? 0 : -1}
            />
          </form>
          {HAS_CLERK ? <CinematicTopbarAuth /> : (
            <Link href="/pricing" className="lib-navbtn" aria-label="Get started">
              <MenuIcon />
            </Link>
          )}
          <button
            type="button"
            className="lib-navbtn"
            aria-label="More"
            onClick={() => setMoreOpen((o) => !o)}
          >
            <MenuIcon />
          </button>
        </div>
        {moreOpen && (
          <div className="lib-navmore" role="menu">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="lib-navmore-item" role="menuitem">
                {link.label}
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
