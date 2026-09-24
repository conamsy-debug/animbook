/**
 * AnimBook Languages — FSRS spaced repetition (Patch 09).
 *
 * Spec § 10 + § 11. Wraps the `ts-fsrs` package so the rest of the
 * codebase never imports it directly. The wrapping layer does two
 * things the package doesn't:
 *
 *   1. Wire our DB's `user_vocab` columns (snake_case + nullable +
 *      string state) into ts-fsrs's `Card` shape (camelCase + numeric
 *      state + numeric enum).
 *   2. Compute the rating BEFORE the DB write so the route can stash
 *      the next `due`, `stability`, `difficulty`, etc. in the JSON
 *      `meta` column on the `review_logs` row (Patch 12's admin screen
 *      reads it back).
 *
 * Pure functions only — no Prisma, no I/O. The route calls these
 * then writes the result.
 *
 * Rating convention (spec § 7.5 + § 10):
 *   1 = Again (FSRS Rating.Again)
 *   2 = Hard  (FSRS Rating.Hard)
 *   3 = Good  (FSRS Rating.Good)
 *   4 = Easy  (FSRS Rating.Easy)
 */
import { fsrs, generatorParameters, type Card, State, Rating } from "ts-fsrs";

/** Card state names we store as strings in `user_vocab.state`. */
export type CardState = "new" | "learning" | "review" | "relearning";

/** Numeric rating our routes + tests pass around. */
export type CardRating = 1 | 2 | 3 | 4;

/** Snapshot of a user_vocab row at the moment of review. The route
 *  queries this + the lexeme data, then calls `rateCard()` to get the
 *  next state. */
export interface CardSnapshot {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: CardState;
  lastReview: Date | null;
}

/** Return shape of `rateCard()` — the new row values + the FSRS log
 *  payload the route stores in `review_logs.meta`. */
export interface RateCardResult {
  card: CardSnapshot;
  log: ReviewLogMeta;
}

/** What we persist into `review_logs.meta`. ts-fsrs's ReviewLog type
 *  carries two deprecated fields (`elapsed_days`, `last_elapsed_days`)
 *  we strip before serialising so the JSON stays clean for Patch 12. */
export interface ReviewLogMeta {
  rating: CardRating;
  state: CardState;
  due: string;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  review: string;
}

/* --------------------------------------------------------------------- *
 * Helpers
 * --------------------------------------------------------------------- */

/** Convert our string state into ts-fsrs's numeric enum. The mapping
 *  matches the docstring above; an unknown value (corrupt row, old
 *  schema) falls back to `State.New` so the card stays reviewable. */
function stateToEnum(state: CardState): State {
  switch (state) {
    case "new":
      return State.New;
    case "learning":
      return State.Learning;
    case "review":
      return State.Review;
    case "relearning":
      return State.Relearning;
    default:
      return State.New;
  }
}

/** Inverse — back to a string for the DB. */
function enumToState(state: State): CardState {
  switch (state) {
    case State.New:
      return "new";
    case State.Learning:
      return "learning";
    case State.Review:
      return "review";
    case State.Relearning:
      return "relearning";
    default:
      return "new";
  }
}

/** Map our 1..4 rating into ts-fsrs's enum. Throws on invalid input
 *  so the caller surfaces a 400 — not a 500 from deep in the lib. */
function ratingToEnum(rating: CardRating): Rating {
  switch (rating) {
    case 1:
      return Rating.Again;
    case 2:
      return Rating.Hard;
    case 3:
      return Rating.Good;
    case 4:
      return Rating.Easy;
    default:
      throw new Error(`Invalid rating: ${rating}. Expected 1..4.`);
  }
}

/** Build a ts-fsrs `Card` from our DB snapshot. The card's
 *  `learning_steps` field is a step INDEX (number), not the schedule
 *  itself — the scheduler reads the steps array from its own params
 *  (`["1m", "10m"]` default). We always pass `0` here because we
 *  never persist the step index in our DB; ts-fsrs treats a missing
 *  or zero index as "fresh / first step". The review routine
 *  advances the index internally as the card walks the steps. */
function snapshotToCard(snap: CardSnapshot): Card {
  return {
    due: snap.due,
    stability: snap.stability,
    difficulty: snap.difficulty,
    elapsed_days: snap.elapsedDays,
    scheduled_days: snap.scheduledDays,
    reps: snap.reps,
    lapses: snap.lapses,
    state: stateToEnum(snap.state),
    last_review: snap.lastReview ?? undefined,
    learning_steps: 0
  } as unknown as Card;
}

