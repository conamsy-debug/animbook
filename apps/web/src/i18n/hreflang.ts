/**
 * hreflang alternates helper.
 *
 * Generates the 9 `<link rel="alternate" hreflang="…">` tags every
 * page should emit so search engines understand the locale matrix.
 * Also emits `x-default` for the canonical English version.
 *
 * `pathForLocale` rebuilds a URL for each locale by swapping the
 * locale prefix (or adding one if the source is the English root).
 * `siteOrigin` is the absolute base URL — pass the deployment host.
 */
import { defaultLocale, locales, type Locale, isLocale } from "./config";

export type AlternateLink = { hrefLang: string; href: string };

/**
 * Strip a locale prefix from a pathname. `/fr/library` → `/library`,
 * `/library` → `/library`. Always returns a path starting with `/`.
 */
export function stripLocale(pathname: string): string {
  const parts = pathname.split("/");
  if (isLocale(parts[1])) {
    const rest = parts.slice(2).join("/");
    return rest ? `/${rest}` : "/";
  }
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

/** Add the locale prefix back to a stripped path. */
export function buildLocalizedPath(locale: Locale, basePath: string): string {
  const stripped = stripLocale(basePath);
  if (locale === defaultLocale) return stripped === "/" ? "/" : stripped;
  return stripped === "/" ? `/${locale}` : `/${locale}${stripped}`;
}

/**
 * Compute the 9 alternate URLs + x-default for a given path.
 * Returns relative paths so the call site can compose them with
 * `<link href={…}>` (browsers resolve `href="/fr/library"` against
 * the current origin). If you need absolute URLs (some SEO audits do),
 * prepend the site origin in the consuming component.
 */
export function hreflangAlternates(currentPath: string): AlternateLink[] {
  const stripped = stripLocale(currentPath);
  const links: AlternateLink[] = locales.map((locale) => ({
    hrefLang: locale,
    href: buildLocalizedPath(locale, stripped)
  }));
  links.push({ hrefLang: "x-default", href: stripped });
  return links;
}
