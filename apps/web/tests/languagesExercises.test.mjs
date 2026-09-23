/**
 * Tests for AnimBook Languages Patch 07 — exercise views.
 *
 * Pure-logic mirrors + SSR. We mirror the ExerciseView's:
 *   - normaliseOptions (option resolution for both flat string + per-
 *     base-language shapes)
 *   - the inline result-panel structure
 *
 * Node 24 can't resolve `@/lib/*` aliases so we mirror inline.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* --------------------------------------------------------------------- *
 * Part 1 — normaliseOptions mirror
 * --------------------------------------------------------------------- *
 * The ExerciseView takes an Exercise payload (which the server hands
 * us from the player payload — Patch 04's wire shape) and picks the
 * right option list for the learner's base language. The fixture uses
 * the per-base shape ({en: [...], fr: [...]}) for word_meaning_mc
 * and the flat shape ([...]) for the others. */

function normaliseOptions(payload, base) {
  const raw = payload["options"];
  if (Array.isArray(raw) && raw.every((v) => typeof v === "string")) {
    return raw.map((text, index) => ({ index, text }));
  }
  if (raw && typeof raw === "object") {
    const byBase = raw[base] ?? raw["en"];
    if (Array.isArray(byBase)) {
      return byBase.map((text, index) => ({ index, text }));
    }
  }
  return [];
}

test("normaliseOptions handles the flat-string shape (comprehension + listen_select)", () => {
  const opts = normaliseOptions({ options: ["a", "b", "c"] }, "en");
  assert.deepEqual(opts, [
    { index: 0, text: "a" },
    { index: 1, text: "b" },
    { index: 2, text: "c" }
  ]);
});

test("normaliseOptions handles the per-base-language shape (word_meaning_mc)", () => {
  const opts = normaliseOptions(
    { options: { en: ["x", "y"], fr: ["x", "y"] } },
    "fr"
  );
  assert.deepEqual(opts, [
    { index: 0, text: "x" },
    { index: 1, text: "y" }
  ]);
});

test("normaliseOptions falls back to en when the requested base is missing", () => {
  // The MC views re-render with whichever base the learner chose.
  // If the fr glosses haven't shipped yet, the popup falls back to
  // en so the wire shape stays stable.
  const opts = normaliseOptions(
    { options: { en: ["only-en"] } },
    "fr"
  );
  assert.deepEqual(opts, [{ index: 0, text: "only-en" }]);
});

test("normaliseOptions returns [] for unknown payload shapes", () => {
  assert.deepEqual(normaliseOptions({}, "en"), []);
  assert.deepEqual(normaliseOptions({ options: null }, "en"), []);
  assert.deepEqual(normaliseOptions({ options: { en: "not-an-array" } }, "en"), []);
});

/* --------------------------------------------------------------------- *
 * Part 2 — SSR for the ExerciseView result panel + the MC options
 * --------------------------------------------------------------------- *
 * Mirror of the ExerciseView's MC shell. We render enough markup to
 * pin the wire shape the player reads (option radiogroup, correct /
 * wrong state, XP label, Continue button). */

function InlineMcExercise({
  options,
  selected,
  result,
  showResult
}) {
  return createElement(
    "div",
    { className: "lang-exercise lang-exercise--mc" },
    createElement("h2", { className: "lang-exercise-question" }, "Pick the answer"),
    createElement(
      "ul",
      { className: "lang-exercise-options", role: "radiogroup" },
      options.map((opt) => {
        const isCorrect = showResult && result.isCorrect && result.correctIndex === opt.index;
        const isWrongSelection = showResult && !result.isCorrect && selected === opt.index;
        const isRevealCorrect =
          showResult && !result.isCorrect && result.correctIndex === opt.index;
        const classes = [
          "lang-exercise-option",
          isCorrect && "lang-exercise-option--correct",
          isWrongSelection && "lang-exercise-option--wrong",
          isRevealCorrect && "lang-exercise-option--reveal"
        ]
          .filter(Boolean)
          .join(" ");
        return createElement(
          "li",
          { key: opt.index },
          createElement(
            "button",
            {
              type: "button",
              role: "radio",
              "aria-checked": selected === opt.index,
              className: classes,
              disabled: showResult
            },
            opt.text
          )
        );
      })
    ),
    showResult
      ? createElement(
          "section",
          {
            className: `lang-exercise-result ${result.isCorrect ? "lang-exercise-result--correct" : "lang-exercise-result--wrong"}`,
            role: "status"
          },
          createElement(
            "p",
            { className: "lang-exercise-result-line" },
            result.isCorrect ? "Correct!" : "Not quite"
          ),
          result.xpAwarded > 0
            ? createElement(
                "p",
                { className: "lang-exercise-result-xp" },
                `+${result.xpAwarded} XP`
              )
            : null,
          createElement(
            "button",
            { type: "button", className: "lang-exercise-continue" },
            "Continue"
          )
        )
      : createElement(
          "button",
          { type: "button", className: "lang-exercise-submit" },
          "Check"
        )
  );
}

test("MC shell renders options as a radiogroup with the selected option checked", () => {
  const html = renderToStaticMarkup(
    createElement(InlineMcExercise, {
      options: [
        { index: 0, text: "1" },
        { index: 1, text: "3" },
        { index: 2, text: "5" }
      ],
      selected: 1,
      result: null,
      showResult: false
    })
  );
  assert.match(html, /role="radiogroup"/, "options must live in a radiogroup");
  assert.match(html, /aria-checked="true"[^>]*>3</, "the selected option must have aria-checked=true");
  assert.match(html, /aria-checked="false"[^>]*>1</, "unselected options must have aria-checked=false");
  assert.match(html, /lang-exercise-submit/, "the Check submit button must render before submit");
  assert.doesNotMatch(html, /lang-exercise-result/, "no result panel before submit");
});

