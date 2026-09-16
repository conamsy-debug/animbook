import Link from "next/link";
import { useRouter } from "next/router";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

const links = [
  { href: "/", label: "Library" },
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
  { href: "/creator", label: "Creator" },
  { href: "/publishers", label: "Publishers" },
  { href: "/network", label: "Network" },
  { href: "/pricing", label: "Pricing" },
  { href: "/profile", label: "Profile" }
];

const HAS_CLERK = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function Topbar() {
  const router = useRouter();
  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <Link href="/" className="brand" aria-label="AnimBook home">
          AnimBook<span className="dot" aria-hidden />
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
            <>
              <SignedOut>
                <SignInButton mode="modal" forceRedirectUrl="/library">
                  <button type="button" className="btn ghost" aria-label="Sign in">
                    Sign In
                  </button>
                </SignInButton>
                <SignUpButton mode="modal" forceRedirectUrl="/library">
                  <button type="button" className="btn primary" aria-label="Create account">
                    Get Started
                  </button>
                </SignUpButton>
              </SignedOut>
              <SignedIn>
                <UserButton
                  afterSignOutUrl="/"
                  appearance={{
                    variables: { colorPrimary: "#C49A1C" },
                    elements: {
                      userButtonPopoverCard: { background: "#0F1422", border: "1px solid rgba(196, 154, 28, 0.3)" },
                      userButtonPopoverText: { color: "#F4E9D8" }
                    }
                  }}
                />
              </SignedIn>
            </>
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
