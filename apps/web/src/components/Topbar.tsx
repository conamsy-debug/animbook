import Link from "next/link";
import { useRouter } from "next/router";

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
      </div>
    </header>
  );
}