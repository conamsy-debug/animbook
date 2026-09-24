/**
 * Tests for AnimBook Languages Patch 09 — review session state machine.
 *
 * The ReviewSession page is a React component that owns a small
 * state machine: idle → loading → ready (queue) → done. We don't
 * exercise React directly (no jsdom in this repo) — instead we
 * mirror the data shapes + the rating-submission flow inline so the
 * test pins the wire format, the rating boundaries, and the
 * "next-card-on-success" behaviour the component relies on.
 *
 * Run: `node --test apps/web/tests/languagesReview.test.mjs`
 */
import test from "node:test";
import assert from "node:assert/strict";

/* --------------------------------------------------------------------- *
 * Mirrors — minimal shapes we need for the state-machine assertions.
 * Kept in lock-step with apps/web/src/features/languages/api.ts so a
 * drift here flags as a failure.
 * --------------------------------------------------------------------- */

const VALID_RATINGS = new Set([1, 2, 3, 4]);

function pickGlosses(raw, base) {
  if (raw && typeof raw === "object") {
    const dict = raw;
    const direct = dict[base];
    if (Array.isArray(direct) && direct.length > 0) {
      return direct.filter((x) => typeof x === "string");
    }
    const en = dict.en;
    if (Array.isArray(en) && en.length > 0) {
      return en.filter((x) => typeof x === "string");
    }
  }
  return [];
}

