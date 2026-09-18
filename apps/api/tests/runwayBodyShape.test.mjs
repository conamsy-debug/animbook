/**
 * Pins the body shape Runway's /image_to_video endpoint receives from
 * animateStill. Regression guard for the schema-drift bug where
 * promptImage was sent as an array and Runway returned
 *   "Invalid input: expected string, received array"
 *
 * Verified against Runway provider docs (runcomfy, aimlapi, segmind) and
 * the Runway changelog: promptImage is a SINGLE STRING — either an HTTPS
 * URL Runway can fetch, or an inlined data URI. Inlining dodges
 * "Failed to fetch image metadata" errors when Runway's fetchers can't
 * reach our CDN.
 *
 * Strategy: stub global fetch, capture the first request body, return a
 * happy-path task-success response so animateStill returns cleanly.
 */
import test from "node:test";
import assert from "node:assert/strict";

const runwayModule = await import("../dist/src/services/runway.js");
const { animateStill } = runwayModule;

const originalFetch = globalThis.fetch;

/** Build a tiny PNG (1x1 transparent) as base64 — what inlineImage will produce. */
function makeStillUrl() {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
    "base64"
  );
  return `data:image/png;base64,${png.toString("base64")}`;
}

function installFetchStub({ captureCreateBody, createStatus = 200 }) {
  let callIndex = 0;
  globalThis.fetch = async (url, init) => {
    callIndex += 1;
    if (callIndex === 1) {
      captureCreateBody.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "task-abc" }), {
        status: createStatus,
        headers: { "content-type": "application/json" }
      });
    }
    if (callIndex === 2) {
      return new Response(
        JSON.stringify({ id: "task-abc", status: "SUCCEEDED", output: ["https://example.com/clip.mp4"] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (callIndex === 3) {
      return new Response(Buffer.from("fake mp4 bytes"), { status: 200, headers: { "content-type": "video/mp4" } });
    }
    throw new Error(`unexpected fetch #${callIndex}: ${url}`);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("animateStill sends promptImage as a single string (Runway schema-drift guard)", async () => {
  const captured = [];
  const restore = installFetchStub({ captureCreateBody: captured });
  try {
    await animateStill(makeStillUrl(), "Slow push-in across the field", 5, "1280:720");
  } finally {
    restore();
  }
  assert.equal(captured.length, 1);
  const body = captured[0];
  assert.equal(body.model, "gen4_turbo");
  // promptImage MUST be a string — Runway's schema is `string` (URL or data URI).
  // Earlier rounds wrapped it in an array based on a misread of one Zod error
  // message; production Runway docs (runcomfy / aimlapi / segmind) all send a string.
  assert.equal(typeof body.promptImage, "string", `promptImage must be a string, got ${typeof body.promptImage}`);
  assert.ok(body.promptImage.length > 0, "promptImage must be non-empty");
  assert.match(body.promptImage, /^(data:image\/|https?:\/\/)/, `promptImage must be data: or http(s):, got: ${body.promptImage.slice(0, 80)}`);
  assert.equal(body.promptText, "Slow push-in across the field");
  assert.equal(body.ratio, "1280:720");
  assert.equal(body.duration, 5);
});

test("animateStill uses inlineImage: promptImage starts with 'data:image/' when given an http URL", async () => {
  const stillBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
    "base64"
  );
  const captured = [];
  let callIndex = 0;
  globalThis.fetch = async (url, init) => {
    callIndex += 1;
    if (callIndex === 1) {
      // download of the still URL → return PNG bytes
      return new Response(stillBytes, { status: 200, headers: { "content-type": "image/png" } });
    }
    if (callIndex === 2) {
      captured.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "task-abc" }), { status: 200 });
    }
    if (callIndex === 3) {
      return new Response(JSON.stringify({ id: "task-abc", status: "SUCCEEDED", output: ["https://x.com/c.mp4"] }), { status: 200 });
    }
    if (callIndex === 4) {
      return new Response(Buffer.from("x"), { status: 200, headers: { "content-type": "video/mp4" } });
    }
    throw new Error(`unexpected fetch #${callIndex}: ${url}`);
  };
  try {
    await animateStill("https://media.animbook.com/cast/example/p1.png", "Slow push-in", 5, "1280:720");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(captured.length, 1);
  assert.ok(
    captured[0].promptImage.startsWith("data:image/png;base64,"),
    `expected inlined data URI, got: ${String(captured[0].promptImage).slice(0, 60)}`
  );
});
