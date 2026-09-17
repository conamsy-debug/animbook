import Link from "next/link";
import { useRouter } from "next/router";
import { UserButton, useAuth } from "@clerk/nextjs";
import { LogoMark } from "@/components/Logo";

// Public navigation — product sections only.
// Account items (Creator / Publishers / Pricing / Profile) live in the
// signed-in UserButton menu on the hero's right.
const links = [
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

// Tiny inline icons for the user-menu items (Clerk requires labelIcon).
const IconCreator = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const IconPublishers = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <path d="M3 9V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3" />
    <path d="M8 7h8" />
  </svg>
);
const IconPricing = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
    <path d="M7 7h.01" />
  </svg>
);
const IconProfile = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21v-1a8 8 0 0 1 16 0v1" />
  </svg>
);

const HAS_CLERK = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function Topbar() {
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
            <TopbarAuth />
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
function TopbarAuth() {
  const router = useRouter();
  const { isSignedIn } = useAuth();
  if (isSignedIn) {
    return (
      <span className="avatar-slot">
        <UserButton
          afterSignOutUrl="/"
          appearance={{
            variables: { colorPrimary: "#C49A1C", colorText: "#F4E9D8", colorTextOnPrimaryBackground: "#F4E9D8", colorInputText: "#F4E9D8" },
            elements: {
              avatarBox: { width: "36px", height: "36px" },
              userButtonAvatarBox: { width: "36px", height: "36px" },
              userButtonPopoverCard: { background: "#0F1422", border: "1px solid rgba(196, 154, 28, 0.3)" },
              userButtonPopoverText: { color: "#F4E9D8" },
              userButtonPopoverMain: { color: "#F4E9D8" },
              userButtonPopoverActionButton: { color: "#F4E9D8" },
              userButtonPopoverActionButtonText: { color: "#F4E9D8", fontWeight: "500" },
              userButtonPopoverActionButtonIcon: { color: "#F4E9D8" },
              userButtonPopoverActionButtonIconBox: { color: "#F4E9D8" },
              userButtonPopoverFooter: { color: "#A89C84" },
              userButtonPopoverFooterPagesLink: { color: "#C49A1C" }
            }
          }}
        >
          <UserButton.MenuItems>
            <UserButton.Link label="Creator" href="/creator" labelIcon={<IconCreator />} />
            <UserButton.Link label="Publishers" href="/publishers" labelIcon={<IconPublishers />} />
            <UserButton.Link label="Pricing" href="/pricing" labelIcon={<IconPricing />} />
            <UserButton.Link label="Profile" href="/profile" labelIcon={<IconProfile />} />
          </UserButton.MenuItems>
        </UserButton>
      </span>
    );
  }
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
