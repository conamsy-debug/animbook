import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import {
  type CourseHomePayload,
  type CourseStoryRow,
  enrollInCourse,
  fetchCourseHome
} from "@/features/languages/api";
import { LANGUAGES_ENABLED } from "@/features/languages/config";
import { t, type Locale } from "@/features/languages/i18n/t";

/**
 * /languages/courses/[courseId] — Patch 05 course home.
 *
 * Spec § 7.3 — the per-course home screen. Shows the course
 * metadata, the learner's stats (streak / XP / last activity), and
 * the list of stories with per-story progress + a start/continue
 * button. A learner can preview the course home before enrolling;
 * the page surfaces a "Start this course" CTA in that case.
 */
export default function LanguagesCourseHomePage() {
  if (!LANGUAGES_ENABLED) return <NotAvailable />;

  return (
    <ErrorBoundary
      fallback={(err, reset) => (
        <Shell title="Course failed to load">
          <ErrorState error={err} onRetry={reset} title="Course failed to load" />
        </Shell>
      )}
    >
      <CourseHomeInner />
    </ErrorBoundary>
  );
}

function CourseHomeInner() {
  const router = useRouter();
  const courseIdRaw = router.query["courseId"];
  const courseId = Array.isArray(courseIdRaw) ? courseIdRaw[0] : courseIdRaw;
  const localeRaw = router.query["locale"];
  const locale: Locale = (Array.isArray(localeRaw) ? localeRaw[0] : localeRaw) === "fr" ? "fr" : "en";

  const [data, setData] = useState<CourseHomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    if (!courseId) return;
    const ac = new AbortController();
    setLoading(true);
    fetchCourseHome(courseId, ac.signal)
      .then((payload) => {
        if (ac.signal.aborted) return;
        setData(payload);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load.");
        setLoading(false);
      });
    return () => ac.abort();
  }, [courseId]);

  if (!courseId) return <BadUrlFallback locale={locale} />;
  if (loading) {
    return (
      <Shell title="Loading course…">
        <main className="container lang-course">
          <p>…</p>
        </main>
      </Shell>
    );
  }
  if (error || !data) {
    return (
      <Shell title="Course not found">
        <main className="container lang-course">
          <p className="lang-course-error" role="alert">{error ?? "Course not found."}</p>
        </main>
      </Shell>
    );
  }

  const enrolled = data.enrollment !== null;
  const streak = data.stats?.currentStreakDays ?? 0;
  const xp = data.stats?.xpTotal ?? 0;
  // Patch 09 — the review CTA links to `/courses/:id/review?base=…`.
  // Reuse the course's base_lang so the URL is shareable.
  const base = data.course.baseLang;

  const onEnroll = async () => {
    setEnrolling(true);
    setError(null);
    try {
      const result = await enrollInCourse({
        targetLang: data.course.targetLang,
        baseLang: data.course.baseLang
      });
      // Refresh the page data so the enrollment state updates.
      void router.replace(`/languages/courses/${encodeURIComponent(result.courseId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enroll.");
      setEnrolling(false);
    }
  };

  return (
    <Shell title={t("course.title", locale, { title: data.course.title })}>
      <main className="container lang-course" lang={data.course.baseLang}>
        <header className="lang-course-header">
          <p className="lang-course-eyebrow">
            {data.course.baseLang.toUpperCase()} → {data.course.targetLang.toUpperCase()}
          </p>
          <h1 className="lang-course-title">{data.course.title}</h1>
          {data.course.description ? (
            <p className="lang-course-description">{data.course.description}</p>
          ) : null}
        </header>

        {enrolled ? (
          <section className="lang-course-stats" aria-labelledby="lang-course-stats-heading">
            <h2 id="lang-course-stats-heading" className="lang-course-section-heading">
              {t("course.statsHeading", locale)}
            </h2>
            <ul className="lang-course-stats-list" role="list">
              <li className="lang-course-stat lang-course-stat--streak">
                <span className="lang-course-stat-value">
                  {t("course.streak", locale, undefined, streak)}
                </span>
              </li>
              <li className="lang-course-stat lang-course-stat--xp">
                <span className="lang-course-stat-value">
                  {t("course.xp", locale, undefined, xp)}
                </span>
              </li>
              {data.stats?.lastActivityDate ? (
                <li className="lang-course-stat lang-course-stat--last">
                  <span className="lang-course-stat-value">
                    {t("course.lastActivity", locale, { when: data.stats.lastActivityDate })}
                  </span>
                </li>
              ) : null}
            </ul>
          </section>
        ) : (
          <section className="lang-course-not-enrolled">
            <p>{t("course.notEnrolled", locale)}</p>
            <button
              type="button"
              className="lang-course-enroll"
              onClick={onEnroll}
              disabled={enrolling}
            >
              {enrolling ? "…" : t("course.enroll", locale)}
            </button>
          </section>
        )}

        <section className="lang-course-stories" aria-labelledby="lang-course-stories-heading">
          <h2 id="lang-course-stories-heading" className="lang-course-section-heading">
            {t("course.storiesHeading", locale)}
          </h2>
          <ul className="lang-course-stories-list" role="list">
            {data.stories.map((story) => (
              <CourseStoryItem key={story.storyId} story={story} locale={locale} />
            ))}
          </ul>
        </section>

        {/* Patch 06 — the "My words" link. Lives below the stories so
            the home flow (read story → tap word → save) is the
            primary action, but always reachable in one tap. */}
        <section className="lang-course-extra-links" aria-label="Course shortcuts">
          {/* Patch 09 — review CTA. The due count from /courses/:id
              drives the badge. When dueCount > 0 the link is the
              page's primary action; otherwise it fades back into a
              secondary shortcut row. */}
          {data.dueCount && data.dueCount > 0 ? (
            <Link
              href={`/languages/courses/${encodeURIComponent(courseId)}/review?base=${base}`}
              className="lang-course-review-cta"
            >
              {t("review.title", locale)} · <strong>{data.dueCount}</strong> due →
            </Link>
          ) : null}
          <Link
            href={`/languages/courses/${encodeURIComponent(courseId)}/words`}
            className="lang-course-extra-link"
          >
            {t("words.shortcut", locale)} →
          </Link>
        </section>

        {error ? (
          <p className="lang-course-error" role="alert">
            {error}
          </p>
        ) : null}
      </main>
    </Shell>
  );
}

function CourseStoryItem({ story, locale }: { story: CourseStoryRow; locale: Locale }) {
  const status = story.progress?.status ?? "not_started";
  const label =
    status === "completed"
      ? t("course.reviewStory", locale)
      : status === "in_progress"
      ? t("course.continueStory", locale)
      : t("course.startStory", locale);
  const statusLabel =
    status === "completed"
      ? t("course.status.completed", locale)
      : status === "in_progress"
      ? t("course.status.inProgress", locale)
      : t("course.status.notStarted", locale);
  const parts = story.storyId.split(":");
  const slug = parts[1] ?? "";
  const target = parts[2] ?? "";
  return (
    <li className="lang-course-story">
      <Link
        href={`/languages/story/${encodeURIComponent(slug)}/${encodeURIComponent(target)}`}
        className="lang-course-story-link"
        lang={target}
      >
        <span className="lang-course-story-title">{story.title}</span>
        <span className="lang-course-story-meta">
          <span className={`lang-course-story-status lang-course-story-status--${status}`}>
            {statusLabel}
          </span>
          <span className="lang-course-story-cefr">{story.cefrLevel}</span>
        </span>
        <span className="lang-course-story-cta">{label} →</span>
      </Link>
    </li>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="app-shell lib-page lang-page">
      <Head>
        <title>{title}</title>
      </Head>
      <Topbar variant="cinematic" />
      {children}
    </div>
  );
}

function BadUrlFallback({ locale }: { locale: Locale }) {
  return (
    <Shell title={locale === "fr" ? "Cours introuvable" : "Course not found"}>
      <main className="container lang-course">
        <p role="alert">Bad course URL.</p>
        <Link href="/languages/me" className="lang-course-back">
          ← {t("me.title", locale)}
        </Link>
      </main>
    </Shell>
  );
}

function NotAvailable() {
  return (
    <div className="app-shell lib-page lang-page">
      <Head>
        <title>AnimBook Languages — coming soon</title>
      </Head>
      <Topbar variant="cinematic" />
      <main className="container lang-course">
        <p>AnimBook Languages isn't available yet.</p>
      </main>
    </div>
  );
}