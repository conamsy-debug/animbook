/**
 * Locale-aware date / number / currency formatters.
 *
 * Wraps the Intl.* APIs in a thin layer so callers can pass our
 * internal `Locale` (e.g. `"pt-BR"`) and get the right formatting
 * tag (e.g. `"pt-BR"`) without re-mapping by hand. The functions
 * below are stable enough to use anywhere — no React hooks, no
 * state, so they're tree-shakeable and safe in server-rendered
 * contexts.
 *
 * For React components that re-render on locale change, prefer
 * `next-intl`'s `useFormatter()` so the dictionary is in sync.
 */
import {
  currencyFor,
  intlTagFor,
  type Locale
} from "./config";

/** Format a Date / number / ISO string for the active locale. */
export function formatDate(
  locale: Locale,
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "long" }
): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(intlTagFor(locale), options).format(d);
}

/** "Joined 4 days ago" style — relative time. */
export function formatRelative(
  locale: Locale,
  value: Date | number | string,
  base: Date | number = Date.now()
): string {
  const d = value instanceof Date ? value : new Date(value);
  const b = base instanceof Date ? base : new Date(base);
  const diffMs = d.getTime() - b.getTime();
  const diffSec = Math.round(diffMs / 1000);
  // Intl.RelativeTimeFormat takes a unit + signed delta.
  return new Intl.RelativeTimeFormat(intlTagFor(locale), { numeric: "auto" }).format(
    diffSec,
    "second"
  );
}

/** Format a number with grouping separators per locale. */
export function formatNumber(
  locale: Locale,
  value: number,
  options: Intl.NumberFormatOptions = {}
): string {
  return new Intl.NumberFormat(intlTagFor(locale), options).format(value);
}

/** Format a currency value. Defaults to the locale's home currency
 *  (EUR for fr/es/de, BRL for pt-BR, USD for en, …) but the caller
 *  can override. */
export function formatCurrency(
  locale: Locale,
  value: number,
  currency: string = currencyFor[locale],
  options: Intl.NumberFormatOptions = {}
): string {
  return new Intl.NumberFormat(intlTagFor(locale), {
    style: "currency",
    currency,
    ...options
  }).format(value);
}

/** Format a percentage value. */
export function formatPercent(
  locale: Locale,
  value: number,
  options: Intl.NumberFormatOptions = { maximumFractionDigits: 0 }
): string {
  return new Intl.NumberFormat(intlTagFor(locale), {
    style: "percent",
    ...options
  }).format(value);
}
