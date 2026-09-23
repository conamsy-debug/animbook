/**
 * WordPopup — spec § 7.5 screen 5.
 *
 * Renders the popup data for one tappable token:
 *   - surface form + lemma (with reading aid when present)
 *   - part of speech + gender (with a colour cue for de)
 *   - per-base-language glosses
 *   - audio playback (when the lexeme has audio_url)
 *   - "Save to my words" button → saveVocab()
 *   - the source line as the example sentence
 *
 * Layout: sheet on mobile (slides up from bottom, full-width), centred
 * popover on desktop. ESC + scrim-click + the close button all dismiss.
 *
 * The component owns its fetch — once the popup opens, we fetch the
 * lexeme. The player hands us the lexemeId (real cuid) + source line id
 * via props; we don't need the line in state because the popup data
 * already includes the source line text + base translation.
 *
 * Saved-state UX: after a successful save, the button flips to
 * "Saved ✓" and stays clickable so the learner can remove (PATCH 06
 * does not yet expose a per-popup delete — the My-words page owns
 * removal). When the popup re-opens for the same word, the saved
 * state is rehydrated on mount.
 */
import { useEffect, useState } from "react";
import {
  fetchLexeme,
  saveVocab,
  type LexemePopup,
  type VocabRow
} from "./api";
import { t, type Locale } from "./i18n/t";

interface WordPopupProps {
  /** Lexeme cuid emitted by PlayerToken.lexemeId. */
  lexemeId: string;
  /** The line the learner tapped from. Used for the example sentence. */
  sourceLineId?: string | null;
  /** Base language for the UI text + glosses. */
  locale: Locale;
  /** Optional: a pre-fetched row (e.g. from "My words") so the popup
   *  can render without a round-trip. When supplied, the popup
   *  skips its own fetch and uses this row as its data source. */
  prefetched?: VocabRow | null;
  /** Fires when the learner dismisses the popup. */
  onClose: () => void;
}

/**
 * Convert a part-of-speech + optional gender into a short tag like
 * "noun · m" or "verb". The popup surfaces it under the lemma.
 * Returns a single space-separated string for cheap SSR.
 */
export function posTag(partOfSpeech: string, gender: string | null): string {
  if (!gender) return partOfSpeech;
  return `${partOfSpeech} · ${gender}`;
}

/**
 * Map a lexeme target language to the CSS class that gives the
 * "noun gender" pill its colour cue for German. Other languages fall
 * back to a neutral pill style.
 */
function genderClass(targetLang: string): string {
  if (targetLang === "de") return "lang-popup-gender--de";
  if (targetLang === "es" || targetLang === "it" || targetLang === "fr") {
    return "lang-popup-gender--latin";
  }
  return "lang-popup-gender--neutral";
}

