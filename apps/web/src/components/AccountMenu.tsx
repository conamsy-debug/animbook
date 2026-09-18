import { useClerk, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const ITEMS = [
  { href: "/profile", label: "Profile" },
  { href: "/library", label: "My library" },
  { href: "/circles", label: "Reading circles" },
  { href: "/messages", label: "Messages" },
  { href: "/studio", label: "Studio" },
  { href: "/creator", label: "Creator" },
  { href: "/publishers", label: "Publishers" },
  { href: "/pricing", label: "Pricing" }
];

/**
 * AnimBook's own account menu. Clerk's built-in popover doesn't always pick up
 * its styling inside our pages (it has rendered unstyled, and dark-on-dark),
 * so the menu is ours; Clerk still handles the account panel and sign-out.
 */
export function AccountMenu() {
  const { user } = useUser();
  const clerk = useClerk();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    };
    const onEsc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const name = user?.fullName ?? user?.username ?? "Your account";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const initials = (user?.firstName?.[0] ?? name[0] ?? "A").toUpperCase();

  return (
    <div className="account-menu" ref={ref}>
      <button
        type="button"
        className="account-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Your account"
      >
        {user?.imageUrl ? <img src={user.imageUrl} alt="" /> : <span className="account-initials">{initials}</span>}
      </button>
      {open && (
        <div className="account-panel" role="menu">
          <div className="account-head">
            {user?.imageUrl ? <img src={user.imageUrl} alt="" /> : <span className="account-initials big">{initials}</span>}
            <span>
              <strong>{name}</strong>
              {email && <small>{email}</small>}
            </span>
          </div>
          <div className="account-links">
            {ITEMS.map((item) => (
              <Link key={item.href} href={item.href} role="menuitem" onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            ))}
          </div>
          <div className="account-foot">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                clerk.openUserProfile();
              }}
            >
              Manage account & security
            </button>
            <button
              type="button"
              role="menuitem"
              className="sign-out"
              onClick={() => {
                setOpen(false);
                void clerk.signOut({ redirectUrl: "/" });
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
