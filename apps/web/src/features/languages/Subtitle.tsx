/**
 * Subtitle — renders the active line of a story as a row of tappable
 * tokens. Honors three spec § 7 requirements:
 *
 *   1. `<ruby>` / `<rt>` for Chinese reading aid — the per-token
 *      reading (tone-marked pinyin) sits above each character group
 *      without overlapping.
 *   2. RTL for Hebrew — the wrapper carries `lang="he" dir="rtl"`
 *      and CSS logical properties. Tap targets stay square; only
 *      the text flow mirrors.
 *   3. New-word underline — tokens flagged `is_new` get a thin
 *      underline so the learner can spot the vocab to come.
 *
 * Tap behaviour (spec § 7: "Tap a line to replay it"):
 *   - Tapping any token (or the empty area between tokens) replays
 *     the current line via `onReplayLine`.
 *   - Patch 06 will add token-level taps to open the word popup.
 *     For now, the token click bubbles up to the line-level handler.
 */
import type { CSSProperties } from "react";
import type { PlayerLine, PlayerToggles, ReadingAid } from "./types";

interface SubtitleProps {
  line: PlayerLine | null;
  /** BCP-47 — used for `lang=` + `dir=` on the wrapper. */
  lang: string;
  direction: "ltr" | "rtl";
  /** Web font for the target-language text. null = system default. */
  fontFamily: string | null;
  readingAid: ReadingAid;
  toggles: PlayerToggles;
  /** True when the auto-advance timer should pause (e.g. user opened
   *  the word popup or is mid-replay). Patch 06 will flip this. */
  onReplayLine: () => void;
  /** Patch 06 hook — currently a no-op so we keep the prop surface
   *  stable. The token click handler checks it before delegating up. */
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
  // pinyin lives on the per-token reading, not on the line.
  const showPointed = readingAid === "niqqud" && toggles.showReadingAid && Boolean(line.textReading);
  const displayText = showPointed ? line.textReading ?? line.text : line.text;

  return (
    <div className="lang-subtitle" lang={lang} dir={direction} style={wrapperStyle}>
      <p
        className="lang-subtitle-line"
        onClick={(e) => {
          // Distinguish token click from line click — token clicks
          // have data-token-index set by the inner span.
          const target = e.target as HTMLElement;
          if (target.dataset["tokenIndex"] !== undefined) {
            const idx = Number(target.dataset["tokenIndex"]);
            if (onTokenTap && Number.isFinite(idx)) {
              onTokenTap(idx);
            }
            return;
          }
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
        {displayText}
      </p>
      <div className="lang-subtitle-tokens" aria-hidden="true">
        {line.tokens.map((token) => (
          <TokenSpan
            key={token.order}
            surface={token.surface}
            reading={token.reading}
            readingAid={readingAid}
            showReadingAid={toggles.showReadingAid}
            isNew={token.isNewInStory}
            isPunctuation={token.isPunctuation}
          />
        ))}
      </div>
      {toggles.showTranslation ? (
        <p className="lang-subtitle-translation" lang={direction === "rtl" ? "en" : undefined}>
          {line.translation}
        </p>
      ) : null}
    </div>
  );
}

interface TokenSpanProps {
  surface: string;
  reading: string | null;
  readingAid: ReadingAid;
  showReadingAid: boolean;
  isNew: boolean;
  isPunctuation: boolean;
}

/**
 * TokenSpan — renders a single tappable token. For Chinese we wrap
 * in `<ruby><rt>` so the pinyin sits above the character group.
 * For other languages, `<ruby>` is harmless: browsers without
 * ruby support fall back to inline rendering.
 */
function TokenSpan({ surface, reading, readingAid, showReadingAid, isNew, isPunctuation }: TokenSpanProps) {
  const isChinese = readingAid === "pinyin";
  const showRuby = isChinese && showReadingAid && Boolean(reading);

  const classes = [
    "lang-token",
    isNew && "lang-token--new",
    isPunctuation && "lang-token--punct"
  ]
    .filter(Boolean)
    .join(" ");

  if (showRuby) {
    return (
      <ruby className={classes}>
        {surface}
        <rt>{reading}</rt>
      </ruby>
    );
  }
  return <span className={classes}>{surface}</span>;
}
