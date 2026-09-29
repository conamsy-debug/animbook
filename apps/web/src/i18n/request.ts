/**
 * SSR helper for next-intl. The Pages Router analogue of the
 * App-Router `getRequestConfig` callback.
 *
 * Called by next-intl's `createNextIntlPlugin` wrapper (configured in
 * `next.config.mjs`). Each request gets the locale routed by Next.js's
 * built-in i18n config (e.g. `/fr/library` → locale=`fr`), and we
 * return the dictionary for that locale. The deep-merge over the
 * default-locale dictionary means missing keys in secondary locales
 * fall back to English — translators only need to ship the keys
 * they've actually translated.
 */
import { defaultLocale, isLocale } from "./config";
import { loadDictionary, type Dictionary } from "./dictionaries";

export default async function getRequestConfig({ locale }: { locale: string }) {
  // Pages Router's built-in i18n always passes a known locale; the
  // fallback handles the `default` placeholder that next-intl emits
  // for the canonical-root case (English-without-prefix).
  const safe = isLocale(locale) ? locale : defaultLocale;

  const requested = await loadDictionary(safe);
  const messages =
    safe === defaultLocale ? requested : mergeDeep(await loadDictionary(defaultLocale), requested);

  return {
    locale: safe,
    messages,
    // Time zone defaults to UTC; pages can override per-formatter.
    timeZone: "UTC",
    now: new Date()
  };
}

/** Deep merge `b` onto `a`, with `b` winning on leaf conflicts. */
function mergeDeep(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Record<string, unknown> {
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
      out[k] = mergeDeep(av as Record<string, unknown>, v as Record<string, unknown>);
    } else if (v !== undefined && v !== null) {
      out[k] = v;
    }
  }
  return out;
}

export type { Dictionary };
