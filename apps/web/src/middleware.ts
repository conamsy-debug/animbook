/**
 * AnimBook middleware (post-translations-pending).
 *
 * Purpose: collapse any /<locale> or /<locale>/<path*> URL prefix back
 * to the canonical (English) path so visitors can never land on a
 * locale-routed page that would 404 or render half-translated content.
 *
 * Until the secondary locale dictionaries are actually populated
 * (en.json has 206 entries today; fr/es/pt/sw/ar/hi/zh/de are all
 * `{}`), the language switcher is hidden from the top bar and the
 * i18n middleware should NOT preserve or restore any locale preference.
 *
 * For every locale-prefixed URL — /fr, /fr/library, /pt-BR, /zh-CN,
 * /pt (short form), /zh (short form), etc. — we 307-redirect to the
 * same path with the prefix stripped and clear the animbook_locale
 * cookie so it can't trigger further redirects. No-loop guarantee:
 * the canonical (post-strip) path never starts with a known locale
 * segment, so this middleware returns NextResponse.next() for it and
 * the redirect chain terminates in a single hop.
 *
 * The locale helpers (locales, isLocale, etc.) and the LanguageSwitcher
 * component remain in the repo so the i18n code can be re-enabled
 * wholesale when the dictionaries are filled in.
 */
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "animbook_locale";

/**
 * Full BCP-47 tags that can appear as a URL prefix. We include both the
 * full tags (`pt-BR`, `zh-CN`) AND the short forms (`pt`, `zh`) the
 * language switcher could produce, so any variant collapses to the same
 * canonical URL.
 */
const KNOWN_LOCALE_PREFIXES = new Set([
  "en",
  "fr",
  "es",
  "pt",     // short form of pt-BR
  "pt-BR",
  "sw",
  "ar",
  "hi",
  "zh",     // short form of zh-CN
  "zh-CN",
  "de"
]);

function getFirstSegment(pathname: string): string {
  // pathname is always "/foo/bar/..." — split returns ["", "foo", "bar"]
  const parts = pathname.split("/");
  return parts[1] ?? "";
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip internals + static + API + service workers. None of these
  // need locale handling.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/_vercel") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    /\.[a-zA-Z0-9]{1,5}$/.test(pathname) // any extension = static asset
  ) {
    return NextResponse.next();
  }

  // Collapse /<locale> or /<locale>/<path> → <path> in one redirect.
  // Clear the cookie so subsequent visits don't try to restore the
  // preference and bounce back into a locale URL.
  const firstSegment = getFirstSegment(pathname);
  if (KNOWN_LOCALE_PREFIXES.has(firstSegment)) {
    const stripped = pathname.replace(/^\/[^/]+/, "") || "/";
    const url = req.nextUrl.clone();
    url.pathname = stripped;
    const response = NextResponse.redirect(url);
    response.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  // Match the bare root path AND every other page path (except Next
  // internals + static assets). Two matchers because Next.js's
  // default matcher compiles to a regex that requires at least one
  // path segment, so bare `/` slips through unless we list it
  // explicitly.
  matcher: [
    "/",
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"
  ]
};