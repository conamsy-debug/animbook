import Link from "next/link";
import {
  LANGUAGES,
  LANGUAGES_ENABLED
} from "./config";
import { t, type Locale } from "./i18n/t";

/**
 * AnimBook Languages — landing page (Section 7.1).
 *
 * Scaffolding only. The full version (Patch 05) replaces the CTAs
 * with an onboarding picker that creates an enrollment. Patch 01
 * just proves the route + nav slot + i18n pipeline.
 *
 * Renders nothing if the feature is off (defensive — the page route
 * itself is also gated in pages/languages.tsx).
 */
interface Props {
  /** Base/instruction language for the learner's UI. Defaults to "en". */
  locale?: Locale;
}

export function Landing({ locale = "en" }: Props) {
  if (!LANGUAGES_ENABLED) return null;
  return (
    <div className="lang-landing">
      <header className="lang-landing-hero">
        <p className="lang-eyebrow">{t("landing.eyebrow", locale)}</p>
        <h1 className="lang-title">{t("landing.title", locale)}</h1>
        <p className="lang-subtitle">{t("landing.subtitle", locale)}</p>
        <div className="lang-cta">
          {/* Patch 05 — both CTAs now land on real routes. */}
          <Link href="/languages/onboarding" className="lang-btn lang-btn-primary">
            {t("landing.cta.start", locale)}
          </Link>
          <Link href="/languages/me" className="lang-btn lang-btn-ghost">
            {t("landing.cta.continue", locale)}
          </Link>
        </div>
      </header>

      <section className="lang-languages" aria-labelledby="lang-languages-heading">
        <h2 id="lang-languages-heading">{t("languagesHeading", locale)}</h2>
        <p className="lang-hint">{t("languagesHint", locale)}</p>
        <ul className="lang-list">
          {LANGUAGES.filter((l) => l.isTarget).map((lang) => (
            <li key={lang.code} className="lang-card" data-code={lang.code}>
              <span className="lang-native" lang={lang.code} dir={lang.direction}>
                {lang.nameNative}
              </span>
              <span className="lang-english">{lang.nameEn}</span>
              <span className="lang-script">{lang.script}</span>
              {lang.readingAid !== "none" && (
                <span className="lang-aid">+{lang.readingAid}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
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
        <Link href="/library" className="lang-btn lang-btn-ghost">
          ← Library
        </Link>
      </p>
    </div>
  );
}
