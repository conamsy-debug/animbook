/**
 * Static dictionary loader. Each locale has its own JSON file under
 * `apps/web/messages/<slug>.json` (the slug strips the region tag, so
 * `pt-BR` → `messages/pt.json`). When a key is missing in a
 * secondary locale we deliberately do NOT fall back here — the
 * helper in `request.ts` deep-merges the default-locale dictionary
 * on top of the requested one so any missing key resolves to English.
 */
import { type Locale, localeMessageSlugs } from "./config";

export type Dictionary = Record<string, unknown>;

async function load(slug: string): Promise<Dictionary> {
  try {
    // `as any` here is necessary because TS can't narrow the dynamic
    // import path; the runtime path is validated by the `messages`
    // directory existing on disk (the bundler will surface a missing
    // file as a build error).
    const mod: { default?: Dictionary } = await import(
      `../../messages/${slug}.json`
    );
    return (mod.default || mod) as Dictionary;
  } catch {
    return {};
  }
}

export async function loadDictionary(locale: Locale): Promise<Dictionary> {
  const slug = localeMessageSlugs[locale] ?? locale;
  return load(slug);
}