/** Convert the new ts-fsrs Card back into our DB snapshot. ts-fsrs
 *  mutates `learning_steps` to reflect the position in the learning
 *  sequence — we don't persist that field (the spec only carries the
 *  9 FSRS-5 fields: due, stability, difficulty, elapsed_days,
 *  scheduled_days, reps, lapses, state, last_review), so we drop it
 *  here. */
function cardToSnapshot(card: Card): CardSnapshot {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: enumToState(card.state),
    lastReview: card.last_review ?? null
  };
}

/** Strip ts-fsrs's deprecated fields so the JSON we write to
 *  `review_logs.meta` stays forward-compatible. ts-fsrs sometimes
 *  returns `card.due` as a number (epoch ms) — coerce to a Date so
 *  the route's `toISOString()` doesn't blow up on a wall-clock
 *  review far in the future. */
function logToMeta(
  rating: CardRating,
  reviewedAt: Date,
  card: Card
): ReviewLogMeta {
  const dueDate =
    card.due instanceof Date
      ? card.due
      : new Date(card.due as unknown as number | string);
  return {
    rating,
    state: enumToState(card.state),
    due: dueDate.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
    review: reviewedAt.toISOString()
  };
}

/* --------------------------------------------------------------------- *
 * Scheduler instance
 * --------------------------------------------------------------------- *
 * We reuse a single scheduler across requests so the PRNG seeds
 * don't differ between calls. ts-fsrs's `fsrs()` factory is cheap
 * but instantiating per-request makes tests harder to reason about.
 *
 * `learning_steps: []` disables ts-fsrs's short-term learning
 * sequence (the [1m, 10m] default). We don't carry the step index
 * in our DB — if we kept the default, a card would stay in learning
 * until the learner hit step 1 and the next Good, which requires
 * us to persist the step index per review. Spec § 4 only persists
 * the 9 FSRS-5 fields, so a fresh step index on every replay
 * leaves the card stuck in learning forever. Empty learning_steps
 * hands control of the schedule to FSRS, which graduates a card on
 * the first review (`reps === 1`). */

const scheduler = fsrs(
  generatorParameters({ enable_fuzz: true, learning_steps: [] })
);

/* --------------------------------------------------------------------- *
 * Public API
 * --------------------------------------------------------------------- */

/** Rate a card and return the next snapshot + the log payload to
 *  persist. The caller is responsible for writing both rows in a
 *  transaction (`user_vocab` + `review_logs`). */
export function rateCard(
  snapshot: CardSnapshot,
  rating: CardRating,
  now: Date = new Date()
): RateCardResult {
  const card = snapshotToCard(snapshot);
  const grade = ratingToEnum(rating);

  // ts-fsrs returns a `{ [grade]: { card, log } }` map. We only ever
  // look up the grade the learner picked, so the other three are
  // discarded (each `repeat()` call costs ~no time but the return
  // shape is verbose).
  const result = scheduler.repeat(card, now);
  const item = result[grade];
  if (!item) {
    // Defensive: if ts-fsrs ever stops returning the picked grade,
    // surface a clean error instead of crashing the request.
    throw new Error(`ts-fsrs did not return a result for rating ${rating}`);
  }
  return {
    card: cardToSnapshot(item.card),
    log: logToMeta(rating, now, item.card)
  };
}

/** Initial snapshot for a brand-new user_vocab row (Patch 06 writes
 *  this when the learner saves a word). Centralised here so the same
 *  defaults flow into both the route's create call and any test
 *  fixtures that want to exercise the FSRS path. */
export function newCardSnapshot(now: Date = new Date()): CardSnapshot {
  return {
    due: now,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: "new",
    lastReview: null
  };
}

/** Map our string rating into the ts-fsrs enum name — useful for the
 *  i18n layer (e.g. "Again" → "pronunciation.review.again"). Exposed
 *  for tests so they don't have to import the package directly. */
export function ratingName(rating: CardRating): "Again" | "Hard" | "Good" | "Easy" {
  switch (rating) {
    case 1:
      return "Again";
    case 2:
      return "Hard";
    case 3:
      return "Good";
    case 4:
      return "Easy";
  }
}

/** Number of cards that should appear in a single review session. Spec
 *  § 10 says limit 20; we keep this as a constant so the route + the
 *  web player agree. */
export const REVIEW_BATCH_SIZE = 20;
