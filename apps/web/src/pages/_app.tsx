import type { AppProps } from "next/app";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { AuthBridge } from "@/components/AuthBridge";
import { AccessGate } from "@/components/AccessGate";
import { LocaleProvider, EN_FALLBACK_MESSAGES } from "@/i18n/LocaleProvider";
import { defaultLocale, dirFor, isLocale, type Locale } from "@/i18n/config";
import { hreflangAlternates } from "@/i18n/hreflang";
import { loadDictionary, type Dictionary } from "@/i18n/dictionaries";
import "@/styles/globals.css";
import { Toast } from "@/components/Toast";

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/**
 * Maps a pathname's locale prefix (if any) to our Locale union. Falls
 * back to the default when Next.js's built-in i18n routes to the
 * canonical English root.
 */
function localeFromRouter(router: ReturnType<typeof useRouter>): Locale {
  if (isLocale(router.locale)) return router.locale;
  return defaultLocale;
}

/**
 * Pick the Google Fonts URL that covers every script a locale might
 * render. We always include Latin (Inter/Cormorant) for the default
 * font set, then layer Arabic (Tajawal), Devanagari (Noto Sans
 * Devanagari) and Simplified Chinese (Noto Sans SC) on top so
 * characters in those scripts never fall back to a missing-glyph
 * box. One stylesheet per language cluster keeps the network cost
 * predictable.
 */
const FONTS_HREF =
  "https://fonts.googleapis.com/css2" +
  "?family=Cormorant+Garamond:wght@400;500;600;700" +
  "&family=DM+Mono:wght@400;500" +
  "&family=Inter:wght@400;500;600;700" +
  // Arabic — used when locale=ar
  "&family=Tajawal:wght@400;500;700" +
  // Devanagari — used when locale=hi
  "&family=Noto+Sans+Devanagari:wght@400;500;600;700" +
  // Simplified Chinese — used when locale=zh-CN
  "&family=Noto+Sans+SC:wght@400;500;700" +
  // Arabic display fallback — Amiri is the canonical Arabic reading font
  "&family=Amiri:wght@400;700" +
  "&display=swap";

/**
 * Tailored font-family stacks per locale. The browser picks the first
 * family that has the glyphs we need, so Latin-script locales fall
 * back to Inter for body + Cormorant for display, Arabic gets Tajawal
 * (sans for UI) + Amiri (serif for body), Hindi gets the Devanagari
 * Noto, Chinese gets Noto Sans SC, etc. Listing more than one script
 * is intentional: a mixed-script line (e.g. a Chinese title with an
 * English brand name) shouldn't break.
 */
const fontStackFor = (locale: Locale): string => {
  const stacks: Record<Locale, string> = {
    en: `"Inter", "Noto Sans SC", "Noto Sans Devanagari", "Tajawal", system-ui, sans-serif`,
    fr: `"Inter", "Noto Sans SC", "Noto Sans Devanagari", "Tajawal", system-ui, sans-serif`,
    es: `"Inter", "Noto Sans SC", "Noto Sans Devanagari", "Tajawal", system-ui, sans-serif`,
    "pt-BR": `"Inter", "Noto Sans SC", "Noto Sans Devanagari", "Tajawal", system-ui, sans-serif`,
    sw: `"Inter", "Noto Sans SC", "Noto Sans Devanagari", "Tajawal", system-ui, sans-serif`,
    ar: `"Tajawal", "Amiri", "Noto Sans SC", "Noto Sans Devanagari", "Inter", system-ui, sans-serif`,
    hi: `"Noto Sans Devanagari", "Inter", "Tajawal", "Noto Sans SC", system-ui, sans-serif`,
    "zh-CN": `"Noto Sans SC", "Inter", "Tajawal", "Noto Sans Devanagari", system-ui, sans-serif`,
    de: `"Inter", "Noto Sans SC", "Noto Sans Devanagari", "Tajawal", system-ui, sans-serif`
  };
  return stacks[locale];
};

