/**
 * Unit tests for the pageState state-machine helpers.
 *
 * The transition tables (`STILL_NEXT`, `CLIP_NEXT`) are pure data — easy to
 * test by importing the compiled module. The `move()` / `moveMany()`
 * helpers take a Prisma client as their last argument so unit tests can
 * pass a fake without needing module-level mocking (Node 24's
 * `mock.module` is still unstable). The live pipeline just omits the arg
 * and gets the real client.
 *
 * Run with: `node --test apps/api/tests/pageState.test.mjs`
 */
import test from "node:test";
import assert from "node:assert/strict";

/* --------------------------------------------------------------------- *
 * Pure-data tests for the transition tables. These don't need a Prisma
 * mock; we just import the constants directly.
 * --------------------------------------------------------------------- */

test("STILL_NEXT: NONE -> GENERATING only", async () => {
  const { STILL_NEXT } = await import("../dist/services/pageState.js");
  assert.deepEqual([...STILL_NEXT.NONE], ["GENERATING"]);
});

test("STILL_NEXT: GENERATING -> READY | FAILED", async () => {
  const { STILL_NEXT } = await import("../dist/services/pageState.js");
  assert.deepEqual([...STILL_NEXT.GENERATING].sort(), ["FAILED", "READY"]);
});

test("STILL_NEXT: READY -> APPROVED | GENERATING (regenerate)", async () => {
  const { STILL_NEXT } = await import("../dist/services/pageState.js");
  assert.deepEqual([...STILL_NEXT.READY].sort(), ["APPROVED", "GENERATING"]);
});

test("STILL_NEXT: APPROVED -> GENERATING (reopen)", async () => {
  const { STILL_NEXT } = await import("../dist/services/pageState.js");
  assert.deepEqual([...STILL_NEXT.APPROVED], ["GENERATING"]);
});

test("STILL_NEXT: FAILED -> GENERATING", async () => {
  const { STILL_NEXT } = await import("../dist/services/pageState.js");
  assert.deepEqual([...STILL_NEXT.FAILED], ["GENERATING"]);
});

test("CLIP_NEXT: NONE -> QUEUED only", async () => {
  const { CLIP_NEXT } = await import("../dist/services/pageState.js");
  assert.deepEqual([...CLIP_NEXT.NONE], ["QUEUED"]);
});

test("CLIP_NEXT: READY -> APPROVED | FLAGGED | QUEUED | STALE", async () => {
  const { CLIP_NEXT } = await import("../dist/services/pageState.js");
  assert.deepEqual([...CLIP_NEXT.READY].sort(), ["APPROVED", "FLAGGED", "QUEUED", "STALE"]);
});

test("CLIP_NEXT: STALE -> QUEUED only", async () => {
  const { CLIP_NEXT } = await import("../dist/services/pageState.js");
  assert.deepEqual([...CLIP_NEXT.STALE], ["QUEUED"]);
});

test("CLIP_NEXT: APPROVED -> QUEUED | STALE (no back to FAILED)", async () => {
  const { CLIP_NEXT } = await import("../dist/services/pageState.js");
  assert.deepEqual([...CLIP_NEXT.APPROVED].sort(), ["QUEUED", "STALE"]);
});

/* --------------------------------------------------------------------- *
 * Fake Prisma client. Tracks every updateMany / findMany call so tests
 * can assert the WHERE IN guard. The `currentStill` / `currentClip`
 * flags simulate "the page is currently in this state"; the WHERE IN
 * guard only "succeeds" when the asked-for source state matches.
 * --------------------------------------------------------------------- */

function makeFakePrisma(currentStill, currentClip) {
  return {
    page: {
      updateMany: async (args) => {
        const where = args.where;
        const allowed =
          where?.stillStatus?.in?.includes(currentStill) ||
          where?.clipStatus?.in?.includes(currentClip);
        return { count: allowed ? 1 : 0 };
      },
      findMany: async (args) => {
        const where = args.where;
        const allowed =
          where?.stillStatus?.in?.includes(currentStill) ||
          where?.clipStatus?.in?.includes(currentClip);
        return allowed ? [{ id: "page-1" }, { id: "page-2" }] : [];
      }
    }
  };
}

