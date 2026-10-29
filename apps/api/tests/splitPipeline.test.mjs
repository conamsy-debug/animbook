/**
 * Unit tests for the splitPipeline processors.
 *
 * Strategy: build a `SplitDeps` with fakes for Prisma + Runway + R2 +
 * brain loader, then call `runStillPageJob` / `runAnimatePageJob`
 * synchronously. No Redis, no Bull — the dependency-injection seam on
 * the processor functions keeps it pure.
 *
 * Run with: `node --test apps/api/tests/splitPipeline.test.mjs`
 */
import "./_guard.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const splitModule = await import("../dist/services/splitPipeline.js");
const { runStillPageJob, runAnimatePageJob, defaultDeps, pickClipSeconds, estimateClipCostUsd, splitQueueName } = splitModule;

/* --------------------------------------------------------------------- *
 * Test fixture builders. We construct a fake Prisma that records every
 * page.update / page.findUnique so tests can assert what the processor
 * did without touching a real database.
 * --------------------------------------------------------------------- */

function makeFakePrisma(pageOverrides = {}, shots = []) {
  const calls = [];
  const stored = {
    id: "page-1",
    bookId: "book-1",
    pageNum: 7,
    textExcerpt: "The rabbit hopped across the meadow.",
    animationPrompt: null,
    negativePrompt: null,
    videoUrl: null,
    posterUrl: null,
    audioUrl: null,
    directionNote: null,
    stillStatus: "NONE",
    clipStatus: "NONE",
    audioStatus: "NONE",
    stillPrompt: null,
    stillVersion: 0,
    motionTier: "STANDARD",
    emotionalRegister: "calm",
    ...pageOverrides
  };
  const findUnique = async (args) => {
    calls.push({ kind: "findUnique", args });
    if (args.where?.id === stored.id) {
      return {
        ...stored,
        book: {
          styleId: "style-watercolour",
          splitPipeline: true,
          ...(stored.book ?? {})
        }
      };
    }
    return null;
  };
  const update = async (args) => {
    calls.push({ kind: "update", args });
    Object.assign(stored, args.data);
    return stored;
  };
  return {
    prisma: {
      page: { findUnique, update },
      // The shot path: one clip per shot row, plus the character bible the
      // reference image is generated from.
      shot: {
        findMany: async (args) => {
          calls.push({ kind: "shot.findMany", args });
          return shots;
        },
        update: async (args) => {
          calls.push({ kind: "shot.update", args });
          return args.data;
        }
      },
      shotCharacter: {
        findMany: async () => [],
        update: async () => ({})
      }
    },
    calls,
    stored
  };
}

const fakeBrain = {
  style_recommendation: "watercolour",
  characters: [],
  page_manifest: [
    {
      page_num: 7,
      animation_prompt_draft: "A rabbit hops across a sunlit meadow.",
      primary_action: "rabbit hopping",
      emotion: "playful",
      characters_present: []
    }
  ]
};

function makeDeps(overrides = {}) {
  const fakes = makeFakePrisma(overrides.page ?? {}, overrides.shots ?? []);
  const deps = {
    ...fakes.prisma ? { prisma: fakes.prisma } : {},
    generateStill: async () => "https://runway.example/still.png",
    animateStill: async () => "https://runway.example/clip.mp4",
    mirrorToR2: async (_src, key) => ({ url: `https://media.animbook.com/${key}` }),
    loadBrain: async () => fakeBrain,
    stylePrompt: (_style, rec) => rec ?? "default-style",
    safePrompt: (p) => p,
    move: async (field, _id, to) => {
      fakes.stored[field] = to;
    },
    ...overrides.deps
  };
  return { deps, calls: fakes.calls, stored: fakes.stored };
}

const data = { projectId: "proj-1", pageId: "page-1", stillVersion: 1 };

/* --------------------------------------------------------------------- *
 * pickClipSeconds + estimateClipCostUsd
 * --------------------------------------------------------------------- */

