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
import test from "node:test";
import assert from "node:assert/strict";

const splitModule = await import("../dist/services/splitPipeline.js");
const { runStillPageJob, runAnimatePageJob, defaultDeps, pickClipSeconds, estimateClipCostUsd } = splitModule;

/* --------------------------------------------------------------------- *
 * Test fixture builders. We construct a fake Prisma that records every
 * page.update / page.findUnique so tests can assert what the processor
 * did without touching a real database.
 * --------------------------------------------------------------------- */

function makeFakePrisma(pageOverrides = {}) {
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
      page: { findUnique, update }
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
  const fakes = makeFakePrisma(overrides.page);
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

test("pickClipSeconds returns 10s for both HERO and STANDARD in Part A", () => {
  assert.equal(pickClipSeconds("HERO"), 10);
  assert.equal(pickClipSeconds("STANDARD"), 10);
});

test("estimateClipCostUsd = seconds * 5 credits/sec * $0.01", () => {
  // 10s * 5 = 50 credits * $0.01 = $0.50
  assert.equal(estimateClipCostUsd(10), 0.5);
  // 5s would be $0.25 if Part B moves STANDARD down
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