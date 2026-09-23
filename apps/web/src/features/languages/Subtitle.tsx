/**
 * Subtitle — renders the active line of a story as a row of tappable
 * tokens. Honors spec § 7 requirements:
 *
 *   1. `<ruby>` / `<rt>` for Chinese reading aid — the per-token
 *      reading (tone-marked pinyin) sits above each character group.
 *   2. RTL for Hebrew — the wrapper carries `lang="he" dir="rtl"`
 *      and CSS logical properties. Tap targets stay square; only
 *      the text flow mirrors.
 *   3. New-word underline — tokens flagged `is_new` get a thin
 *      underline so the learner can spot the vocab to come.
 *   4. Tappable tokens (Patch 06) — clicking a word token opens the
 *      word popup. Punctuation tokens and gaps between tokens
 *      trigger line replay instead, so the line-level behaviour
 *      survives a missed tap.
 *
 * Tap behaviour:
 *   - Tap a word token (data-token-index set) → onTokenTap(idx)
 *   - Tap a punctuation token or anywhere outside a word token →
 *     onReplayLine()
 */
import type { CSSProperties } from "react";
import type { PlayerLine, PlayerToken, PlayerToggles, ReadingAid } from "./types";

interface SubtitleProps {
  line: PlayerLine | null;
  /** BCP-47 — used for `lang=` + `dir=` on the wrapper. */
  lang: string;
  direction: "ltr" | "rtl";
  /** Web font for the target-language text. null = system default. */
  fontFamily: string | null;
  readingAid: ReadingAid;
  toggles: PlayerToggles;
  /** Replay the current line (line-level tap). */
  onReplayLine: () => void;
  /** Patch 06 — open the word popup for the tapped token. */
  onTokenTap?: (tokenIndex: number) => void;
}

export function Subtitle({
  line,
  lang,
  direction,
  fontFamily,
  readingAid,
  toggles,
  onReplayLine,
  onTokenTap
}: SubtitleProps) {
  if (!line) {
    return (
      <div className="lang-subtitle lang-subtitle--empty" lang={lang} dir={direction}>
        <p className="lang-subtitle-empty-text">…</p>
      </div>
    );
  }

  const wrapperStyle: CSSProperties = fontFamily ? { fontFamily } : {};

  // Pick the visible text. For Hebrew the toggle swaps between
  // unpointed (`text`) and pointed (`text_reading`); for Chinese
  // pinyin lives on the per-token reading, not on the line. We
  // pre-compute the showPointed flag and pass it to TokenSpan so
  // each token renders the right variant in the same row.
  const showPointed = readingAid === "niqqud" && toggles.showReadingAid && Boolean(line.textReading);

  return (
    <div className="lang-subtitle" lang={lang} dir={direction} style={wrapperStyle}>
      <p
        className="lang-subtitle-line"
        onClick={(e) => {
          // A token click sets data-token-index on the target span;
          // bubbles up here. Stop further bubbling so the wrapper
          // doesn't fire line-replay for the same gesture, then
          // delegate to onTokenTap.
          const target = e.target as HTMLElement;
          const raw = target.closest("[data-token-index]")?.getAttribute("data-token-index");
          if (raw !== null && raw !== undefined) {
            const idx = Number(raw);
            if (onTokenTap && Number.isFinite(idx)) {
              onTokenTap(idx);
            }
            return;
          }
          // Bare wrapper click (gap between tokens, punctuation) →
          // replay the line.
          onReplayLine();
        }}
        role="button"
        tabIndex={0}
        aria-label={`Replay line ${line.order}: ${line.speaker}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onReplayLine();
          }
        }}
      >
        {line.tokens.map((token) => (
          <TokenSpan
            key={token.order}
            token={token}
            readingAid={readingAid}
            showReadingAid={toggles.showReadingAid}
            showPointed={showPointed}
          />
        ))}
      </p>
      {toggles.showTranslation ? (
        <p className="lang-subtitle-translation" lang={direction === "rtl" ? "en" : undefined}>
          {line.translation}
        </p>
      ) : null}
    </div>
  );
}

interface TokenSpanProps {
  token: PlayerToken;
  readingAid: ReadingAid;
  showReadingAid: boolean;
  /** True when Hebrew niqqud toggle is on — surface the pointed line text. */
  showPointed: boolean;
}

/**
 * TokenSpan — renders a single tappable token. For Chinese we wrap
 * in `<ruby><rt>` so the pinyin sits above the character group.
 * For other languages, `<ruby>` is harmless: browsers without
 * ruby support fall back to inline rendering.
 *
 * Token-level click metadata: data-token-index carries the token's
 * 1-based order; the wrapper's click handler reads it to decide
 * between onTokenTap and onReplayLine. Punctuation tokens stay
 * clickable so a learner can still replay by tapping punctuation,
 * but the index is exposed for analytics later if we need it.
 */
function TokenSpan({ token, readingAid, showReadingAid, showPointed }: TokenSpanProps) {
  const isChinese = readingAid === "pinyin";
  const showRuby = isChinese && showReadingAid && Boolean(token.reading);

  // Hebrew "text ↔ textReading" swap. Patch 06 uses the per-token
  // reading as the pointed variant for consistency with the line-
  // level swap (line.textReading carries the full pointed line for
  // sites that don't per-token-point; here we honour the per-token
  // reading when present, falling back to surface).
  const displaySurface = showPointed && token.reading ? token.reading : token.surface;

  const classes = [
    "lang-token",
    token.isNewInStory && "lang-token--new",
    token.isPunctuation && "lang-token--punct",
    token.lexemeId && "lang-token--tappable"
  ]
    .filter(Boolean)
    .join(" ");

  if (showRuby) {
    return (
      <ruby
        className={classes}
        data-token-index={token.order}
        data-lexeme-id={token.lexemeId ?? undefined}
      >
        {displaySurface}
        <rt>{token.reading}</rt>
      </ruby>
    );
  }
  return (
    <span
      className={classes}
      data-token-index={token.order}
      data-lexeme-id={token.lexemeId ?? undefined}
    >
      {displaySurface}
    </span>
  );
}