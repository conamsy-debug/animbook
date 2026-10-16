/**
 * AnimBook i18n configuration.
 *
 * Defines the 9 supported locales (1 default + 8 secondary), their
 * native display names (for the language switcher), direction (LTR/RTL),
 * and BCP-47 → Intl locale tags for date/number formatting.
 *
 * The locale codes here match Next.js's built-in i18n config in
 * `next.config.mjs` (`pt-BR` and `zh-CN` use the full BCP-47 region
 * tags). The messages file slugs are derived from these (the region
 * tag is dropped: `messages/pt.json`, `messages/zh.json`).
 */
export const locales = [
  "en",     // English (default)
  "fr",     // French
  "es",     // Spanish
  "pt-BR",  // Portuguese (Brazilian)
  "sw",     // Swahili
  "ar",     // Arabic (RTL)
  "hi",     // Hindi
  "zh-CN",  // Simplified Chinese
  "de"      // German
] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/**
 * Native names — what the user sees in the language switcher.
 * RTL Arabic uses the Arabic-script form of the language name.
 */
export const localeNames: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  "pt-BR": "Português",
  sw: "Kiswahili",
  ar: "العربية",
  hi: "हिन्दी",
  "zh-CN": "中文",
  de: "Deutsch"
};

/** ISO codes for Intl APIs (DateTimeFormat, NumberFormat). */
export const localeIntlTags: Record<Locale, string> = {
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  "pt-BR": "pt-BR",
  sw: "sw-KE",
  ar: "ar-SA",
  hi: "hi-IN",
  "zh-CN": "zh-CN",
  de: "de-DE"
};

/** File slug used under `apps/web/messages/<slug>.json`. */
export const localeMessageSlugs: Record<Locale, string> = {
  en: "en",
  fr: "fr",
  es: "es",
  "pt-BR": "pt",
  sw: "sw",
  ar: "ar",
  hi: "hi",
  "zh-CN": "zh",
  de: "de"
};

/** Right-to-left locales. Add to this set if any future locale is RTL. */
export const rtlLocales: ReadonlySet<Locale> = new Set(["ar"]);

export function isLocale(value: string | undefined): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Strip the region tag (e.g. `pt-BR` → `pt`). Used for the cookie. */
export function shortLocale(locale: Locale): string {
  return locale.split("-")[0];
}

export function dirFor(locale: Locale): "ltr" | "rtl" {
  return rtlLocales.has(locale) ? "rtl" : "ltr";
}

/**
 * Currency formatter tags — most locales use their home currency for
 * price displays (the Reader + Library pricing block uses USD in the
 * canonical story data, but we format the number with the user's
 * locale's grouping / decimal separator).
 */
export const currencyFor: Record<Locale, string> = {
  en: "USD",
  fr: "EUR",
  es: "EUR",
  "pt-BR": "BRL",
  sw: "KES",
  ar: "SAR",
  hi: "INR",
  "zh-CN": "CNY",
  de: "EUR"
};

/**
 * Maps a short locale to the BCP-47 tag used by the Intl APIs.
 * Falls back to the locale itself when an explicit mapping is missing.
 */
export function intlTagFor(locale: Locale): string {
  return localeIntlTags[locale] ?? locale;
}