test("pickClipSeconds: HERO -> 10s, STANDARD -> 5s (Part B)", () => {
  // Part B: STANDARD is the default 5s clip; HERO is the 10s longer
  // treatment for real action / key beats.
  assert.equal(pickClipSeconds("HERO"), 10);
  assert.equal(pickClipSeconds("STANDARD"), 5);
});

test("estimateClipCostUsd = seconds * 5 credits/sec * $0.01", () => {
  // 10s * 5 = 50 credits * $0.01 = $0.50
  assert.equal(estimateClipCostUsd(10), 0.5);
  // 5s * 5 = 25 credits * $0.01 = $0.25 (Part B default)
  assert.equal(estimateClipCostUsd(5), 0.25);
});

/* --------------------------------------------------------------------- *
 * STILL_PAGE
 * --------------------------------------------------------------------- */

test("STILL_PAGE: NONE -> GENERATING -> READY on success", async () => {
  const { deps, calls, stored } = makeDeps({ page: { stillStatus: "NONE" } });
  await runStillPageJob(data, 1, 1, deps);
  assert.equal(stored.stillStatus, "READY");
  assert.ok(stored.posterUrl && stored.posterUrl.includes("p7"), `posterUrl should contain page number, got ${stored.posterUrl}`);
  assert.ok(typeof stored.stillPrompt === "string" && stored.stillPrompt.length > 0);
  // Should have moved to GENERATING first, then to READY via the page update.
  const finalUpdate = calls.filter((c) => c.kind === "update").slice(-1)[0];
  assert.equal(finalUpdate.args.data.stillStatus, "READY");
});

test("STILL_PAGE: stillVersion already exists on page; prompt + posterUrl set", async () => {
  const { deps, stored } = makeDeps({ page: { stillStatus: "NONE", stillVersion: 3 } });
  await runStillPageJob(data, 1, 1, deps);
  assert.equal(stored.stillStatus, "READY");
  assert.ok(stored.posterUrl);
  assert.ok(stored.stillPrompt);
});

test("STILL_PAGE: throws on still failure, doesn't mark FAILED on attempt < max", async () => {
  const { deps, stored } = makeDeps({
    page: { stillStatus: "NONE" },
    deps: {
      generateStill: async () => { throw new Error("Runway classifier rejected"); }
    }
  });
  await assert.rejects(
    () => runStillPageJob(data, 1, 2, deps),
    /Runway classifier rejected/
  );
  // No FAILED on attempt 1 of 2 — Bull will retry.
  assert.notEqual(stored.stillStatus, "FAILED");
});

test("STILL_PAGE: marks FAILED only on the last attempt, then rethrows", async () => {
  const { deps, stored } = makeDeps({
    page: { stillStatus: "NONE" },
    deps: {
      generateStill: async () => { throw new Error("Runway classifier rejected"); }
    }
  });
  await assert.rejects(
    () => runStillPageJob(data, 2, 2, deps),
    /Runway classifier rejected/
  );
  assert.equal(stored.stillStatus, "FAILED");
});

test("STILL_PAGE: book is no longer splitPipeline -> silent drop, no Runway call", async () => {
  let runwayCalled = false;
  const { deps, stored } = makeDeps({
    page: { stillStatus: "NONE" },
    deps: {
      generateStill: async () => { runwayCalled = true; return "x"; },
      prisma: {
        page: {
          findUnique: async () => ({
            id: "page-1",
            pageNum: 7,
            textExcerpt: "x",
            animationPrompt: null,
            motionTier: "STANDARD",
            book: { styleId: null, splitPipeline: false }
          }),
          update: async () => null
        }
      }
    }
  });
  await runStillPageJob(data, 1, 1, deps);
  assert.equal(runwayCalled, false);
  assert.notEqual(stored.stillStatus, "READY");
});

/* --------------------------------------------------------------------- *
 * ANIMATE_PAGE
 * --------------------------------------------------------------------- */

