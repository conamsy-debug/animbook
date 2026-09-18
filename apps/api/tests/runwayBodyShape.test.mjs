/**
 * Pins the body shape Runway's /image_to_video endpoint receives from
 * animateStill. Regression guard for the schema-drift bug where
 * promptImage was sent as a string and Runway returned
 *   "Invalid input: expected array, received string"
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
  // Real apps pass an R2 URL; inlineImage downloads it. We point fetch at
  // a data: URI so no real network is needed.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
    "base64"
  );
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * Stub fetch: first call is the create-task POST (we capture the body and
 * return a fake task id). Second call is the task-status GET (return
 * SUCCEEDED + a video URL). Third call is the mirror-to-r2 download.
 */
function installFetchStub({ captureCreateBody, createStatus = 200 }) {
  let callIndex = 0;
  globalThis.fetch = async (url, init) => {
    callIndex += 1;
    if (callIndex === 1) {
      // createTask POST
      captureCreateBody.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "task-abc" }), {
        status: createStatus,
        headers: { "content-type": "application/json" }
      });
    }
    if (callIndex === 2) {
      // waitForTask GET (poll)
      return new Response(
        JSON.stringify({ id: "task-abc", status: "SUCCEEDED", output: ["https://example.com/clip.mp4"] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (callIndex === 3) {
      // mirrorToR2 download of the clip
      return new Response(Buffer.from("fake mp4 bytes"), { status: 200, headers: { "content-type": "video/mp4" } });
    }
    // Anything else fails loudly so we don't silently pass.
    throw new Error(`unexpected fetch #${callIndex}: ${url}`);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("animateStill sends promptImage as an array of one (Runway schema drift guard)", async () => {
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
  assert.ok(Array.isArray(body.promptImage), `promptImage must be an array, got ${typeof body.promptImage}`);
  assert.equal(body.promptImage.length, 1, "promptImage must have exactly one entry");
  // The entry is either a data: URI (preferred) or an https URL — but
  // never a bare string with whitespace around it.
  const entry = body.promptImage[0];
  assert.ok(typeof entry === "string" && entry.length > 0, "promptImage entry must be a non-empty string");
  assert.match(entry, /^(data:image\/|https?:\/\/)/, `promptImage entry must be data: or http(s):, got: ${entry.slice(0, 80)}`);
  assert.equal(body.promptText, "Slow push-in across the field");
  assert.equal(body.ratio, "1280:720");
  assert.equal(body.duration, 5);
});

test("animateStill uses inlineImage: promptImage entry starts with 'data:image/' when given an http URL", async () => {
  // Override fetch: still fetch returns 1x1 PNG bytes; everything else per stub.
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
  const entry = captured[0].promptImage[0];
  assert.ok(entry.startsWith("data:image/png;base64,"), `expected inlined data URI, got: ${entry.slice(0, 60)}`);
});
