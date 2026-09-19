/**
 * Unit tests for the pure helpers in releaseSchedule.ts.
 *
 * The Prisma-touching pieces (applySchedule, tickTimeReleases, reader unlock)
 * need a real DB and live in the integration tests — here we cover the chunk
 * math, which is where most of the surprising behaviour lives.
 *
 * Run with: `node --test apps/api/tests/releaseSchedule.test.mjs`
 */
import test from "node:test";
import assert from "node:assert/strict";

const MS = 24 * 60 * 60 * 1000;

test("computeChunks: 100 pages, 10% per drop, daily cadence → 10 chunks of 10", async () => {
  const { computeChunks } = await import("../dist/services/releaseSchedule.js");
  const start = new Date("2026-09-18T08:00:00Z");
  const chunks = computeChunks({ totalPages: 100, chunkPercent: 10, cadence: "DAILY", startAt: start });
  assert.equal(chunks.length, 10);
  assert.deepEqual(
    chunks.map((c) => [c.chunkIndex, c.pageStart, c.pageEnd]),
    [
      [0, 1, 10],
      [1, 11, 20],
      [2, 21, 30],
      [3, 31, 40],
      [4, 41, 50],
      [5, 51, 60],
      [6, 61, 70],
      [7, 71, 80],
      [8, 81, 90],
      [9, 91, 100]
    ]
  );
  // First chunk is at the start time; each subsequent one is +1 day.
  assert.equal(chunks[0].scheduledFor.getTime(), start.getTime());
  assert.equal(chunks[1].scheduledFor.getTime(), start.getTime() + MS);
  assert.equal(chunks[9].scheduledFor.getTime(), start.getTime() + 9 * MS);
});

test("computeChunks: 25% per drop on 10 pages → 4 chunks of 3 (last is 1)", async () => {
  const { computeChunks } = await import("../dist/services/releaseSchedule.js");
  const start = new Date("2026-09-18T08:00:00Z");
  const chunks = computeChunks({ totalPages: 10, chunkPercent: 25, cadence: "WEEKLY", startAt: start });
  // 25% of 10 = 2.5 → ceil 3. 10/3 = ceil(10/3) = 4 chunks. The last one is
  // smaller (pages 10–10).
  assert.equal(chunks.length, 4);
  assert.equal(chunks[0].pageStart, 1);
  assert.equal(chunks[0].pageEnd, 3);
  assert.equal(chunks[1].pageStart, 4);
  assert.equal(chunks[1].pageEnd, 6);
  assert.equal(chunks[2].pageStart, 7);
  assert.equal(chunks[2].pageEnd, 9);
  assert.equal(chunks[3].pageStart, 10);
  assert.equal(chunks[3].pageEnd, 10);
  // Weekly cadence → 7-day gap.
  assert.equal(chunks[1].scheduledFor.getTime(), start.getTime() + 7 * MS);
});

test("computeChunks: 1 page total → exactly 1 chunk", async () => {
  const { computeChunks } = await import("../dist/services/releaseSchedule.js");
  const chunks = computeChunks({ totalPages: 1, chunkPercent: 10, cadence: "DAILY", startAt: new Date("2026-09-18T08:00:00Z") });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].pageStart, 1);
  assert.equal(chunks[0].pageEnd, 1);
});

test("computeChunks: 0 pages → single empty chunk so the book still has rows", async () => {
  const { computeChunks } = await import("../dist/services/releaseSchedule.js");
  const chunks = computeChunks({ totalPages: 0, chunkPercent: 10, cadence: "DAILY", startAt: new Date() });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].pageStart, 1);
  assert.equal(chunks[0].pageEnd, 0);
});

test("computeChunks: monthly cadence → ~30-day spacing", async () => {
  const { computeChunks } = await import("../dist/services/releaseSchedule.js");
  const start = new Date("2026-09-18T08:00:00Z");
  // 30 pages × 25% = 8 pages per chunk → 4 chunks. We just care that the gap
  // between consecutive drops is one month (~30 days).
  const chunks = computeChunks({ totalPages: 30, chunkPercent: 25, cadence: "MONTHLY", startAt: start });
  assert.equal(chunks.length, 4);
  assert.equal(chunks[1].scheduledFor.getTime(), start.getTime() + 30 * MS);
  assert.equal(chunks[3].scheduledFor.getTime(), start.getTime() + 90 * MS);
});

test("validateSchedule: IMMEDIATE passes without cadence", async () => {
  const { validateSchedule } = await import("../dist/services/releaseSchedule.js");
  assert.doesNotThrow(() => validateSchedule({ mode: "IMMEDIATE" }, 50));
});

test("validateSchedule: TIME without cadence fails 400", async () => {
  const { validateSchedule } = await import("../dist/services/releaseSchedule.js");
  assert.throws(() => validateSchedule({ mode: "TIME", chunkPercent: 10 }, 50), (err) => {
    return (err && err.status) === 400;
  });
});

test("validateSchedule: TIME with bad chunk% fails 400", async () => {
  const { validateSchedule } = await import("../dist/services/releaseSchedule.js");
  assert.throws(() => validateSchedule({ mode: "TIME", cadence: "DAILY", chunkPercent: 33 }, 50), (err) => {
    return (err && err.status) === 400;
  });
});

test("validateSchedule: TIME with start in the past fails 400", async () => {
  const { validateSchedule } = await import("../dist/services/releaseSchedule.js");
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
  assert.throws(
    () => validateSchedule({ mode: "TIME", cadence: "DAILY", chunkPercent: 10, startAt: past }, 50),
    (err) => (err && err.status) === 400
  );
});

test("validateSchedule: TASK without prompt fails 400", async () => {
  const { validateSchedule } = await import("../dist/services/releaseSchedule.js");
  assert.throws(
    () => validateSchedule({ mode: "TASK", cadence: "DAILY", chunkPercent: 10 }, 50),
    (err) => (err && err.status) === 400
  );
});

test("validateSchedule: TASK with prompt and pages passes", async () => {
  const { validateSchedule } = await import("../dist/services/releaseSchedule.js");
  assert.doesNotThrow(() =>
    validateSchedule(
      { mode: "TASK", cadence: "DAILY", chunkPercent: 25, dailyTaskPrompt: "Write three sentences about today." },
      40
    )
  );
});

test("validateSchedule: dripped schedule with 0 pages fails 400", async () => {
  const { validateSchedule } = await import("../dist/services/releaseSchedule.js");
  assert.throws(
    () => validateSchedule({ mode: "TIME", cadence: "DAILY", chunkPercent: 10 }, 0),
    (err) => (err && err.status) === 400
  );
});

test("computeChunks: pages cover the full range with no gaps", async () => {
  const { computeChunks } = await import("../dist/services/releaseSchedule.js");
  const start = new Date("2026-09-18T08:00:00Z");
  // 73 pages with 10% (8 per chunk) should land on exactly 10 chunks,
  // covering 1..73 without overlap.
  const chunks = computeChunks({ totalPages: 73, chunkPercent: 10, cadence: "WEEKLY", startAt: start });
  assert.equal(chunks.length, 10);
  for (let i = 0; i < chunks.length; i += 1) {
    if (i === 0) {
      assert.equal(chunks[i].pageStart, 1);
    } else {
      assert.equal(chunks[i].pageStart, chunks[i - 1].pageEnd + 1);
    }
  }
  assert.equal(chunks[chunks.length - 1].pageEnd, 73);
});
