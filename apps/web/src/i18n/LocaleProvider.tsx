/**
 * Server + client locale provider.
 *
 * The App Router equivalent of next-intl's `NextIntlClientProvider` for
 * the Pages Router: we use the underlying `use-intl` `IntlProvider`
 * directly so SSR + client render use the same component tree. The
 * "client" version of next-intl relies on a `"use client"` boundary
 * which is fine on the App Router but throws during Pages Router's
 * static prerender pass when no provider is mounted (because the
 * bundler hoists hooks above the provider's `createElement`).
 *
 * `messages` is the active-locale dictionary; `fallback` is the
 * default-locale English dictionary. We merge them so missing keys
 * in the active locale silently fall back to English on both the
 * server-rendered first paint and the client hydration pass.
 */
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import type { AbstractIntlMessages } from "next-intl";
import { dirFor, type Locale } from "./config";
import enFallback from "../../messages/en.json";

/** Default-locale English dictionary, imported eagerly so the
 *  server-rendered first paint always has a complete messages map. */
export const EN_FALLBACK_MESSAGES = enFallback as AbstractIntlMessages;

export function LocaleProvider({
  locale,
  messages,
  fallback,
  children
}: {
  locale: Locale;
  messages: AbstractIntlMessages;
  fallback?: AbstractIntlMessages;
  children: ReactNode;
}) {
  const merged: AbstractIntlMessages = fallback
    ? (deepMerge(fallback as Record<string, unknown>, messages as Record<string, unknown>) as AbstractIntlMessages)
    : messages;

  return (
    <IntlProvider
      locale={locale}
      messages={merged}
      // Default time zone — pages can override per-formatter.
      timeZone="UTC"
      // Default values interpolated into every translation: passes
      // {year} as a placeholder for `common.copyright` etc.
      defaultTranslationValues={{
        year: new Date().getFullYear()
      }}
    >
      <div dir={dirFor(locale)} data-locale={locale} style={{ minHeight: "100%" }}>
        {children}
      </div>
    </IntlProvider>
  );
}

/** Deep merge: `b` wins on leaf conflicts. */
function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Record<string, unknown> {
  if (!b) return a;
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const av = out[k];
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      av &&
      typeof av === "object" &&
      !Array.isArray(av)
    ) {
      out[k] = deepMerge(av as Record<string, unknown>, v as Record<string, unknown>);
    } else if (v !== undefined && v !== null) {
      out[k] = v;
    }
  }
  return out;
}
