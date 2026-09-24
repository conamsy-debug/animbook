/**
 * Review session screen — Patch 09.
 *
 * Spec § 7.5 (screen 5) + § 10. Fetches the learner's due cards for
 * one course, walks through them one at a time, then POSTs each
 * rating. The backend returns the next card state + scheduled
 * interval so the UI can surface a "see you in 4 days" hint below
 * the rating buttons.
 *
 * The card itself is a simple two-sided flip: front = lemma + reading
 * aid (for zh/Hebrew); back = glosses + the source line the learner
 * saw when they saved the word. The flip happens on tap or spacebar.
 *
 * Mobile-first 375px — the rating buttons fill the viewport width at
 * the bottom so the learner can tap with their thumb without moving.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import {
  fetchReviewDue,
  submitReviewRating,
  type DueCard,
  type ReviewPostResult,
  type ReviewRating
} from "../../../../features/languages/api";
import type { Locale } from "../../../../features/languages/i18n/t";
import { t } from "../../../../features/languages/i18n/t";

const BASE_LANGS = ["en", "fr"] as const;
type BaseLang = (typeof BASE_LANGS)[number];

/** Source line shape from /api/lang/review/due — we don't have the
 *  full line audio, but the surface text + translations are enough
 *  for the example hint. Patch 11's content pipeline will round out
 *  the line audio. */
interface SourceLine {
  text?: string;
  textReading?: string | null;
  translations?: { en?: string; fr?: string } | null;
}

