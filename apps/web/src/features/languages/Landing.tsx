import Link from "next/link";
import { LANGUAGES, type LanguageConfig } from "./config";
import { t, type Locale } from "./i18n/t";

/**
 * AnimBook Languages — landing page (Section 7.1).
 *
 * Renders nothing if the feature is off (defensive — the page route
 * itself is also gated in pages/languages.tsx).
 *
 * Layout:
 *   - Hero with eyebrow + serif title + lede + CTA row
 *   - Seven languages as a proper grid of clickable cards. Each card
 *     has the native name large (serif, scaled for legibility on
 *     non-Latin scripts), the English name + script as smaller
 *     secondary text. Hebrew flows right-to-left.
 *   - Cards link to /languages/onboarding?target=<code> so the
 *     onboarding picker pre-selects that language.
 *
 * Visual tokens reuse the site's dark surface + gold accent and the
 * lib-page serif/sans pairing so the page looks like Library.
 */
interface Props {
  /** Base/instruction language for the learner's UI. Defaults to "en". */
  locale?: Locale;
}

export function Landing({ locale = "en" }: Props) {
  return (
    <div className="lang-landing">
      <header className="lang-landing-hero">
        <p className="lang-eyebrow">{t("landing.eyebrow", locale)}</p>
        <h1 className="lang-title">{t("landing.title", locale)}</h1>
        <p className="lang-subtitle">{t("landing.subtitle", locale)}</p>
        <div className="lang-cta">
          <Link href="/languages/onboarding" className="btn primary">
            {t("landing.cta.start", locale)}
          </Link>
          <Link href="/languages/me" className="btn ghost">
            {t("landing.cta.continue", locale)}
          </Link>
        </div>
      </header>

      <section className="lang-languages" aria-labelledby="lang-languages-heading">
        <h2 id="lang-languages-heading" className="lang-section-heading">
          {t("languagesHeading", locale)}
        </h2>
        <div className="lang-grid">
          {LANGUAGES.filter((l) => l.isTarget).map((lang) => {
            const isRtl = lang.direction === "rtl";
            const badges = scriptBadgeFor(lang);
            return (
              <Link
                key={lang.code}
                href={`/languages/onboarding?target=${encodeURIComponent(lang.code)}`}
                className="lang-card"
                aria-label={`${lang.nameNative} (${lang.nameEn})`}
              >
                <span
                  className="lang-card-native"
                  lang={lang.code}
                  dir={isRtl ? "rtl" : "ltr"}
                >
                  {lang.nameNative}
                </span>
                <span className="lang-card-en">{lang.nameEn}</span>
                <span className="lang-card-meta">
                  {badges.map((b, i) => (
                    <span key={i} className={`lang-pill ${b.kind}`}>
                      {b.label}
                    </span>
                  ))}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/**
 * Per-language badge(s) for the landing card.
 *
 *  - Latin scripts (en, fr, es, de, it) → no badge at all. The script
 *    name in tiny mono caps just adds noise for English / French /
 *    Spanish / German / Italian readers.
 *  - zh-Hans → "Chinese characters · pinyin" (the script + reading aid).
 *  - he → "Hebrew alphabet · right to left" (combines script +
 *    direction into one line so the card doesn't show two redundant
 *    Hebrew pills).
 *  - any future RTL / non-Latin language → fallback to its script + an
 *    "RTL" pill, same shape as before.
 */
function scriptBadgeFor(
  lang: LanguageConfig
): { label: string; kind: "script" | "rtl" | "meta" }[] {
  if (lang.script === "Latin") return [];
  if (lang.code === "zh-Hans") {
    return [{ label: "Chinese characters · pinyin", kind: "meta" }];
  }
  if (lang.code === "he") {
    return [{ label: "Hebrew alphabet · right to left", kind: "meta" }];
  }
  // Future-proof fallback
  const out: { label: string; kind: "script" | "rtl" | "meta" }[] = [
    { label: lang.script, kind: "script" }
  ];
  if (lang.direction === "rtl") out.push({ label: "RTL", kind: "rtl" });
  return out;
}

/**
 * Friendly fallback shown when the LANGUAGES_ENABLED flag is off.
 * The route still resolves (200) so bookmarked URLs don't 404, but
 * the page tells the learner where to go instead.
 */
export function NotAvailable({ locale = "en" }: Props) {
  return (
    <div className="lang-landing lang-notavailable">
      <h1 className="lang-title">{t("notAvailable.title", locale)}</h1>
      <p className="lang-subtitle">{t("notAvailable.body", locale)}</p>
      <p>
        <Link href="/library" className="btn ghost">
          ← Library
        </Link>
      </p>
    </div>
  );
}
