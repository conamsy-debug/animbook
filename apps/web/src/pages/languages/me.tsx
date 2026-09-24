import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import {
  type EnrollmentRow,
  type LearnerStats,
  fetchLearnerStats,
  fetchMyEnrollments
} from "@/features/languages/api";
import { LANGUAGES_ENABLED } from "@/features/languages/config";
import { t, type Locale } from "@/features/languages/i18n/t";

/**
 * /languages/me — Patch 05 (+ Patch 10 stats card).
 *
 * Spec § 7 onboarding follow-up — the "My languages" hub. Lists
 * the learner's enrollments (most-recent activity first) and links
 * each row to its course home. Patch 10 layers the stats card
 * (XP, streak, last activity) at the top so the learner sees
 * their progress without diving into a course.
 */
export default function LanguagesMePage() {
  if (!LANGUAGES_ENABLED) return <NotAvailable />;

  return (
    <ErrorBoundary
      fallback={(err, reset) => (
        <Shell title="My languages failed to load">
          <ErrorState error={err} onRetry={reset} title="My languages failed to load" />
        </Shell>
      )}
    >
      <MyLanguagesInner />
    </ErrorBoundary>
  );
}

function MyLanguagesInner() {
  const router = useRouter();
  const localeRaw = router.query["locale"];
  const locale: Locale = (Array.isArray(localeRaw) ? localeRaw[0] : localeRaw) === "fr" ? "fr" : "en";

  const [rows, setRows] = useState<EnrollmentRow[] | null>(null);
  const [stats, setStats] = useState<LearnerStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    // Fetch the stats + enrollments in parallel — both come back from
    // small endpoints and the dashboard renders them together.
    void Promise.all([
      fetchLearnerStats()
        .then((s) => {
          if (!ac.signal.aborted) setStats(s);
        })
        .catch((err: unknown) => {
          if (!ac.signal.aborted) {
            setError((prev) =>
              prev ?? (err instanceof Error ? err.message : "Failed to load stats.")
            );
          }
        }),
      fetchMyEnrollments(ac.signal)
        .then((data) => {
          if (ac.signal.aborted) return;
          setRows(data);
        })
        .catch((err: unknown) => {
          if (ac.signal.aborted) return;
          setError((prev) =>
            prev ?? (err instanceof Error ? err.message : "Failed to load.")
          );
        })
    ]);
    return () => ac.abort();
  }, []);

  return (
    <Shell title={t("me.title", locale)}>
      <main className="container lang-me">
        <header className="lang-me-header">
          <h1 className="lang-me-title">{t("me.title", locale)}</h1>
          <Link href="/languages/onboarding" className="lang-me-cta-secondary">
            {t("me.startNew", locale)}
          </Link>
        </header>

        {error ? (
          <p className="lang-me-error" role="alert">
            {error}
          </p>
        ) : null}

        {stats ? <StatsCard stats={stats} locale={locale} /> : null}

        {rows === null ? (
          <p className="lang-me-loading">…</p>
        ) : rows.length === 0 ? (
          <div className="lang-me-empty">
            <p>{t("me.empty", locale)}</p>
            <Link href="/languages/onboarding" className="lang-me-cta-primary">
              {t("me.browseAll", locale)}
            </Link>
          </div>
        ) : (
          <ul className="lang-me-list" role="list">
            {rows.map((row) => (
              <li key={row.enrollmentId} className="lang-me-row">
                <Link
                  href={`/languages/courses/${encodeURIComponent(row.courseId)}`}
                  className="lang-me-row-link"
                  lang={row.baseLang}
                >
                  <span className="lang-me-row-title">{row.title}</span>
                  <span className="lang-me-row-meta">
                    {t("me.lastActive", locale, { when: relativeTime(row.lastActiveAt, locale) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </Shell>
  );
}

/**
 * Stats card — XP + streak + lifetime metrics. Spec § 7.3.
 * Mirrors the course-home stats block but with the full picture
 * (longest streak + timezone + totals).
 */
function StatsCard({ stats, locale }: { stats: LearnerStats; locale: Locale }) {
  const atRisk = stats.currentStreakDays > 0 && stats.currentStreakDays < stats.longestStreakDays;
  const broken = stats.currentStreakDays === 0 && stats.longestStreakDays > 0;
  return (
    <section className="lang-stats-card" aria-labelledby="lang-stats-heading">
      <h2 id="lang-stats-heading" className="lang-stats-heading">
        {t("stats.heading", locale)}
      </h2>
      <ul className="lang-stats-list" role="list">
        <li className="lang-stat lang-stat--streak">
          <span className="lang-stat-label">{t("stats.streak", locale)}</span>
          <span className="lang-stat-value">{stats.currentStreakDays}</span>
          {atRisk ? (
            <span className="lang-stat-note lang-stat-note--warn">
              {t("stats.atRisk", locale)}
            </span>
          ) : broken ? (
            <span className="lang-stat-note lang-stat-note--warn">
              {t("stats.broken", locale)}
            </span>
          ) : stats.currentStreakDays > 0 ? (
            <span className="lang-stat-note">{t("stats.alive", locale)}</span>
          ) : null}
        </li>
        <li className="lang-stat lang-stat--longest">
          <span className="lang-stat-label">{t("stats.longest", locale)}</span>
          <span className="lang-stat-value">{stats.longestStreakDays}</span>
        </li>
        <li className="lang-stat lang-stat--xp">
          <span className="lang-stat-label">{t("stats.xp", locale)}</span>
          <span className="lang-stat-value">{stats.xpTotal}</span>
        </li>
        <li className="lang-stat lang-stat--vocab">
          <span className="lang-stat-label">{t("stats.vocabCount", locale)}</span>
          <span className="lang-stat-value">{stats.vocabCount}</span>
        </li>
        <li className="lang-stat lang-stat--exercises">
          <span className="lang-stat-label">{t("stats.exerciseCount", locale)}</span>
          <span className="lang-stat-value">{stats.exerciseAttemptCount}</span>
        </li>
        <li className="lang-stat lang-stat--tz">
          <span className="lang-stat-label">{t("stats.timezone", locale)}</span>
          <span className="lang-stat-value lang-stat-value--mono">{stats.timezone}</span>
        </li>
      </ul>
      {stats.lastActivityDate ? (
        <p className="lang-stats-footer">
          {t("stats.lastActivity", locale, {
            when: stats.lastActivityDate
          })}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Relative-time formatter — "5 minutes ago", "2 days ago".
 * Kept dependency-free; the AnimBook web app doesn't ship a
 * date-formatting library and Patch 05 doesn't need full
 * Intl.RelativeTimeFormat locale strings.
 */
function relativeTime(iso: string, locale: Locale): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const sec = Math.max(1, Math.floor(diffMs / 1000));
  if (sec < 60) return locale === "fr" ? "à l'instant" : "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return locale === "fr" ? `il y a ${min} min` : `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return locale === "fr" ? `il y a ${hr} h` : `${hr} h ago`;
  const day = Math.floor(hr / 24);
  return locale === "fr" ? `il y a ${day} j` : `${day} d ago`;
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
      <main className="container lang-me">
        <p>AnimBook Languages isn't available yet.</p>
      </main>
    </div>
  );
}