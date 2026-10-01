/**
 * AnimBook i18n middleware.
 *
 * Responsibilities:
 *  1. Persist the locale picked by Next.js's built-in i18n routing
 *     (the URL prefix or default-root) into a cookie so the user's
 *     preference survives reloads + cross-device sync.
 *  2. On first visit, redirect a root request to the best matching
 *     locale via Accept-Language negotiation.
 *  3. Compose cleanly with Clerk's auth. The project does NOT use
 *     `clerkMiddleware` (auth is client-side via AccessGate + AuthBridge),
 *     but if Clerk middleware is added later it should be composed
 *     here via the standard `composeMiddleware` pattern.
 *  4. Skip API routes, Next.js internals, static assets, and the
 *     root health endpoint.
 */
import { NextRequest, NextResponse } from "next/server";
import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";
import { defaultLocale, locales, type Locale, isLocale, shortLocale } from "@/i18n/config";

const COOKIE_NAME = "animbook_locale";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function pickLocale(req: NextRequest): Locale {
  // 1. Explicit cookie set by an earlier visit
  const cookieLocale = req.cookies.get(COOKIE_NAME)?.value;
  if (cookieLocale) {
    // The cookie stores the short form (`pt`, `zh`) so the round-trip
    // works with raw Accept-Language tags. Map back to a full Locale.
    const matched = locales.find((l) => shortLocale(l) === cookieLocale);
    if (matched) return matched as Locale;
  }

  // 2. Accept-Language header from the browser
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    if (key.toLowerCase() === "accept-language") headers["accept-language"] = value;
  });
  const requested = new Negotiator({ headers }).languages();
  try {
    const matched = match(requested, locales as unknown as string[], defaultLocale as unknown as string);
    if (isLocale(matched)) return matched;
  } catch {
    // Negotiator/match can throw on exotic Accept-Language headers;
    // we fall through to the default below.
  }

  // 3. Default
  return defaultLocale;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip internals + static + API + service workers
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

  // Path already starts with a known locale. We don't have separate
  // /pages/<locale>/... files (translations are pending). Set the
  // cookie so the locale preference is preserved, but let Next.js
  // serve the canonical page via rewrites (configured in next.config
  // — /fr/:path* maps to /:path*). If the rewrite doesn't match (e.g.
  // bare /fr), Next.js will fall through to the 404 page.
  const firstSegment = pathname.split("/")[1];
  if (isLocale(firstSegment)) {
    const response = NextResponse.next();
    response.cookies.set(COOKIE_NAME, shortLocale(firstSegment), {
      path: "/",
      maxAge: COOKIE_MAX_AGE,
      sameSite: "lax"
    });
    return response;
  }

  // Bare path (no locale prefix). Next.js's i18n config treats the
  // default-locale URL as canonical (no redirect), but for a visitor
  // whose browser prefers a non-default locale we redirect to the
  // matching /<locale>/<path> so they land on their preferred
  // language immediately.
  const target = pickLocale(req);
  if (target === defaultLocale) {
    // Default locale is already at the root; just persist the cookie
    // so we don't re-detect on every visit.
    const response = NextResponse.next();
    if (!req.cookies.get(COOKIE_NAME)) {
      response.cookies.set(COOKIE_NAME, shortLocale(target), {
        path: "/",
        maxAge: COOKIE_MAX_AGE,
        sameSite: "lax"
      });
    }
    return response;
  }

  // Non-default locale → redirect to /<locale>/<path>
  const url = req.nextUrl.clone();
  url.pathname = `/${target}${pathname === "/" ? "" : pathname}`;
  const response = NextResponse.redirect(url);
  response.cookies.set(COOKIE_NAME, shortLocale(target), {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax"
  });
  return response;
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