export default function App({ Component, pageProps }: AppProps) {
  // Register the service worker for offline support — purely a
  // progressive enhancement, errors are swallowed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js")
        .catch(() => {
          // Offline SW is a progressive enhancement; ignore failures.
        });
    }
  }, []);

  const router = useRouter();
  const locale = localeFromRouter(router);

  // Load the dictionary for the active locale client-side. next-intl
  // does this server-side too, but the message map has to be ready
  // on first paint to avoid a flash of untranslated content. We
  // load on demand + memoize so the switcher doesn't re-fetch.
  const [messages] = useLocaleMessages(locale);
  useApplyLocaleDocument(locale);

  // hreflang alternates — server-rendered so search engine crawlers
  // see them on first fetch (not deferred until after hydration).
  // `router.pathname` is the route pattern; for static routes it
  // matches `router.asPath`. For dynamic routes the locale matrix
  // is still correct because every locale gets the same path with
  // its own prefix. Falls back to "/" when neither is set yet
  // (which only happens before the router context mounts).
  const currentPath = (typeof router.asPath === "string" && router.asPath) ||
    (typeof router.pathname === "string" && router.pathname) ||
    "/";
  const alternates = useMemo(
    () => hreflangAlternates(currentPath),
    [currentPath]
  );

  const head = (
    <Head>
      <title>AnimBook — a book that moves</title>
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <meta name="theme-color" content="#080C14" />
      <meta name="application-name" content="AnimBook" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="apple-mobile-web-app-title" content="AnimBook" />
      <meta name="format-detection" content="telephone=no" />
      <link rel="icon" href="/favicon.ico" sizes="any" />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <link rel="manifest" href="/site.webmanifest" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href={FONTS_HREF} rel="stylesheet" />
      {/* Synchronous inline script — runs before first paint so
          crawlers + screen readers see the right `<html dir>` on
          static prerender (where React can't have set it yet).
          Reads the active locale from the URL prefix and stamps
          `dir` on `<html>`. The client-side effect in
          useApplyLocaleDocument will keep it correct on
          navigation. */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "(function(){var p=location.pathname.split('/')[1];var rtl=['ar'].indexOf(p)!==-1;document.documentElement.dir=rtl?'rtl':'ltr';})();"
        }}
      />
      {/* hreflang alternates — emitted on every page so search engines
          can map the locale matrix. We compute the alternates for the
          current pathname; default-locale URLs omit the prefix.
          During the static prerender pass the alternates array is
          empty (the router isn't mounted yet) so we render nothing —
          the hydration pass fills them in. */}
      {alternates.map((alt) => (
        <link key={alt.hrefLang} rel="alternate" hrefLang={alt.hrefLang} href={alt.href} />
      ))}
    </Head>
  );

  const tree = (
    <ErrorBoundary
      fallback={(err, reset) => (
        <ErrorState error={err} onRetry={reset} title="AnimBook ran into a snag" />
      )}
    >
      <Component {...pageProps} />
    </ErrorBoundary>
  );

  if (!PUBLISHABLE_KEY) {
    return (
      <>
        {head}
        {tree}
      </>
    );
  }

  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignInUrl="/library"
      afterSignUpUrl="/library"
      appearance={{
        variables: {
          colorPrimary: "#C49A1C",
          colorText: "#F4E9D8",
          colorBackground: "#080C14",
          colorInputBackground: "#101521",
          colorInputText: "#F4E9D8"
        },
        elements: {
          card: { background: "#0F1422", border: "1px solid rgba(196, 154, 28, 0.3)" },
          socialButtonsBlockButton: {
            background: "#1A2030",
            border: "1px solid rgba(242, 238, 230, 0.18)",
            color: "#F4E9D8",
            "&:hover": {
              background: "#222A3D",
              borderColor: "rgba(242, 238, 230, 0.30)"
            }
          },
          socialButtonsBlockButtonText: {
            color: "#F4E9D8",
            fontWeight: 500
          }
        }
      }}
    >
      {head}
      <AuthBridge />
      {/* LocaleProvider must wrap AccessGate because AccessGate calls
          `useTranslations("common" | "gate")` and would throw without
          an IntlContext above it. The LocaleProvider also wraps the
          topbar's LanguageSwitcher so its `useTranslations("languageSwitcher")`
          call resolves. */}
      <LocaleProvider
        locale={locale}
        messages={messages as never}
        fallback={EN_FALLBACK_MESSAGES}
      >
        <AccessGate>{tree}</AccessGate>
        <Toast />
      </LocaleProvider>
    </ClerkProvider>
  );
}

/**
 * Set `<html lang>` + `<html dir>` so screen readers and CSS
 * logical-property fallbacks pick the right writing mode.
 */
function useApplyLocaleDocument(locale: Locale) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
    document.documentElement.dir = dirFor(locale);
    // Apply the per-locale font stack to the root so every element
    // inherits it without each component re-declaring.
    document.documentElement.style.setProperty("--animbook-font", fontStackFor(locale));
  }, [locale]);
}

/**
 * Load the dictionary for the active locale on the client. next-intl
 * also wires server-side resolution via `getRequestConfig`; this
 * cache prevents a refetch when the user toggles locales.
 */
function useLocaleMessages(locale: Locale): [Dictionary] {
  const [cache, setCache] = useState<Record<string, Dictionary>>({});
  useEffect(() => {
    let cancelled = false;
    async function go() {
      const dict = await loadDictionary(locale);
      if (cancelled) return;
      setCache((prev) => ({ ...prev, [locale]: dict }));
    }
    void go();
    return () => {
      cancelled = true;
    };
  }, [locale]);
  return [cache[locale] || {}];
}
