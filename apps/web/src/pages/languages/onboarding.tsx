import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import {
  type BaseLang,
  type LangCode,
  type LanguageRow,
  enrollInCourse,
  fetchLanguages,
  fetchMyEnrollments
} from "@/features/languages/api";
import { LANGUAGES_ENABLED } from "@/features/languages/config";
import { t, type Locale } from "@/features/languages/i18n/t";

/**
 * /languages/onboarding — Patch 05.
 *
 * Spec § 7.2 — the first-launch screen that asks the learner to
 * pick a base language (the language the UI speaks) and a target
 * language (the language they want to learn). Optionally a daily
 * goal (5 / 10 / 20 minutes). The page POSTs to /api/lang/enrollments
 * on submit, then redirects to the resulting course home.
 *
 * Locale is read from a `?locale=en|fr` query param (defaults to
 * `en`); future Patch 12 / settings page will surface a toggle.
 */
export default function LanguagesOnboardingPage() {
  if (!LANGUAGES_ENABLED) return <NotAvailable />;

  return (
    <ErrorBoundary
      fallback={(err, reset) => (
        <Shell title="Onboarding failed to load">
          <ErrorState error={err} onRetry={reset} title="Onboarding failed to load" />
        </Shell>
      )}
    >
      <OnboardingInner />
    </ErrorBoundary>
  );
}

function OnboardingInner() {
  const router = useRouter();
  const localeRaw = router.query["locale"];
  const locale: Locale = (Array.isArray(localeRaw) ? localeRaw[0] : localeRaw) === "fr" ? "fr" : "en";

  const [catalog, setCatalog] = useState<LanguageRow[] | null>(null);
  const [existingEnrollments, setExistingEnrollments] = useState<string[] | null>(null);
  const [base, setBase] = useState<BaseLang>("en");
  const [target, setTarget] = useState<LangCode | "">("");
  const [dailyGoal, setDailyGoal] = useState<0 | 5 | 10 | 20>(10);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([fetchLanguages(ac.signal), fetchMyEnrollments(ac.signal)])
      .then(([langs, enrolls]) => {
        if (ac.signal.aborted) return;
        setCatalog(langs ?? []);
        // Tag enrolled target langs so the picker can label "you're
        // already learning this" without an extra round-trip.
        const taken = (enrolls ?? []).map((e) => e.targetLang);
        setExistingEnrollments(taken);
        // Default the base to the user's choice if they already
        // enrolled — most learners keep a single base.
        if (enrolls && enrolls.length > 0) {
          const firstBase = enrolls[0]!.baseLang;
          setBase(firstBase);
        }
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load.");
      });
    return () => ac.abort();
  }, []);

  const baseLanguages = useMemo(
    () => (catalog ?? []).filter((l) => l.isBase),
    [catalog]
  );
  const targetLanguages = useMemo(
    () => (catalog ?? []).filter((l) => l.isTarget && l.code !== base),
    [catalog, base]
  );

  const onSubmit = async () => {
    if (!target) {
      setError(t("onboarding.error.generic", locale));
      return;
    }
    if (target === base) {
      setError(t("onboarding.error.sameLang", locale));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await enrollInCourse({
        targetLang: target as LangCode,
        baseLang: base,
        dailyGoal: dailyGoal || undefined
      });
      void router.push(`/languages/courses/${encodeURIComponent(result.courseId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("onboarding.error.generic", locale));
      setSubmitting(false);
    }
  };

  return (
    <Shell title={t("onboarding.title", locale)}>
      <main className="container lang-onboarding">
        <header className="lang-onboarding-header">
          <p className="lang-onboarding-eyebrow">{t("landing.eyebrow", locale)}</p>
          <h1 className="lang-onboarding-title">{t("onboarding.title", locale)}</h1>
          <p className="lang-onboarding-subtitle">{t("onboarding.subtitle", locale)}</p>
        </header>

        <section className="lang-onboarding-field">
          <label className="lang-onboarding-label" htmlFor="lang-onboarding-base">
            {t("onboarding.baseLabel", locale)}
          </label>
          <select
            id="lang-onboarding-base"
            className="lang-onboarding-select"
            value={base}
            onChange={(e) => {
              const next = e.target.value === "fr" ? "fr" : "en";
              setBase(next);
              // If the new base collides with the chosen target, clear it.
              if (target === next) setTarget("");
            }}
          >
            {baseLanguages.map((lang) => (
              <option key={lang.code} value={lang.code} lang={lang.code}>
                {locale === "fr" ? lang.nameFr : lang.nameEn} · {lang.nameNative}
              </option>
            ))}
          </select>
        </section>

        <section className="lang-onboarding-field">
          <label className="lang-onboarding-label" htmlFor="lang-onboarding-target">
            {t("onboarding.targetLabel", locale)}
          </label>
          <select
            id="lang-onboarding-target"
            className="lang-onboarding-select"
            value={target}
            onChange={(e) => setTarget(e.target.value as LangCode)}
            disabled={targetLanguages.length === 0}
          >
            <option value="" lang={base}>
              —
            </option>
            {targetLanguages.map((lang) => {
              const already = (existingEnrollments ?? []).includes(lang.code);
              const label = `${locale === "fr" ? lang.nameFr : lang.nameEn} · ${lang.nameNative}${already ? " · ✓" : ""}`;
              return (
                <option key={lang.code} value={lang.code} lang={lang.code}>
                  {label}
                </option>
              );
            })}
          </select>
        </section>

        <section className="lang-onboarding-field lang-onboarding-daily">
          <span className="lang-onboarding-label">{t("onboarding.dailyGoalLabel", locale)}</span>
          <p className="lang-onboarding-hint">{t("onboarding.dailyGoalHint", locale)}</p>
          <div className="lang-onboarding-daily-options" role="radiogroup" aria-label={t("onboarding.dailyGoalLabel", locale)}>
            {([0, 5, 10, 20] as const).map((mins) => (
              <button
                key={mins}
                type="button"
                role="radio"
                aria-checked={dailyGoal === mins}
                className={
                  "lang-onboarding-daily-pill" +
                  (dailyGoal === mins ? " lang-onboarding-daily-pill--active" : "")
                }
                onClick={() => setDailyGoal(mins)}
              >
                {mins === 0
                  ? t("onboarding.dailyGoal.none", locale)
                  : mins === 5
                  ? t("onboarding.dailyGoal.relaxed", locale)
                  : mins === 10
                  ? t("onboarding.dailyGoal.regular", locale)
                  : t("onboarding.dailyGoal.serious", locale)}
              </button>
            ))}
          </div>
        </section>

        {error ? (
          <p className="lang-onboarding-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          className="lang-onboarding-submit"
          onClick={onSubmit}
          disabled={submitting || !target}
        >
          {submitting ? "…" : t("onboarding.submit", locale)}
        </button>
      </main>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <Head>
        <title>{title}</title>
      </Head>
      <Topbar variant="cinematic" />
      {children}
    </div>
  );
}

function NotAvailable() {
  return (
    <div className="app-shell">
      <Head>
        <title>AnimBook Languages — coming soon</title>
      </Head>
      <Topbar variant="cinematic" />
      <main className="container lang-onboarding">
        <p>AnimBook Languages isn't available yet.</p>
      </main>
    </div>
  );
}