test("move: stillStatus NONE -> GENERATING works", async () => {
  const { move } = await import("../dist/services/pageState.js");
  const db = makeFakePrisma("NONE", "NONE");
  await move("stillStatus", "page-1", "GENERATING", db);
});

test("move: stillStatus READY -> APPROVED works", async () => {
  const { move } = await import("../dist/services/pageState.js");
  const db = makeFakePrisma("READY", "NONE");
  await move("stillStatus", "page-1", "APPROVED", db);
});

test("move: stillStatus READY -> QUEUED throws (illegal transition)", async () => {
  const { move, IllegalTransitionError } = await import("../dist/services/pageState.js");
  const db = makeFakePrisma("READY", "NONE");
  await assert.rejects(
    () => move("stillStatus", "page-1", "QUEUED", db),
    (err) => err instanceof IllegalTransitionError && err.to === "QUEUED"
  );
});

test("move: lost race — current state is NONE but caller wants READY -> APPROVED", async () => {
  // Page is in NONE; the caller's first attempt was GENERATING and the
  // update won, so by the time the second move() runs the page is in
  // NONE again (worker restarted). The helper must throw.
  const { move, IllegalTransitionError } = await import("../dist/services/pageState.js");
  const db = makeFakePrisma("NONE", "NONE");
  await assert.rejects(
    () => move("stillStatus", "page-1", "APPROVED", db),
    (err) => err instanceof IllegalTransitionError
  );
});

test("move: clipStatus READY -> STALE works (still was regenerated)", async () => {
  const { move } = await import("../dist/services/pageState.js");
  const db = makeFakePrisma("APPROVED", "READY");
  await move("clipStatus", "page-1", "STALE", db);
});

test("move: clipStatus APPROVED -> FAILED throws (illegal; APPROVED only -> QUEUED | STALE)", async () => {
  const { move, IllegalTransitionError } = await import("../dist/services/pageState.js");
  const db = makeFakePrisma("APPROVED", "APPROVED");
  await assert.rejects(
    () => move("clipStatus", "page-1", "FAILED", db),
    (err) => err instanceof IllegalTransitionError
  );
});

test("moveMany: returns the page ids that actually transitioned", async () => {
  const { moveMany } = await import("../dist/services/pageState.js");
  const db = makeFakePrisma("NONE", "NONE");
  const winners = await moveMany("stillStatus", ["page-1", "page-2"], "GENERATING", db);
  assert.deepEqual(winners.sort(), ["page-1", "page-2"]);
});

test("moveMany: returns [] when no page is in an allowed source state", async () => {
  // QUEUED is a ClipStatus target, never a valid StillStatus transition.
  // No source state is allowed to move to it, so moveMany returns [] without
  // even touching the db.
  const { moveMany } = await import("../dist/services/pageState.js");
  let called = false;
  const db = {
    page: {
      updateMany: async () => {
        called = true;
        return { count: 0 };
      },
      findMany: async () => {
        called = true;
        return [];
      }
    }
  };
  const winners = await moveMany("stillStatus", ["page-1", "page-2"], "QUEUED", db);
  assert.deepEqual(winners, []);
  assert.equal(called, false, "illegal target must short-circuit before db call");
});

test("moveMany: short-circuits empty input without calling the db", async () => {
  const { moveMany } = await import("../dist/services/pageState.js");
  let called = false;
  const db = {
    page: {
      updateMany: async () => {
        called = true;
        return { count: 0 };
      },
      findMany: async () => {
        called = true;
        return [];
      }
    }
  };
  const winners = await moveMany("stillStatus", [], "GENERATING", db);
  assert.deepEqual(winners, []);
  assert.equal(called, false, "empty input must not hit the db");
});