test("MC shell highlights the right option on a correct attempt", () => {
  const html = renderToStaticMarkup(
    createElement(InlineMcExercise, {
      options: [
        { index: 0, text: "1" },
        { index: 1, text: "3" }
      ],
      selected: 1,
      result: { isCorrect: true, correctIndex: 1, xpAwarded: 10 },
      showResult: true
    })
  );
  assert.match(html, /lang-exercise-option--correct/, "the correct option must carry the --correct modifier");
  assert.match(html, /lang-exercise-result--correct/, "the result panel must carry the --correct modifier");
  assert.match(html, /Correct!/, "correct copy must render");
  assert.match(html, /\+10 XP/, "XP label must render");
  assert.match(html, /lang-exercise-continue/, "Continue button must render after submit");
});

test("MC shell flags the wrong selection + reveals the right one", () => {
  const html = renderToStaticMarkup(
    createElement(InlineMcExercise, {
      options: [
        { index: 0, text: "wrong" },
        { index: 1, text: "right" }
      ],
      selected: 0,
      result: { isCorrect: false, correctIndex: 1, xpAwarded: 0 },
      showResult: true
    })
  );
  assert.match(html, /lang-exercise-option--wrong/, "the wrong selection must carry the --wrong modifier");
  assert.match(html, /lang-exercise-option--reveal/, "the correct option must carry --reveal on a wrong attempt");
  assert.match(html, /lang-exercise-result--wrong/, "result panel must carry --wrong on a wrong attempt");
  assert.match(html, /Not quite/, "wrong-attempt copy must render");
});

/* --------------------------------------------------------------------- *
 * Part 3 — sentence_builder shell SSR
 * --------------------------------------------------------------------- *
 * The builder shows two zones: the assembled line on top + a token
 * pool below. We mirror the shell to pin the markup shape. */

function InlineBuilder({ picked, candidates, assembled }) {
  return createElement(
    "div",
    { className: "lang-exercise lang-exercise--builder" },
    createElement("h2", { className: "lang-exercise-question" }, "Build the sentence"),
    createElement(
      "p",
      { className: "lang-exercise-builder-output", "aria-live": "polite" },
      assembled || createElement("span", { className: "lang-exercise-builder-output--empty" }, "Tap a token")
    ),
    createElement(
      "ul",
      { className: "lang-exercise-builder-pool", role: "list" },
      candidates.map((tok, idx) => {
        const used = picked.includes(idx);
        return createElement(
          "li",
          { key: idx },
          createElement(
            "button",
            {
              type: "button",
              className: `lang-exercise-builder-token${used ? " lang-exercise-builder-token--used" : ""}`,
              "aria-pressed": used
            },
            tok
          )
        );
      })
    )
  );
}

test("sentence_builder shell renders the output + token pool", () => {
  const html = renderToStaticMarkup(
    createElement(InlineBuilder, {
      picked: [2, 0],
      candidates: ["Hola", "gracias", "mundo"],
      assembled: "mundo Hola"
    })
  );
  assert.match(html, /lang-exercise-builder-output/, "output area must render");
  assert.doesNotMatch(html, /lang-exercise-builder-output--empty/, "empty placeholder must NOT render when assembled is set");
  assert.match(html, /mundo Hola/, "assembled text must render verbatim");
  assert.match(html, /role="list"/, "token pool must be a list");
  assert.match(html, /aria-pressed="true"[^>]*>mundo</, "picked tokens must surface aria-pressed=true");
  assert.match(html, /lang-exercise-builder-token--used/, "picked tokens must carry the --used modifier");
});

test("sentence_builder shell shows the empty placeholder when nothing is picked", () => {
  const html = renderToStaticMarkup(
    createElement(InlineBuilder, {
      picked: [],
      candidates: ["a", "b"],
      assembled: ""
    })
  );
  assert.match(html, /lang-exercise-builder-output--empty/, "empty placeholder must render");
  assert.doesNotMatch(html, /aria-pressed="true"/, "no token should be pressed");
});

/* --------------------------------------------------------------------- *
 * Part 4 — speak_line shell SSR
 * --------------------------------------------------------------------- */

function InlineSpeak({ score, transcript }) {
  return createElement(
    "div",
    { className: "lang-exercise lang-exercise--speak" },
    createElement("h2", { className: "lang-exercise-question" }, "Say the line"),
    createElement(
      "label",
      { className: "lang-exercise-speak-score" },
      createElement("span", { className: "lang-exercise-speak-score-label" }, `Practice score: ${score}`),
      createElement("input", {
        type: "range",
        min: 0,
        max: 100,
        value: score,
        className: "lang-exercise-speak-slider"
      })
    ),
    createElement(
      "label",
      { className: "lang-exercise-speak-transcript" },
      createElement("span", { className: "lang-exercise-speak-transcript-label" }, "What you said"),
      createElement("input", {
        type: "text",
        value: transcript,
        placeholder: "Type your transcript…",
        className: "lang-exercise-speak-input"
      })
    ),
    createElement("button", { type: "button", className: "lang-exercise-submit" }, "Submit score")
  );
}

test("speak_line shell renders the score slider + transcript input + submit", () => {
  const html = renderToStaticMarkup(
    createElement(InlineSpeak, { score: 85, transcript: "hola" })
  );
  assert.match(html, /type="range"[^>]*value="85"/, "slider must carry the score value");
  assert.match(html, /type="text"[^>]*value="hola"/, "transcript input must carry the value");
  assert.match(html, /Practice score: 85/, "score label must render the value");
  assert.match(html, /lang-exercise-submit/, "Submit score button must render");
});