import Link from "next/link";
import { useRouter } from "next/router";
import { useAuth } from "@clerk/nextjs";
import { AccountMenu } from "@/components/AccountMenu";
import { LogoMark } from "@/components/Logo";

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
