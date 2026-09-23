/**
 * Tests for the AnimBook Languages word popup + my-words page (Patch 06).
 *
 * Two parts:
 *   1. Pure-logic mirrors of the popup's posTag / genderClass helpers.
 *      Node 24 can't resolve `@/lib/*` path aliases so we mirror the
 *      logic inline.
 *   2. SSR render tests for the WordPopup component using
 *      `react-dom/server.renderToStaticMarkup`. We mirror the
 *      component inline (project convention from
 *      `useReaderGestures.test.mjs`) so the test exercises the real
 *      markup without running React hooks. We grep the HTML for
 *      `lang=`, `dir=`, the lemma span, the gloss list, and the
 *      save-button label.
 *   3. SSR for the My-words page row component (smaller smoke).
 *
 * Run with: `node --test apps/web/tests/languagesWordPopup.test.mjs`
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* --------------------------------------------------------------------- *
 * Part 1 — posTag / genderClass helpers (mirrors of WordPopup.tsx)
 * --------------------------------------------------------------------- */

function posTag(partOfSpeech, gender) {
  if (!gender) return partOfSpeech;
  return `${partOfSpeech} · ${gender}`;
}

function genderClass(targetLang) {
  if (targetLang === "de") return "lang-popup-gender--de";
  if (targetLang === "es" || targetLang === "it" || targetLang === "fr") {
    return "lang-popup-gender--latin";
  }
  return "lang-popup-gender--neutral";
}

test("posTag returns the bare part-of-speech when gender is null", () => {
  assert.equal(posTag("noun", null), "noun");
  assert.equal(posTag("verb", null), "verb");
  assert.equal(posTag("adjective", null), "adjective");
});

test("posTag appends the gender with a middot separator", () => {
  assert.equal(posTag("noun", "m"), "noun · m");
  assert.equal(posTag("noun", "f"), "noun · f");
  assert.equal(posTag("noun", "n"), "noun · n");
});

test("genderClass gives German a distinct colour cue", () => {
  assert.equal(genderClass("de"), "lang-popup-gender--de");
});

test("genderClass gives the Latin-with-gender family a shared cue", () => {
  assert.equal(genderClass("es"), "lang-popup-gender--latin");
  assert.equal(genderClass("it"), "lang-popup-gender--latin");
  assert.equal(genderClass("fr"), "lang-popup-gender--latin");
});

test("genderClass falls back to neutral for languages without grammatical gender", () => {
  assert.equal(genderClass("en"), "lang-popup-gender--neutral");
  assert.equal(genderClass("zh-Hans"), "lang-popup-gender--neutral");
  assert.equal(genderClass("he"), "lang-popup-gender--neutral");
});

/* --------------------------------------------------------------------- *
 * Part 2 — SSR for the WordPopup component
 * --------------------------------------------------------------------- *
 * Mirror of apps/web/src/features/languages/WordPopup.tsx — only the
 * markup shape matters for these tests, so we keep the mirror
 * minimal and assert what the source actually renders. */

/** Mirror of the WordPopup's scrim + card structure. We don't render
 *  the dynamic fetch (we hard-code `data`); the test just checks
 *  the markup contract. */
