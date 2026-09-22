/**
 * Tiny i18n helper for the AnimBook Languages module.
 *
 * No external library — Next.js doesn't ship one and the existing
 * AnimBook codebase is pre-i18n. The base/instruction language
 * (en or fr — see spec § 3) decides which dictionary a learner
 * reads from. Every call takes an explicit `locale` so we can swap
 * it at runtime later (onboarding / settings) without a Context.
 *
 * Lookup is flat with dot.notation keys; missing keys fall back to
 * the English string, then the raw key. That way a partial French
 * dictionary doesn't render `landing.title` literally — it renders
 * the English version with a console.warn in dev.
 *
 * Interpolation: `{name}` and `{count}` placeholders inside any
 *   resolved string are replaced from the optional `vars` record.
 *   Unknown placeholders stay literal so a missing var doesn't
 *   silently corrupt the UI.
 *
 * Plurals: a dictionary value may be `string` (the common case) or
 *   `{ one: string; other: string }` (a plural form). When the caller
 *   passes `count`, `t` picks `one` if `count === 1`, else `other`,
 *   then runs interpolation. This is deliberately simple — AnimBook
 *   Phase 1 only needs English + French plurals, both of which split
 *   on `count === 1`. If we later add languages with more plural
 *   forms (Russian, Arabic), we swap `pickPlural` for ICU MessageFormat
 *   without touching call sites.
 */
import { en, type EnKey } from "./en";
import { fr, type FrKey } from "./fr";

export type Locale = "en" | "fr";

/**
 * Union of every translation key across all locales. `as const` on
 * each dictionary gives us a stable literal type per file; the
 * intersection + flatten keeps the union shape narrow enough that
 * t() can flag typos at the call site.
 */
export type TKey = EnKey | FrKey;

/** A dictionary value: plain string, or a singular/plural pair. */
export type DictValue = string | { readonly one: string; readonly other: string };

/** Type for a flat dot-notation dictionary. */
export type Dict = { readonly [key: string]: DictValue };

const dictionaries: Record<Locale, Dict> = { en: en as Dict, fr: fr as Dict };

/**
 * Interpolate `{name}` / `{count}` placeholders from `vars`. Missing
 * variables stay literal so callers can spot a typo at runtime.
 */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return String(vars[key]);
    }
    return match;
  });
}

/**
 * Pick a plural form for `count`. English + French both split on
 * `count === 1`, so a single binary rule covers Phase 1. If a value
 * is a plain string, it has no plural — return it as-is.
 */
export function pickPlural(value: DictValue, count?: number): string {
  if (typeof value === "string") return value;
  if (count === undefined) return value.other;
  return count === 1 ? value.one : value.other;
}

/** Debug helper: which keys are present in each dictionary. */
export function keyParity(): { onlyEn: string[]; onlyFr: string[] } {
  const enKeys = new Set(Object.keys(en));
  const onlyEn: string[] = [];
  const onlyFr: string[] = [];
  for (const k of Object.keys(fr)) if (!enKeys.has(k)) onlyFr.push(k);
  for (const k of Object.keys(en)) if (!dictionaries.fr[k as keyof typeof fr] && !onlyFr.includes(k)) {
    // Defensive: also report keys in en but missing in fr.
    onlyEn.push(k);
  }
  return { onlyEn, onlyFr };
}

/**
 * Resolve a translation key.
 *
 * Lookup order: locale → English fallback → raw key.
 * After resolution, applies plural selection (when `count` is given
 * and the value is a `{one,other}` pair) and `{var}` interpolation.
 *
 * @param key   dot.notation key
 * @param locale  UI language
 * @param vars  optional interpolation map, e.g. `{ name: "Aisha" }`.
 *              `count` is auto-injected when `count` arg is provided,
 *              so callers don't have to repeat it.
 * @param count optional plural pivot; if provided and the value is a
 *              plural pair, picks `one` when `count === 1` else `other`.
 *              Also auto-binds `{count}` in the interpolation map.
 */
export function t(
  key: TKey,
  locale: Locale,
  vars?: Record<string, string | number>,
  count?: number
): string {
  const dict = dictionaries[locale];
  const fallbackDict = dictionaries.en;
  const localized = dict[key as string];
  const resolved = localized ?? fallbackDict[key as string];
  if (!resolved) return key as string;
  if (!localized && process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(`[languages i18n] missing key "${key}" in ${locale}, falling back to English`);
  }
  const picked = pickPlural(resolved, count);
  const mergedVars =
    count === undefined ? vars : { ...(vars ?? {}), count };
  return interpolate(picked, mergedVars);
}