export function WordPopup({ lexemeId, sourceLineId, locale, prefetched, onClose }: WordPopupProps) {
  const [data, setData] = useState<LexemePopup | null>(prefetched ? popupFromRow(prefetched) : null);
  const [loading, setLoading] = useState<boolean>(!prefetched);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<boolean>(prefetched != null);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedError, setSavedError] = useState<string | null>(null);

  useEffect(() => {
    if (prefetched) {
      setData(popupFromRow(prefetched));
      setSaved(true);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchLexeme({ lexemeId, base: locale, lineId: sourceLineId, signal: ac.signal })
      .then((payload) => {
        if (ac.signal.aborted) return;
        if (!payload) {
          setError(t("popup.notFound", locale));
        } else {
          setData(payload);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : t("popup.error", locale));
        setLoading(false);
      });
    return () => ac.abort();
  }, [lexemeId, sourceLineId, locale, prefetched]);

  // ESC dismisses. The StoryPlayer also listens for ESC, so we
  // stopPropagation so the popup closes independently.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const onSave = async () => {
    if (saved || saving) return;
    setSaving(true);
    setSavedError(null);
    try {
      await saveVocab({ lexemeId, sourceLineId: sourceLineId ?? null });
      setSaved(true);
    } catch (err) {
      setSavedError(err instanceof Error ? err.message : t("popup.saveError", locale));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="lang-popup-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lang-popup-title"
      onClick={(e) => {
        // Scrim-click closes; clicks inside the card do not bubble.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lang-popup" lang={data?.targetLang} dir={data?.targetLang === "he" ? "rtl" : "ltr"}>
        <button
          type="button"
          className="lang-popup-close"
          aria-label={t("popup.close", locale)}
          onClick={onClose}
        >
          ×
        </button>

        {loading ? (
          <p className="lang-popup-loading">{t("popup.loading", locale)}</p>
        ) : error || !data ? (
          <p className="lang-popup-error" role="alert">{error ?? t("popup.notFound", locale)}</p>
        ) : (
          <>
            <header className="lang-popup-header">
              <h2 id="lang-popup-title" className="lang-popup-surface">
                {data.surface}
              </h2>
              {data.reading && data.reading !== data.surface ? (
                <p className="lang-popup-reading">{data.reading}</p>
              ) : null}
              <p className="lang-popup-pos">
                <span className={`lang-popup-gender ${genderClass(data.targetLang)}`}>
                  {posTag(data.partOfSpeech, data.gender)}
                </span>
              </p>
              {data.audioUrl ? (
                <audio controls preload="none" src={data.audioUrl} className="lang-popup-audio">
                  {t("popup.audioFallback", locale)}
                </audio>
              ) : null}
            </header>

            <section className="lang-popup-section" aria-labelledby="lang-popup-glosses-heading">
              <h3 id="lang-popup-glosses-heading" className="lang-popup-section-heading">
                {t("popup.meanings", locale)}
              </h3>
              {data.glosses.length > 0 ? (
                <ul className="lang-popup-glosses" role="list">
                  {data.glosses.map((gloss, i) => (
                    <li key={i} className="lang-popup-gloss">
                      {gloss}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lang-popup-empty">{t("popup.noGlosses", locale)}</p>
              )}
            </section>

            {data.sourceLine ? (
              <section className="lang-popup-section lang-popup-source" aria-labelledby="lang-popup-source-heading">
                <h3 id="lang-popup-source-heading" className="lang-popup-section-heading">
                  {t("popup.exampleHeading", locale)}
                </h3>
                <p className="lang-popup-source-text" lang={data.targetLang} dir={data.targetLang === "he" ? "rtl" : "ltr"}>
                  {data.sourceLine.text}
                </p>
                {data.sourceLine.textReading && data.sourceLine.textReading !== data.sourceLine.text ? (
                  <p className="lang-popup-source-reading">{data.sourceLine.textReading}</p>
                ) : null}
                <p className="lang-popup-source-translation">{data.sourceLine.translation}</p>
              </section>
            ) : null}

            <div className="lang-popup-actions">
              <button
                type="button"
                className={
                  "lang-popup-save" +
                  (saved ? " lang-popup-save--saved" : "") +
                  (saving ? " lang-popup-save--busy" : "")
                }
                onClick={onSave}
                disabled={saved || saving}
                aria-pressed={saved}
              >
                {saved
                  ? t("popup.savedButton", locale)
                  : saving
                  ? t("popup.saving", locale)
                  : t("popup.saveButton", locale)}
              </button>
              {savedError ? (
                <p className="lang-popup-save-error" role="alert">
                  {savedError}
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Adapter: lift a VocabRow into the LexemePopup shape the component
 *  expects. The popup doesn't always need a fresh fetch — when the
 *  user opens one from the "My words" page, we already have the row
 *  in memory. */
function popupFromRow(row: VocabRow): LexemePopup {
  return {
    lexemeId: row.lexemeId,
    targetLang: row.targetLang,
    surface: row.lemma,
    lemma: row.lemma,
    reading: row.reading,
    partOfSpeech: row.partOfSpeech,
    gender: row.gender,
    glosses: row.glosses,
    audioUrl: row.audioUrl,
    frequencyRank: null,
    sourceLine: row.sourceLine
  };
}