/**
 * Pins the body shape MiniMax's POST /v1/video_generation receives from
 * animateStill and the body shape it sends to POST /v1/image_generation
 * from generateStill. Regression guard for schema-drift.
 *
 * The model name `MiniMax-Hailuo-2.3` is the documented default; `Image-01`
 * is documented for stills. Both string types are pinned here so a typo,
 * an enum rename, or a wrongly-nested field fails the build fast.
 *
 * Verified against https://platform.minimax.io/docs/api-reference/video/
 * generation/api/text-to-video.json and …/image-to-video.json. Polling
 * (GET /v1/query/video_generation?task_id=…) and file retrieval
 * (GET /v1/files/retrieve?file_id=…) are covered by the sleep + status
 * pump inline — the response shape `{ task_id, status, file_id }` is also
 * pinned.
 *
 * Strategy: stub global fetch, capture the create-task body, mock the
 * polling loop with a "Success + file_id" arm, mock the file retrieval
 * to return a download URL, then assert that animateStill inlined the
 * first_frame_image as a single data URI (not an array, not a bare URL).
 */
import "./_guard.mjs";
import test from "node:test";
import assert from "node:assert/strict";

// Set the env BEFORE importing the service so the feature flag resolves
// to enabled on first load. Node ESM hoists `import` bindings, but
// top-level statements run in source order so this is fine.
process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? "test-key";
process.env.MINIMAX_VIDEO_MODEL = "MiniMax-Hailuo-2.3";
process.env.MINIMAX_IMAGE_MODEL = "image-01";

const { animateStill, generateStill, estimateClipCredits } = await import("../dist/services/minimax-video.js");

const originalFetch = globalThis.fetch;
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64"
);

/**
 * Install a fetch stub that maps URLs to canned responses, regardless of call
 * order. Handles the typical inlineImage + createTask + query + retrieve + mp4
 * download chain; the order varies depending on whether the still was an
 * http URL (which makes inlineImage fire first) or a data URI (which doesn't
 * need a fetch at all).
 */
function installFetchStub({ capture, mode = "animate" }) {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (mode === "animate") {
      // inlineImage: any HTTPS URL gets the PNG.
      if (/^https?:\/\/media\.animbook\.com\/.*\.png$/i.test(u) || /^https?:\/\/.*\/cast\/.*\.png$/i.test(u)) {
        return new Response(ONE_PIXEL_PNG, { status: 200, headers: { "content-type": "image/png" } });
      }
      // createTask: POST /v1/video_generation.
      if (/^https:\/\/api\.minimax\.io\/v1\/video_generation/.test(u) && init?.method === "POST") {
        capture.taskCreateBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ task_id: "task-abc", base_resp: { status_code: 0, status_msg: "ok" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      // query: GET /v1/query/video_generation?task_id=…
      if (/^https:\/\/api\.minimax\.io\/v1\/query\/video_generation/.test(u)) {
        return new Response(
          JSON.stringify({ task_id: "task-abc", status: "Success", file_id: "file-xyz", base_resp: { status_code: 0 } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      // retrieve: GET /v1/files/retrieve?file_id=…
      if (/^https:\/\/api\.minimax\.io\/v1\/files\/retrieve/.test(u)) {
        return new Response(
          JSON.stringify({ file: { download_url: "https://example.com/clip.mp4" }, base_resp: { status_code: 0 } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      // mp4 download from the download_url.
      if (/^https:\/\/example\.com\/clip\.mp4/.test(u)) {
        return new Response(Buffer.from("fake-mp4-bytes"), { status: 200, headers: { "content-type": "video/mp4" } });
      }
      throw new Error(`unexpected fetch for ${u}`);
    }
    // mode === "image": POST /v1/image_generation.
    if (/^https:\/\/api\.minimax\.io\/v1\/image_generation/.test(u) && init?.method === "POST") {
      capture.imageBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ data: { image_urls: ["https://example.com/still.png"] }, base_resp: { status_code: 0 } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    throw new Error(`unexpected fetch for ${u}`);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("animateStill posts a MiniMax task body with the correct v1/i2v shape", async () => {
  const capture = {};
  const restore = installFetchStub({ capture, mode: "animate" });
  try {
    await animateStill("https://media.animbook.com/cast/example/p1.png", "Slow push-in across the field", 6, "768P");
  } finally {
    restore();
  }
  assert.ok(capture.taskCreateBody, "expected animateStill to call POST /v1/video_generation");
  assert.equal(capture.taskCreateBody.model, "MiniMax-Hailuo-2.3");
  assert.match(capture.taskCreateBody.prompt, /^Slow push-in/);
  // first_frame_image is the inlined data URI, not a bare URL.
  assert.ok(
    typeof capture.taskCreateBody.first_frame_image === "string",
    "first_frame_image must be a string"
  );
  assert.ok(
    capture.taskCreateBody.first_frame_image.startsWith("data:image/png;base64,"),
    `first_frame_image must start with data:image/png;base64, got ${String(capture.taskCreateBody.first_frame_image).slice(0, 60)}`
  );
  assert.equal(capture.taskCreateBody.duration, 6);
  assert.equal(capture.taskCreateBody.resolution, "768P");
  // 1080P and 6s/10s have distinct price points — make sure no one sets
  // the wrong resolution by accident.
  assert.notEqual(capture.taskCreateBody.resolution, "1080P");
});

test("generateStill posts a MiniMax image-01 body with model and aspect_ratio pinned", async () => {
  const capture = {};
  const restore = installFetchStub({ capture, mode: "image" });
  try {
    const url = await generateStill("A wide cinematic still of a Yoruba market at dawn.", "16:9");
    assert.equal(url, "https://example.com/still.png");
  } finally {
    restore();
  }
  assert.ok(capture.imageBody, "expected generateStill to call POST /v1/image_generation");
  assert.equal(capture.imageBody.model, "image-01");
  assert.match(capture.imageBody.prompt, /^A wide cinematic still/);
  assert.equal(capture.imageBody.response_format, "url");
  assert.equal(capture.imageBody.aspect_ratio, "16:9");
});

test("estimateClipCredits matches the published MiniMax price points", () => {
  // 6s/768P/default = $0.28
  assert.equal(estimateClipCredits(6, "768P", false), 0.28);
  // 10s/768P/default = $0.56
  assert.equal(estimateClipCredits(10, "768P", false), 0.56);
  // 6s/1080P/default = $0.49
  assert.equal(estimateClipCredits(6, "1080P", false), 0.49);
  // 6s/768P/Fast = $0.19
  assert.equal(estimateClipCredits(6, "768P", true), 0.19);
  // 10s/768P/Fast = $0.32
  assert.equal(estimateClipCredits(10, "768P", true), 0.32);
  // 6s/1080P/Fast = $0.33
  assert.equal(estimateClipCredits(6, "1080P", true), 0.33);
});
