/**
 * Language switcher — shown in the header. Lets the user pick any of
 * the 9 supported locales. Each language is labelled in its own
 * name (العربية, Français, 中文, …).
 *
 * Implementation notes:
 *  - Uses `useRouter` to preserve the user's current path while
 *    swapping the locale prefix. `/library` (en) with locale=fr →
 *    `/fr/library`; `/fr/library` with locale=zh-CN → `/zh-CN/library`.
 *  - On click we also fire-and-forget the `/api/me/locale` endpoint
 *    so signed-in users have their preference persisted in the DB.
 *  - The dropdown is keyboard-navigable and closes on outside click.
 */
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { locales, localeNames, type Locale, isLocale, defaultLocale } from "@/i18n/config";
import { useTranslations } from "use-intl";
import { apiFetch } from "@/lib/api";

/** Drop the locale segment off the front of a pathname. */
function stripLocale(pathname: string): string {
  const parts = pathname.split("/");
  if (isLocale(parts[1])) {
    const rest = parts.slice(2).join("/");
    return rest ? `/${rest}` : "/";
  }
  return pathname;
}

/** Build the localized URL for a target locale, preserving the path. */
function localizedHref(locale: Locale, pathname: string): string {
  const stripped = stripLocale(pathname);
  if (locale === defaultLocale) return stripped === "/" ? "/" : stripped;
  return stripped === "/" ? `/${locale}` : `/${locale}${stripped}`;
}

/** Best-effort POST to persist the locale for signed-in users. */
function persistLocally(locale: Locale) {
  try {
    // The cookie is set by the middleware; localStorage is just a
    // synchronous mirror so client code can read the active locale
    // on first paint without a re-fetch.
    window.localStorage.setItem("animbook_locale", locale);
  } catch {
    // localStorage can throw in private-browsing / SSR — non-fatal.
  }
}

async function persistToServer(locale: Locale) {
  try {
    await apiFetch("/me/locale", {
      method: "POST",
      json: { locale }
    });
  } catch {
    // Anonymous visitors don't have an account row; the cookie is
    // enough and the next sign-in will pick the language up from the
    // cookie via the LocaleProvider.
  }
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const router = useRouter();
  const t = useTranslations("languageSwitcher");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current: Locale = isLocale(router.locale) ? router.locale : defaultLocale;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function pick(locale: Locale) {
    persistLocally(locale);
    void persistToServer(locale);
    setOpen(false);
    const href = localizedHref(locale, router.asPath || router.pathname);
    void router.push(href);
  }

  return (
    <div ref={ref} className={`lang-switcher ${className ?? ""}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("currentLanguage", { locale: localeNames[current] })}
        className="lang-switcher-trigger btn ghost small"
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true" className="lang-switcher-globe">🌐</span>
        <span className="lang-switcher-current">{localeNames[current]}</span>
        <span aria-hidden="true" className="lang-switcher-caret">▾</span>
      </button>
      {open && (
        <ul role="listbox" aria-label={t("label")} className="lang-switcher-menu">
          {locales.map((loc) => (
            <li key={loc} role="option" aria-selected={loc === current}>
              {loc === current ? (
                <span className="lang-switcher-current-row" aria-current="true">
                  {localeNames[loc]}
                </span>
              ) : (
                <button
                  type="button"
                  className="lang-switcher-option"
                  onClick={() => pick(loc)}
                  aria-label={t("switchTo", { locale: localeNames[loc] })}
                >
                  {localeNames[loc]}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