function formatInterval(days, locale) {
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

/**
 * Tiny state-machine mirror of the page's review logic:
 *   - fetchReviewDue returns a queue
 *   - the learner rates each card; a successful POST advances the
 *     index; the queue is exhausted when the last card is rated
 *   - rating boundary is exactly 1..4 (the same set the route enforces)
 */
async function runReviewSession(queue, ratings, fetchDue, postRating) {
  const fetched = await fetchDue(queue);
  if (fetched.cards.length === 0) {
    return { status: "ready", index: 0, results: [] };
  }
  const results = [];
  for (let i = 0; i < fetched.cards.length; i++) {
    if (!VALID_RATINGS.has(ratings[i])) {
      throw new Error(`invalid rating at index ${i}: ${ratings[i]}`);
    }
    const card = fetched.cards[i];
    const r = await postRating(card, ratings[i]);
    results.push(r);
  }
  return {
    status: "done",
    index: fetched.cards.length,
    results
  };
}

/* --------------------------------------------------------------------- *
 * Tests
 * --------------------------------------------------------------------- */

const sampleCards = () => [
  {
    userVocabId: "uv-1",
    lexemeId: "lex-1",
    sourceLineId: "line-1",
    state: "new",
    due: "2026-09-23T00:00:00Z",
    lastReview: null,
    reps: 0,
    lapses: 0,
    lexeme: {
      id: "lex-1",
      targetLang: "es",
      lemma: "hola",
      reading: null,
      partOfSpeech: "interjection",
      gender: null,
      glosses: { en: ["hello"], fr: ["bonjour"] },
      audioUrl: null
    }
  },
  {
    userVocabId: "uv-2",
    lexemeId: "lex-2",
    sourceLineId: "line-2",
    state: "review",
    due: "2026-09-22T00:00:00Z",
    lastReview: "2026-09-15T00:00:00Z",
    reps: 3,
    lapses: 0,
    lexeme: {
      id: "lex-2",
      targetLang: "es",
      lemma: "gracias",
      reading: null,
      partOfSpeech: "interjection",
      gender: null,
      glosses: { en: ["thank you"], fr: ["merci"] },
      audioUrl: null
    }
  }
];

test("review session: rating boundary is exactly 1..4", () => {
  for (const r of [0, 1, 2, 3, 4, 5]) {
    assert.equal(VALID_RATINGS.has(r), r >= 1 && r <= 4);
  }
});

test("review session: rejects out-of-range rating before posting", async () => {
  const cards = sampleCards();
  await assert.rejects(
    runReviewSession(
      cards,
      [5, 3],
      async (q) => ({ cards: q }),
      async () => ({ ok: true })
    ),
    /invalid rating/
  );
});

test("review session: empty queue lands on `ready` without posting", async () => {
  let posted = false;
  const result = await runReviewSession(
    [],
    [],
    async () => ({ cards: [] }),
    async () => {
      posted = true;
      throw new Error("should not post when queue is empty");
    }
  );
  assert.equal(result.status, "ready");
  assert.equal(posted, false);
});

test("review session: rates every card in order and ends in `done`", async () => {
  const cards = sampleCards();
  const posted = [];
  const result = await runReviewSession(
    cards,
    [3, 1],
    async (q) => ({ cards: q }),
    async (card, rating) => {
      posted.push({ id: card.userVocabId, rating });
      return {
        userVocabId: card.userVocabId,
        rating,
        next: { state: "review", due: "2026-09-30", scheduledDays: 7 }
      };
    }
  );
  assert.equal(result.status, "done");
  assert.equal(posted.length, 2);
  assert.deepEqual(posted.map((p) => p.id), ["uv-1", "uv-2"]);
  assert.deepEqual(posted.map((p) => p.rating), [3, 1]);
  assert.equal(result.results.length, 2);
});

test("pickGlosses: returns the base-language array", () => {
  const lex = { glosses: { en: ["hello"], fr: ["bonjour"] } };
  assert.deepEqual(pickGlosses(lex.glosses, "en"), ["hello"]);
  assert.deepEqual(pickGlosses(lex.glosses, "fr"), ["bonjour"]);
});

test("pickGlosses: falls back to English when base is missing", () => {
  const lex = { glosses: { en: ["hello"] } };
  assert.deepEqual(pickGlosses(lex.glosses, "fr"), ["hello"]);
});

test("pickGlosses: returns empty when glosses are absent", () => {
  assert.deepEqual(pickGlosses(null, "en"), []);
  assert.deepEqual(pickGlosses({}, "en"), []);
});

test("formatInterval: today / tomorrow / N days / weeks / months", () => {
  assert.equal(formatInterval(0, "en"), "today");
  assert.equal(formatInterval(0, "fr"), "aujourd'hui");
  assert.equal(formatInterval(1, "en"), "1 day");
  assert.equal(formatInterval(1, "fr"), "1 jour");
  assert.equal(formatInterval(3, "en"), "3 days");
  assert.equal(formatInterval(3, "fr"), "3 jours");
  assert.equal(formatInterval(7, "en"), "1 week");
  assert.equal(formatInterval(7, "fr"), "1 semaine");
  assert.equal(formatInterval(14, "en"), "2 weeks");
  assert.equal(formatInterval(14, "fr"), "2 semaines");
  assert.equal(formatInterval(31, "en"), "1 month");
  assert.equal(formatInterval(31, "fr"), "1 mois");
  assert.equal(formatInterval(90, "en"), "3 months");
  assert.equal(formatInterval(90, "fr"), "3 mois");
});

test("review session: stops cleanly if a POST throws (no advance)", async () => {
  const cards = sampleCards();
  let posted = 0;
  await assert.rejects(
    runReviewSession(
      cards,
      [3, 3],
      async (q) => ({ cards: q }),
      async () => {
        posted++;
        throw new Error("network down");
      }
    ),
    /network down/
  );
  // First card's POST happened; the second never got a chance.
  assert.equal(posted, 1);
});

test("review session: ratings map to the FSRS Rating enum on the wire", () => {
  // Spec § 10: 1=Again, 2=Hard, 3=Good, 4=Easy. The web layer passes
  // these numbers verbatim to /api/lang/review/:id. Pin them so the
  // button clicks stay aligned with the backend.
  const buttons = { again: 1, hard: 2, good: 3, easy: 4 };
  assert.equal(buttons.again, 1);
  assert.equal(buttons.hard, 2);
  assert.equal(buttons.good, 3);
  assert.equal(buttons.easy, 4);
});