export default function ReviewSessionPage() {
  const router = useRouter();
  const courseId = typeof router.query.courseId === "string" ? router.query.courseId : null;

  // The review session state machine: idle → loading → ready → done.
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<DueCard[]>([]);
  const [totalDue, setTotalDue] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<ReviewPostResult | null>(null);

  // Locale is derived from `?base=` so the URL is shareable. Defaults
  // to English — the server side already returns glosses in every
  // base lang, the UI just picks which one to render.
  const rawBase = router.query.base;
  const base: BaseLang =
    typeof rawBase === "string" && (BASE_LANGS as readonly string[]).includes(rawBase)
      ? (rawBase as BaseLang)
      : "en";
  const locale: Locale = base;

  const currentCard = queue[currentIndex] ?? null;
  const remaining = Math.max(queue.length - currentIndex, 0);

  const loadQueue = useCallback(async () => {
    if (!courseId) return;
    setStatus("loading");
    setError(null);
    try {
      const res = await fetchReviewDue(courseId);
      setQueue(res.cards);
      setTotalDue(res.totalDue);
      setCurrentIndex(0);
      setFlipped(false);
      setLastResult(null);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("review.errorLoad", locale));
      setStatus("idle");
    }
  }, [courseId, locale]);

  // Kick off the load on mount + when the courseId changes.
  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const flip = useCallback(() => setFlipped((v) => !v), []);

  // Spacebar flips the card (mirrors the WordPopup keyboard convention).
  useEffect(() => {
    if (status !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        flip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, flip]);

  const rate = useCallback(
    async (rating: ReviewRating) => {
      if (!currentCard || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const r = await submitReviewRating({
          userVocabId: currentCard.userVocabId,
          rating
        });
        setLastResult(r);
        // Advance to the next card on the next tick so the
        // "Next review in {when}" hint can render briefly first.
        const nextIndex = currentIndex + 1;
        if (nextIndex >= queue.length) {
          setStatus("done");
        } else {
          setCurrentIndex(nextIndex);
          setFlipped(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("review.errorRate", locale));
      } finally {
        setSubmitting(false);
      }
    },
    [currentCard, currentIndex, queue.length, submitting, locale]
  );

  return (
    <>
      <Head>
        <title>{t("review.title", locale)} · AnimBook</title>
      </Head>

      <main className={`lang-page lang-review ${(base as string) === "he" ? "lang-rtl" : ""}`}>
        <header className="lang-review-header">
          <button
            type="button"
            className="lang-review-back"
            onClick={() =>
              router.push(
                courseId
                  ? `/languages/courses/${courseId}?base=${base}`
                  : `/languages?base=${base}`
              )
            }
          >
            ← {t("review.back", locale)}
          </button>
          <h1>{t("review.title", locale)}</h1>
          <p className="lang-review-subtitle">{t("review.subtitle", locale)}</p>
        </header>

        {status === "loading" ? (
          <p className="lang-review-status">…</p>
        ) : null}

        {error ? (
          <p className="lang-exercise-error" role="alert">
            {error}
          </p>
        ) : null}

        {status === "ready" && currentCard ? (
          <ReviewBody
            card={currentCard}
            flipped={flipped}
            onFlip={flip}
            base={base}
            locale={locale}
            onRate={rate}
            submitting={submitting}
            remaining={remaining}
            totalDue={totalDue}
            lastResult={lastResult}
          />
        ) : null}

        {status === "ready" && !currentCard ? (
          <EmptyState base={base} locale={locale} />
        ) : null}

        {status === "done" ? (
          <CompleteState base={base} locale={locale} totalDue={totalDue} />
        ) : null}
      </main>
    </>
  );
}

/* --------------------------------------------------------------------- *
 * Sub-components
 * --------------------------------------------------------------------- */

function ReviewBody({
  card,
  flipped,
  onFlip,
  base,
  locale,
  onRate,
  submitting,
  remaining,
  totalDue,
  lastResult
}: {
  card: DueCard;
  flipped: boolean;
  onFlip: () => void;
  base: BaseLang;
  locale: Locale;
  onRate: (r: ReviewRating) => void;
  submitting: boolean;
  remaining: number;
  totalDue: number;
  lastResult: ReviewPostResult | null;
}) {
  const glosses = useMemo(() => pickGlosses(card.lexeme.glosses, base), [card.lexeme.glosses, base]);
  const primaryGloss = glosses[0] ?? "";

  // Direction: Hebrew and Arabic flow RTL; Latin + zh-Hans + Cyrillic
  // are LTR. The whole card swaps direction so the lemma sits on the
  // correct side.
  const dir: "rtl" | "ltr" = (base as string) === "he" ? "rtl" : "ltr";
  const cardDir: "rtl" | "ltr" = card.lexeme.targetLang === "he" ? "rtl" : "ltr";

  return (
    <section className="lang-review-body" aria-live="polite">
      <p className="lang-review-countdown">
        {t("review.countdown", locale, undefined, Math.max(remaining, 0))}
        {totalDue > remaining ? ` · ${totalDue} due today` : ""}
      </p>

      <button
        type="button"
        className={`lang-review-card ${flipped ? "lang-review-card--flipped" : ""}`}
        onClick={onFlip}
        aria-label={flipped ? t("review.cardBackAria", locale) : t("review.cardFrontAria", locale)}
      >
        <div className="lang-review-card-face lang-review-card-front" lang={card.lexeme.targetLang} dir={cardDir}>
          <span className="lang-review-card-lemma">{card.lexeme.lemma}</span>
          {card.lexeme.reading ? (
            <span className="lang-review-card-reading" dir={cardDir}>
              {card.lexeme.reading}
            </span>
          ) : null}
          <span className="lang-review-card-meta">
            {card.lexeme.partOfSpeech}
            {card.lexeme.gender ? ` · ${card.lexeme.gender}` : ""}
          </span>
          <span className="lang-review-card-hint">{t("review.flip", locale)}</span>
        </div>

        <div className="lang-review-card-face lang-review-card-back" dir={dir}>
          <span className="lang-review-card-back-label">{t("review.glossesLabel", locale)}</span>
          <span className="lang-review-card-back-meaning">{primaryGloss}</span>
          {glosses.length > 1 ? (
            <ul className="lang-review-card-back-alt">
              {glosses.slice(1).map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          ) : null}
          <span className="lang-review-card-back-label">{t("review.exampleLabel", locale)}</span>
          <span className="lang-review-card-back-example">{card.sourceLineId ?? "—"}</span>
        </div>
      </button>

      <RatingPanel
        disabled={submitting || !flipped}
        onRate={onRate}
        locale={locale}
      />

      {lastResult ? (
        <p className="lang-review-result">
          {t("review.nextIn", locale, { when: formatInterval(lastResult.next.scheduledDays, locale) })}
        </p>
      ) : null}
    </section>
  );
}

function RatingPanel({
  disabled,
  onRate,
  locale
}: {
  disabled: boolean;
  onRate: (r: ReviewRating) => void;
  locale: Locale;
}) {
  // Show the rating buttons only after the card is flipped. The spec
  // calls for rating against your recalled confidence, and revealing
  // the answer too early defeats the purpose.
  return (
    <div className={`lang-review-rating ${disabled ? "lang-review-rating--disabled" : ""}`}>
      <RatingButton rating={1} disabled={disabled} onRate={onRate} locale={locale} variant="again" />
      <RatingButton rating={2} disabled={disabled} onRate={onRate} locale={locale} variant="hard" />
      <RatingButton rating={3} disabled={disabled} onRate={onRate} locale={locale} variant="good" />
      <RatingButton rating={4} disabled={disabled} onRate={onRate} locale={locale} variant="easy" />
    </div>
  );
}

function RatingButton({
  rating,
  disabled,
  onRate,
  locale,
  variant
}: {
  rating: ReviewRating;
  disabled: boolean;
  onRate: (r: ReviewRating) => void;
  locale: Locale;
  variant: "again" | "hard" | "good" | "easy";
}) {
  const key =
    variant === "again"
      ? "review.again"
      : variant === "hard"
        ? "review.hard"
        : variant === "good"
          ? "review.good"
          : "review.easy";
  const hintKey = key;
  return (
    <button
      type="button"
      className={`lang-review-rate lang-review-rate--${variant}`}
      disabled={disabled}
      onClick={() => onRate(rating)}
      aria-label={`${t(key, locale)} — ${t(hintKey, locale)}`}
    >
      <span className="lang-review-rate-label">{t(key, locale)}</span>
    </button>
  );
}

function EmptyState({ locale }: { base: BaseLang; locale: Locale }) {
  return (
    <section className="lang-review-empty">
      <h2>{t("review.empty", locale)}</h2>
      <p>{t("review.emptyBody", locale)}</p>
    </section>
  );
}

function CompleteState({
  locale,
  totalDue
}: {
  base: BaseLang;
  locale: Locale;
  totalDue: number;
}) {
  return (
    <section className="lang-review-complete">
      <h2>{t("review.complete", locale)}</h2>
      <p>{t("review.completeBody", locale)}</p>
      {totalDue > 0 ? (
        <p className="lang-review-complete-meta">
          {totalDue} more due today
        </p>
      ) : null}
    </section>
  );
}

/* --------------------------------------------------------------------- *
 * Helpers
 * --------------------------------------------------------------------- */

function pickGlosses(raw: unknown, base: BaseLang): string[] {
  // Glosses are stored as `{ en: ["..."], fr: ["..."] }` (Patch 06
  // shape). Fall back to "en" if the requested base is missing.
  if (raw && typeof raw === "object") {
    const dict = raw as Record<string, unknown>;
    const direct = dict[base];
    if (Array.isArray(direct) && direct.length > 0) {
      return direct.filter((x): x is string => typeof x === "string");
    }
    const en = dict["en"];
    if (Array.isArray(en) && en.length > 0) {
      return en.filter((x): x is string => typeof x === "string");
    }
  }
  return [];
}

/** Render the FSRS scheduled interval as a friendly phrase.
 *  Patch 11 will round to "X weeks" / "X months" once we have
 *  longer-lived decks. */
function formatInterval(days: number, locale: Locale): string {
  if (days < 1) return locale === "fr" ? "aujourd'hui" : "today";
  if (days === 1) return locale === "fr" ? "1 jour" : "1 day";
  if (days < 7) return locale === "fr" ? `${days} jours` : `${days} days`;
  if (days < 30) {
    const w = Math.round(days / 7);
    return locale === "fr" ? `${w} semaine${w === 1 ? "" : "s"}` : `${w} week${w === 1 ? "" : "s"}`;
  }
  const m = Math.round(days / 30);
  return locale === "fr" ? `${m} mois` : `${m} month${m === 1 ? "" : "s"}`;
}

// Silence the unused import — SourceLine is kept as a doc-only type
// because the example hint will be wired through the importer's
// line-join in Patch 11.
export type { SourceLine };