test("ANIMATE_PAGE: hard gate — stillStatus != APPROVED -> STALE, no Runway call", async () => {
  let runwayCalled = false;
  let animateCalled = false;
  const { deps, stored } = makeDeps({
    page: { stillStatus: "READY" }, // not approved yet
    deps: {
      animateStill: async () => { animateCalled = true; return "x"; },
      generateStill: async () => { runwayCalled = true; return "x"; }
    }
  });
  await runAnimatePageJob(data, 1, 1, deps);
  assert.equal(stored.clipStatus, "STALE");
  assert.equal(animateCalled, false);
  assert.equal(runwayCalled, false);
});

test("ANIMATE_PAGE: APPROVED + posterUrl -> GENERATING -> READY", async () => {
  const { deps, stored, calls } = makeDeps({
    page: {
      stillStatus: "APPROVED",
      posterUrl: "https://media.animbook.com/studio/proj-1/p7.png"
    }
  });
  await runAnimatePageJob(data, 1, 1, deps);
  assert.equal(stored.clipStatus, "READY");
  assert.ok(stored.videoUrl && stored.videoUrl.includes("p7"));
  assert.equal(stored.qualityScore, 0.85);
  // Final update must mark READY.
  const finalUpdate = calls.filter((c) => c.kind === "update").slice(-1)[0];
  assert.equal(finalUpdate.args.data.clipStatus, "READY");
});

test("ANIMATE_PAGE: a page with shot rows renders one clip per shot", async () => {
  const stills = [];
  const clips = [];
  const { deps, stored, calls } = makeDeps({
    page: {
      stillStatus: "APPROVED",
      posterUrl: "https://media.animbook.com/studio/proj-1/p7.png"
    },
    shots: [
      {
        id: "shot-0",
        order: 0,
        shotPrompt: "Exactly one woman in frame. Her right hand comes forward.",
        stillPrompt: "Exactly one woman in frame. She stands with her hands behind her back.",
        durationSeconds: 6,
        charactersInFrame: []
      },
      {
        id: "shot-1",
        order: 1,
        shotPrompt: "Exactly one woman in frame. Her hand lowers back to her side.",
        stillPrompt: "Exactly one woman in frame. Her hand is raised, pointing at a boat.",
        durationSeconds: 6,
        charactersInFrame: []
      }
    ],
    deps: {
      generateStill: async (prompt) => {
        stills.push(prompt);
        return "https://minimax.example/still.png";
      },
      animateStill: async (_still, motion) => {
        clips.push(motion);
        return "https://minimax.example/clip.mp4";
      }
    }
  });

  await runAnimatePageJob(data, 1, 1, deps);

  // One first-frame still and one clip per shot.
  assert.equal(stills.length, 2);
  assert.equal(clips.length, 2);
  assert.match(stills[0], /hands behind her back/);
  assert.match(clips[1], /lowers back to her side/);

  // Both shot rows are marked READY with their own clip.
  const shotUpdates = calls.filter((c) => c.kind === "shot.update");
  assert.equal(shotUpdates.length, 2);
  for (const update of shotUpdates) {
    assert.equal(update.args.data.status, "READY");
    assert.equal(update.args.data.provider, "minimax");
    assert.ok(update.args.data.videoUrl.includes("/shots/"));
    assert.ok(update.args.data.posterUrl.includes("/shots/"));
  }

  // The page's own clipStatus is still the single-clip status, so the old
  // fallback keeps working for a reader whose page has no playable shot.
  assert.equal(stored.clipStatus, "READY");
});

test("ANIMATE_PAGE: throw on attempt < max -> rethrows, doesn't mark FAILED", async () => {
  const { deps, stored } = makeDeps({
    page: {
      stillStatus: "APPROVED",
      posterUrl: "https://media.animbook.com/p7.png"
    },
    deps: {
      animateStill: async () => { throw new Error("Runway image_to_video failed"); }
    }
  });
  await assert.rejects(
    () => runAnimatePageJob(data, 1, 2, deps),
    /image_to_video failed/
  );
  assert.notEqual(stored.clipStatus, "FAILED");
});

