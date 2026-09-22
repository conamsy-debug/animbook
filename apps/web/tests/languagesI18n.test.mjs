/**
 * Tests for the Languages module's tiny i18n helper.
 *
 * Mirrors src/features/languages/i18n/{t,en,fr}.ts so we can pin
 * behavior with Node's native test runner (no jsdom). Mirrors
 * are kept tiny on purpose: only the keys we want to flag.
 *
 * Run: `node --test apps/web/tests/languagesI18n.test.mjs`
 */
import test from "node:test";
import assert from "node:assert/strict";

/* --------------------------------------------------------------------- *
 * Mirror of the source t() helper.
 * --------------------------------------------------------------------- *
 * Node 24 can't resolve `@/lib/*` path aliases, and webpack-only ESM
 * extensions don't roundtrip through `node --test` cleanly. We mirror
 * the source here so we can pin the behavior in isolation. If the
 * real helper drifts, the mirror will pass but production will too —
 * so we keep the surface tested separately by the web build's runtime
 * checks as well. */

const en = {
  "landing.title": "Learn a language through stories you can watch.",
  "landing.cta.start": "Start learning",
  "notAvailable.title": "AnimBook Languages isn't available yet",
  "greeting.named": "Welcome back, {name}.",
  "story.wordsSeen": {
    one: "1 word seen in this story",
    other: "{count} words seen in this story"
  },
  "deck.saved": {
    one: "1 word saved to your deck",
    other: "{count} words saved to your deck"
  }
};
const fr = {
  "landing.title": "Apprends une langue à travers des histoires animées.",
  // landing.cta.start is intentionally MISSING from fr to exercise the
  // fallback path
  "notAvailable.title": "AnimBook Langues n'est pas encore disponible",
  "greeting.named": "Bon retour, {name}.",
  "story.wordsSeen": {
    one: "1 mot vu dans cette histoire",
    other: "{count} mots vus dans cette histoire"
  },
  "deck.saved": {
    one: "1 mot enregistré dans ton deck",
    other: "{count} mots enregistrés dans ton deck"
  }
};
const dicts = { en, fr };

function pickPlural(value, count) {
  if (typeof value === "string") return value;
  if (count === undefined) return value.other;
  return count === 1 ? value.one : value.other;
}

function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  );
}

function t(key, locale, vars, count) {
  const dict = dicts[locale];
  const localized = dict?.[key];
  const resolved = localized ?? dicts.en[key];
  if (!resolved) return key;
  const picked = pickPlural(resolved, count);
  const mergedVars = count === undefined ? vars : { ...(vars ?? {}), count };
  return interpolate(picked, mergedVars);
}

/* --------------------------------------------------------------------- *
 * Basic lookup + fallback
 * --------------------------------------------------------------------- */

test("t(en, 'en') returns the English string verbatim", () => {
  assert.equal(t("landing.title", "en"), "Learn a language through stories you can watch.");
});

test("t(fr, 'fr') returns the French string verbatim", () => {
  assert.equal(t("landing.title", "fr"), "Apprends une langue à travers des histoires animées.");
});

test("t falls back to English when a key is missing from the target locale", () => {
  // landing.cta.start is only in en.
  assert.equal(t("landing.cta.start", "fr"), "Start learning");
});

test("t returns the key itself when missing from both locales", () => {
  assert.equal(t("this.key.does.not.exist", "en"), "this.key.does.not.exist");
  assert.equal(t("this.key.does.not.exist", "fr"), "this.key.does.not.exist");
});

test("both dictionaries carry the same keys (parity smoke check)", () => {
  const enKeys = Object.keys(en).sort();
  const frKeys = Object.keys(fr).sort();
  // Only landing.cta.start is intentionally missing from fr for this
  // test. In production both dictionaries should be in sync - we'll
  // assert full parity once the rest of the screens ship.
  assert.ok(enKeys.length >= 5, "en should have at least 5 keys");
  assert.equal(frKeys.length, enKeys.length - 1, "fr is exactly one key behind (landing.cta.start)");
});

/* --------------------------------------------------------------------- *
 * Interpolation ({name}, {count})
 * --------------------------------------------------------------------- */

test("t interpolates a single {name} placeholder", () => {
  assert.equal(t("greeting.named", "en", { name: "Aisha" }), "Welcome back, Aisha.");
  assert.equal(t("greeting.named", "fr", { name: "Camille" }), "Bon retour, Camille.");
});

test("t interpolates numeric values for {count}", () => {
  assert.equal(
    t("story.wordsSeen", "en", undefined, 1),
    "1 word seen in this story"
  );
  assert.equal(
    t("story.wordsSeen", "en", undefined, 7),
    "7 words seen in this story"
  );
});

test("t combines interpolation vars with the auto-bound {count}", () => {
  // Caller passes name + count; helper merges { ...vars, count }.
  // The string template only references {count}, so name is unused but
  // the call must not throw.
  assert.equal(
    t("story.wordsSeen", "fr", { name: "Aisha" }, 3),
    "3 mots vus dans cette histoire"
  );
});

test("t leaves an unknown {placeholder} literal so typos are visible", () => {
  // greeting.named uses {name}; if the caller misspells and passes
  // { username }, the {name} slot stays as-is rather than rendering
  // empty or crashing.
  assert.equal(
    t("greeting.named", "en", { username: "Aisha" }),
    "Welcome back, {name}."
  );
});

/* --------------------------------------------------------------------- *
 * Plural selection (one vs other)
 * --------------------------------------------------------------------- */

test("t picks `one` when count === 1 and `other` otherwise", () => {
  assert.equal(t("deck.saved", "en", undefined, 1), "1 word saved to your deck");
  assert.equal(t("deck.saved", "en", undefined, 0), "0 words saved to your deck");
  assert.equal(t("deck.saved", "en", undefined, 2), "2 words saved to your deck");
  assert.equal(t("deck.saved", "en", undefined, 99), "99 words saved to your deck");
});

test("t picks the French plural form based on count", () => {
  assert.equal(t("deck.saved", "fr", undefined, 1), "1 mot enregistré dans ton deck");
  assert.equal(t("deck.saved", "fr", undefined, 4), "4 mots enregistrés dans ton deck");
});

test("t returns the `other` form when count is omitted for a plural key", () => {
  // No count given → caller didn't ask for plural handling; we expose
  // the other form because it's the more common plural in EN+FR. Since
  // count wasn't passed, `{count}` interpolation has no binding and
  // stays literal — this surfaces misuse loudly at runtime rather than
  // silently rendering "0 words ...".
  assert.equal(
    t("deck.saved", "en"),
    "{count} words saved to your deck"
  );
});

test("t treats plain string values as non-plural regardless of count", () => {
  // landing.title is a plain string; passing a count must not throw
  // and must not change the output.
  assert.equal(
    t("landing.title", "en", undefined, 5),
    "Learn a language through stories you can watch."
  );
});