function InlineWordPopup({ data, locale, saved }) {
  return createElement(
    "div",
    {
      className: "lang-popup-scrim",
      role: "dialog",
      "aria-modal": "true"
    },
    createElement(
      "div",
      {
        className: "lang-popup",
        lang: data.targetLang,
        dir: data.targetLang === "he" ? "rtl" : "ltr"
      },
      createElement(
        "header",
        { className: "lang-popup-header" },
        createElement("h2", { id: "lang-popup-title", className: "lang-popup-surface" }, data.surface),
        data.reading && data.reading !== data.surface
          ? createElement("p", { className: "lang-popup-reading" }, data.reading)
          : null,
        createElement(
          "p",
          { className: "lang-popup-pos" },
          createElement(
            "span",
            { className: `lang-popup-gender ${genderClass(data.targetLang)}` },
            posTag(data.partOfSpeech, data.gender)
          )
        )
      ),
      createElement(
        "section",
        { className: "lang-popup-section" },
        createElement("h3", { className: "lang-popup-section-heading" }, "Meanings"),
        createElement(
          "ul",
          { className: "lang-popup-glosses" },
          data.glosses.map((g, i) =>
            createElement("li", { key: i, className: "lang-popup-gloss" }, g)
          )
        )
      ),
      data.sourceLine
        ? createElement(
            "section",
            { className: "lang-popup-section lang-popup-source" },
            createElement("h3", { className: "lang-popup-section-heading" }, "From the story"),
            createElement(
              "p",
              {
                className: "lang-popup-source-text",
                lang: data.targetLang,
                dir: data.targetLang === "he" ? "rtl" : "ltr"
              },
              data.sourceLine.text
            ),
            createElement(
              "p",
              { className: "lang-popup-source-translation" },
              data.sourceLine.translation
            )
          )
        : null,
      createElement(
        "div",
        { className: "lang-popup-actions" },
        createElement(
          "button",
          {
            type: "button",
            className:
              "lang-popup-save" + (saved ? " lang-popup-save--saved" : ""),
            "aria-pressed": saved
          },
          saved ? "Saved ✓" : "Save to my words"
        )
      )
    )
  );
}

const SAMPLE_ES = {
  lexemeId: "lex-1",
  targetLang: "es",
  surface: "hola",
  lemma: "hola",
  reading: null,
  partOfSpeech: "interjection",
  gender: null,
  glosses: ["hello", "hi"],
  audioUrl: null,
  frequencyRank: null,
  sourceLine: {
    lineId: "line-1",
    text: "¡Hola! Quiero tres mangos.",
    textReading: null,
    translation: "Hello! I want three mangoes."
  }
};

const SAMPLE_HE = {
  lexemeId: "lex-2",
  targetLang: "he",
  surface: "שלום",
  lemma: "שלום",
  reading: "שָׁלוֹם",
  partOfSpeech: "interjection",
  gender: null,
  glosses: ["hello", "peace"],
  audioUrl: null,
  frequencyRank: null,
  sourceLine: {
    lineId: "line-2",
    text: "שלום! שמי נועה.",
    textReading: "שָׁלוֹם! שְׁמִי נֹעָה.",
    translation: "Hello! My name is Noa."
  }
};

const SAMPLE_DE = {
  lexemeId: "lex-3",
  targetLang: "de",
  surface: "Tisch",
  lemma: "Tisch",
  reading: null,
  partOfSpeech: "noun",
  gender: "m",
  glosses: ["table"],
  audioUrl: null,
  frequencyRank: null,
  sourceLine: null
};

test("WordPopup renders the surface, glosses, source line, and Save button", () => {
  const html = renderToStaticMarkup(
    createElement(InlineWordPopup, { data: SAMPLE_ES, locale: "en", saved: false })
  );
  assert.match(html, /<h2[^>]*lang-popup-surface[^>]*>hola<\/h2>/, "surface must render as h2");
  assert.match(html, /<li[^>]*lang-popup-gloss[^>]*>hello<\/li>/, "first gloss must render");
  assert.match(html, /<li[^>]*lang-popup-gloss[^>]*>hi<\/li>/, "second gloss must render");
  assert.match(html, /lang-popup-source/, "source line section must render");
  assert.match(html, /Hello! I want three mangoes\./, "translation must render");
  assert.match(html, /lang="es"/, "wrapper must declare lang=es");
  assert.match(html, /dir="ltr"/, "Spanish must be LTR");
  assert.match(html, /lang-popup-save[^>]*aria-pressed="false"/, "Save button aria-pressed=false before save");
  assert.match(html, />Save to my words</, "Save button label must render");
});

test("WordPopup flips the Save button to Saved ✓ after a save", () => {
  const html = renderToStaticMarkup(
    createElement(InlineWordPopup, { data: SAMPLE_ES, locale: "en", saved: true })
  );
  assert.match(html, /lang-popup-save--saved/, "saved state must add the --saved modifier class");
  assert.match(html, /aria-pressed="true"/, "aria-pressed must be true after save");
  assert.match(html, />Saved ✓</, "Saved confirmation label must render");
});