test("ANIMATE_PAGE: throw on every attempt -> FAILED on last attempt, rethrows", async () => {
  const { deps, stored } = makeDeps({
    page: {
      stillStatus: "APPROVED",
      posterUrl: "https://media.animbook.com/p7.png"
    },
    deps: {
      animateStill: async () => { throw new Error("Runway image_to_video failed"); }
    }
  });
  await assert.rejects(
    () => runAnimatePageJob(data, 2, 2, deps),
    /image_to_video failed/
  );
  assert.equal(stored.clipStatus, "FAILED");
});

test("ANIMATE_PAGE: APPROVED still but posterUrl missing -> STALE (no Runway call)", async () => {
  let animateCalled = false;
  const { deps, stored } = makeDeps({
    page: {
      stillStatus: "APPROVED",
      posterUrl: null
    },
    deps: {
      animateStill: async () => { animateCalled = true; return "x"; }
    }
  });
  await runAnimatePageJob(data, 1, 1, deps);
  assert.equal(stored.clipStatus, "STALE");
  assert.equal(animateCalled, false);
});

test("ANIMATE_PAGE: book is no longer splitPipeline -> silent drop", async () => {
  let animateCalled = false;
  const { deps, stored } = makeDeps({
    page: { stillStatus: "APPROVED", posterUrl: "https://x" },
    deps: {
      animateStill: async () => { animateCalled = true; return "x"; },
      prisma: {
        page: {
          findUnique: async () => ({
            id: "page-1",
            pageNum: 7,
            textExcerpt: "x",
            animationPrompt: null,
            motionTier: "STANDARD",
            stillStatus: "APPROVED",
            posterUrl: "https://x",
            emotionalRegister: "calm",
            book: { styleId: null, splitPipeline: false }
          }),
          update: async () => null
        }
      }
    }
  });
  await runAnimatePageJob(data, 1, 1, deps);
  assert.equal(animateCalled, false);
  assert.notEqual(stored.clipStatus, "READY");
});

/* --------------------------------------------------------------------- *
 * Sanity: defaultDeps() exposes the real Prisma / Runway / R2 helpers,
 * but we don't exercise it here (that would need Redis + Bull + the live
 * services). The test just checks it returns an object with the expected
 * keys so the live worker wires up cleanly.
 * --------------------------------------------------------------------- */

test("defaultDeps returns an object with every SplitDeps key", () => {
  const deps = defaultDeps();
  assert.ok(deps.prisma, "prisma");
  assert.equal(typeof deps.generateStill, "function");
  assert.equal(typeof deps.animateStill, "function");
  assert.equal(typeof deps.mirrorToR2, "function");
  assert.equal(typeof deps.loadBrain, "function");
  assert.equal(typeof deps.stylePrompt, "function");
  assert.equal(typeof deps.safePrompt, "function");
  assert.equal(typeof deps.move, "function");
});

/* --------------------------------------------------------------------- *
 * The still job and the animate job run on DIFFERENT queues.
 *
 * BullMQ hands a waiting job to whichever worker asks for it first, so two
 * workers on one queue race for each other's jobs. A worker that "ignores" a
 * job it picked up still lets BullMQ mark it complete and remove it - the
 * clip is then never rendered and nothing says so. One queue per job type
 * removes the race, and this test is what stops it coming back.
 * --------------------------------------------------------------------- */

test("the still job and the animate job run on different queues", () => {
  const still = splitQueueName("STILL_PAGE");
  const animate = splitQueueName("ANIMATE_PAGE");
  assert.ok(still, "the still job has a queue");
  assert.ok(animate, "the animate job has a queue");
  assert.notEqual(still, animate, "the two job types must not share a queue");
});

test("the queue routing is stable", () => {
  assert.equal(splitQueueName("STILL_PAGE"), "animbook-split-still");
  assert.equal(splitQueueName("ANIMATE_PAGE"), "animbook-split-animate");
});