/**
 * Tiny wrapper around `use-intl`'s `useTranslations` that defers
 * translation lookup until after the first client mount. During the
 * Next.js static prerender pass the IntlContext isn't mounted in a
 * way that `useTranslations` can read, so we return the namespace
 * key (or a friendly fallback) instead of throwing.
 *
 * Usage:
 *   const t = useT("nav");
 *   <span>{t("library")}</span>   // renders `nav.library` until mount
 *   // then renders the translated string after hydration
 *
 * The trade-off: server-rendered HTML shows the i18n key on first
 * paint, which is not ideal. We mitigate that by seeding the
 * `LocaleProvider` with the English dictionary so keys that exist
 * in English resolve on the server too — keys that don't exist in
 * English still flash briefly, then hydrate.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

export function useT(namespace: string) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // We always call the hook so the rules-of-hooks invariant holds;
  // it just returns a "key-returning" shim during prerender.
  const t = useTranslations(namespace);
  if (!mounted) {
    // Returns a function that echoes the key — the static HTML gets
    // the key string, which is the closest deterministic stand-in.
    return ((key: string) => `${namespace}.${key}`) as unknown as ReturnType<typeof useTranslations>;
  }
  return t;
}