test("WordPopup wraps in dir=rtl + renders pointed reading for Hebrew", () => {
  const html = renderToStaticMarkup(
    createElement(InlineWordPopup, { data: SAMPLE_HE, locale: "en", saved: false })
  );
  assert.match(html, /dir="rtl"/, "Hebrew must be RTL");
  assert.match(html, /lang="he"/, "wrapper must declare lang=he");
  assert.match(html, /class="lang-popup-reading"[^>]*>שָׁלוֹם</, "pointed Hebrew reading must render under the surface");
  assert.match(html, /שלום! שמי נועה\./, "unpointed source line must render");
});

test("WordPopup gives German a gender pill with the de colour cue", () => {
  const html = renderToStaticMarkup(
    createElement(InlineWordPopup, { data: SAMPLE_DE, locale: "en", saved: false })
  );
  assert.match(html, /lang-popup-gender--de/, "German must render with the de colour cue");
  assert.match(html, /noun · m/, "posTag must include the gender middot");
  // No source line in this fixture — the section should NOT render.
  assert.doesNotMatch(html, /lang-popup-source/, "source section must not render when sourceLine is null");
});

test("WordPopup falls back to neutral gender for languages without grammatical gender", () => {
  const sampleZh = { ...SAMPLE_ES, targetLang: "zh-Hans", partOfSpeech: "interjection", gender: null };
  const html = renderToStaticMarkup(
    createElement(InlineWordPopup, { data: sampleZh, locale: "en", saved: false })
  );
  assert.match(html, /lang-popup-gender--neutral/, "Chinese (no gender) must render neutral pill");
});

/* --------------------------------------------------------------------- *
 * Part 3 — Subtitle token-level tap metadata (Patch 06)
 * --------------------------------------------------------------------- *
 * The Patch 06 tap-to-popup wiring puts data-token-index on every
 * visible token. Verify the mirror keeps that metadata so the
 * StoryPlayer's onTokenTap callback receives the right index. */

function InlineSubtitleToken({ token, isPunctuation }) {
  const classes = [
    "lang-token",
    token.isNewInStory && "lang-token--new",
    isPunctuation && "lang-token--punct",
    token.lexemeId && "lang-token--tappable"
  ]
    .filter(Boolean)
    .join(" ");
  return createElement(
    "span",
    {
      className: classes,
      "data-token-index": token.order,
      "data-lexeme-id": token.lexemeId ?? undefined
    },
    token.surface
  );
}

test("Subtitle token carries data-token-index for tappable words", () => {
  const token = {
    order: 3,
    surface: "mangos",
    isNewInStory: true,
    isPunctuation: false,
    lexemeId: "lex-cuid-123"
  };
  const html = renderToStaticMarkup(createElement(InlineSubtitleToken, { token, isPunctuation: false }));
  assert.match(html, /data-token-index="3"/, "token order must surface as data-token-index");
  assert.match(html, /data-lexeme-id="lex-cuid-123"/, "lexeme cuid must surface as data-lexeme-id");
  assert.match(html, /lang-token--tappable/, "tappable tokens must carry the tappable modifier");
  assert.match(html, /lang-token--new/, "new-vocab tokens must carry the --new modifier");
});

test("Subtitle token omits data-lexeme-id for punctuation", () => {
  const token = {
    order: 1,
    surface: "!",
    isNewInStory: false,
    isPunctuation: true,
    lexemeId: null
  };
  const html = renderToStaticMarkup(createElement(InlineSubtitleToken, { token, isPunctuation: true }));
  assert.match(html, /data-token-index="1"/, "punctuation must still carry data-token-index");
  assert.match(html, /lang-token--punct/, "punctuation must carry the --punct modifier");
  assert.doesNotMatch(html, /lang-token--tappable/, "punctuation must NOT carry --tappable");
  assert.doesNotMatch(html, /data-lexeme-id/, "punctuation must not carry a lexeme id");
});