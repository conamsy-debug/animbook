import { useClerk, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

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
 *
 * On open we also fetch `/api/lang/me` to learn the user's backend `roles`
 * (e.g. `platform_admin`) so we can conditionally surface the
 * "Languages admin" link. Roles live on the DB user row, not on Clerk
 * metadata, so we have to round-trip. The fetch happens once per menu
 * open and is cached for the rest of the session in `rolesRef`.
 */
export function AccountMenu() {
  const { user } = useUser();
  const clerk = useClerk();
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<string[] | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape, same as before.
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

  // Lazy-fetch roles when the menu first opens. Cached in state for
  // the rest of the session — roles don't change mid-session.
  useEffect(() => {
    if (!open || roles !== null) return;
    let cancelled = false;
    apiFetch<{ roles: string[] }>("/api/lang/me")
      .then((data) => {
        if (cancelled) return;
        setRoles(data?.roles ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        // Signed-out user or 404 — don't surface admin link. Same
        // effect as the API never returning.
        setRoles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, roles]);

  const name = user?.fullName ?? user?.username ?? "Your account";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const initials = (user?.firstName?.[0] ?? name[0] ?? "A").toUpperCase();
  const isPlatformAdmin = roles?.includes("platform_admin") ?? false;

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
            {isPlatformAdmin ? (
              <Link
                key="languages-admin"
                href="/languages/admin/stories"
                role="menuitem"
                className="account-admin"
                onClick={() => setOpen(false)}
              >
                Languages admin
              </Link>
            ) : null}
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
