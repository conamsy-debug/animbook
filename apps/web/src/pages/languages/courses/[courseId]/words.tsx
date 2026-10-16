import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import {
  type BaseLang,
  type VocabRow,
  fetchCourseHome,
  fetchMyWords,
  unsaveVocab
} from "@/features/languages/api";
import { LANGUAGES_ENABLED } from "@/features/languages/config";
import { t, type Locale } from "@/features/languages/i18n/t";
import { WordPopup } from "@/features/languages/WordPopup";

/**
 * /languages/courses/[courseId]/words — Patch 06 "My words" screen.
 *
 * Spec § 7.9 — a searchable, per-course deck of the learner's saved
 * words. Each row carries the lemma, glosses, the source line context
 * (so the page can render the example sentence in context without a
 * second round-trip), and a delete button.
 *
 * Tapping a row opens the WordPopup with the row's prefetched data
 * (Patch 06 — the popup skips its own fetch when given a `prefetched`
 * row, so this screen renders without an N+1 of round-trips).
 */
export default function LanguagesCourseWordsPage() {
  if (!LANGUAGES_ENABLED) return <NotAvailable />;

  return (
    <ErrorBoundary
      fallback={(err, reset) => (
        <Shell title="My words failed to load">
          <ErrorState error={err} onRetry={reset} title="My words failed to load" />
        </Shell>
      )}
    >
      <CourseWordsInner />
    </ErrorBoundary>
  );
}

function CourseWordsInner() {
  const router = useRouter();
  const courseIdRaw = router.query["courseId"];
  const courseId = Array.isArray(courseIdRaw) ? courseIdRaw[0] : courseIdRaw;
  const localeRaw = router.query["locale"];
  const locale: Locale = (Array.isArray(localeRaw) ? localeRaw[0] : localeRaw) === "fr" ? "fr" : "en";

  const [rows, setRows] = useState<VocabRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [courseBaseLang, setCourseBaseLang] = useState<BaseLang | null>(null);
  const [courseTargetLang, setCourseTargetLang] = useState<string | null>(null);
  const [courseTitle, setCourseTitle] = useState<string | null>(null);
  const [previewRow, setPreviewRow] = useState<VocabRow | null>(null);

  // Hydrate the course + deck in parallel. The course home endpoint
  // gives us the title + base/target lang; the vocab endpoint gives
  // us the deck. We refresh both on URL change.
  useEffect(() => {
    if (!courseId) return;
    const ac = new AbortController();
    setLoading(true);
    Promise.all([fetchCourseHome(courseId, ac.signal), fetchMyWords({ courseId, base: locale, signal: ac.signal })])
      .then(([course, cards]) => {
        if (ac.signal.aborted) return;
        if (course) {
          setCourseBaseLang(course.course.baseLang);
          setCourseTargetLang(course.course.targetLang);
          setCourseTitle(course.course.title);
        }
        setRows(cards);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load.");
        setLoading(false);
      });
    return () => ac.abort();
  }, [courseId, locale]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return rows;
    return rows.filter((row) => {
      if (row.lemma.toLowerCase().includes(needle)) return true;
      if (row.glosses.some((g) => g.toLowerCase().includes(needle))) return true;
      return false;
    });
  }, [rows, query]);

  const removeRow = async (row: VocabRow) => {
    try {
      await unsaveVocab(row.userVocabId);
      setRows((prev) => (prev ? prev.filter((r) => r.userVocabId !== row.userVocabId) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove.");
    }
  };

  if (!courseId) return <BadUrlFallback locale={locale} />;

  if (loading) {
    return (
      <Shell title="Loading words…">
        <main className="container lang-words">
          <p>…</p>
        </main>
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell title="My words">
        <main className="container lang-words">
          <p className="lang-words-error" role="alert">{error}</p>
        </main>
      </Shell>
    );
  }

  return (
    <Shell title={courseTitle ? `${courseTitle} · My words` : "My words"}>
      <main className="container lang-words" lang={courseBaseLang ?? undefined}>
        <header className="lang-words-header">
          <Link
            href={courseId ? `/languages/courses/${encodeURIComponent(courseId)}` : "/languages/me"}
            className="lang-words-back"
          >
            ← {courseTitle ?? t("course.title", locale, { title: "course" })}
          </Link>
          <h1 className="lang-words-title">{t("words.title", locale)}</h1>
          <p className="lang-words-count">
            {t("words.count", locale, undefined, filtered.length)}
          </p>
          <label className="lang-words-search">
            <span className="lang-words-search-label">{t("words.search", locale)}</span>
            <input
              type="search"
              className="lang-words-search-input"
              placeholder={t("words.searchPlaceholder", locale)}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </header>

        {filtered.length === 0 ? (
          <p className="lang-words-empty">{t("words.empty", locale)}</p>
        ) : (
          <ul className="lang-words-list" role="list">
            {filtered.map((row) => (
              <WordRow
                key={row.userVocabId}
                row={row}
                locale={locale}
                targetLang={courseTargetLang ?? row.targetLang}
                onOpen={() => setPreviewRow(row)}
                onRemove={() => removeRow(row)}
              />
            ))}
          </ul>
        )}
      </main>

      {previewRow ? (
        <WordPopup
          lexemeId={previewRow.lexemeId}
          sourceLineId={previewRow.sourceLine?.lineId ?? null}
          locale={locale}
          prefetched={previewRow}
          onClose={() => setPreviewRow(null)}
        />
      ) : null}
    </Shell>
  );
}

function WordRow({
  row,
  locale,
  targetLang,
  onOpen,
  onRemove
}: {
  row: VocabRow;
  locale: Locale;
  targetLang: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const direction = targetLang === "he" ? "rtl" : "ltr";
  return (
    <li className="lang-words-row">
      <button
        type="button"
        className="lang-words-row-button"
        onClick={onOpen}
        aria-label={`${row.lemma} — open popup`}
      >
        <span className="lang-words-row-head">
          <span className="lang-words-row-lemma" lang={targetLang} dir={direction}>
            {row.lemma}
          </span>
          {row.reading && row.reading !== row.lemma ? (
            <span className="lang-words-row-reading">{row.reading}</span>
          ) : null}
          <span className="lang-words-row-pos">
            {row.gender ? `${row.partOfSpeech} · ${row.gender}` : row.partOfSpeech}
          </span>
        </span>
        {row.glosses.length > 0 ? (
          <span className="lang-words-row-glosses">
            {row.glosses.slice(0, 3).map((g, i) => (
              <span key={i} className="lang-words-row-gloss">{g}</span>
            ))}
            {row.glosses.length > 3 ? (
              <span className="lang-words-row-gloss lang-words-row-gloss--more">+{row.glosses.length - 3}</span>
            ) : null}
          </span>
        ) : null}
        {row.sourceLine ? (
          <span className="lang-words-row-source" lang={targetLang} dir={direction}>
            <span className="lang-words-row-source-text">{row.sourceLine.text}</span>
            <span className="lang-words-row-source-translation">— {row.sourceLine.translation}</span>
          </span>
        ) : null}
      </button>
      <button
        type="button"
        className="lang-words-row-remove"
        onClick={onRemove}
        aria-label={t("words.remove", locale)}
        title={t("words.remove", locale)}
      >
        ×
      </button>
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
    <Shell title={locale === "fr" ? "Mots introuvables" : "Words not found"}>
      <main className="container lang-words">
        <p role="alert">Bad URL.</p>
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
      <main className="container lang-words">
        <p>AnimBook Languages isn't available yet.</p>
      </main>
    </div>
  );
}