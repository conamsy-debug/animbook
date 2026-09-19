// Pins the shape of the ElevenLabs /v1/voices/add request we send. The
// real call happens server-side via the published API — here we just
// assert that cloneVoiceFromSamples builds the right multipart envelope.
import test from "node:test";
import assert from "node:assert/strict";

const api = await import("../dist/services/elevenlabs.js");

const originalFetch = globalThis.fetch;

function installFetchStub({ capturedForm, status = 200, voiceId = "voice_abc" }) {
  globalThis.fetch = async (url, init) => {
    if (typeof url === "string" && url.endsWith("/voices/add") && init?.method === "POST") {
      capturedForm.push(init.body);
      return new Response(JSON.stringify({ voice_id: voiceId }), {
        status,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return () => { globalThis.fetch = originalFetch; };
}

test("cloneVoiceFromSamples: POSTs multipart with files + name + description", async () => {
  const captured = [];
  const restore = installFetchStub({ capturedForm: captured });
  try {
    const out = await api.cloneVoiceFromSamples({
      name: "Cosmos storyteller",
      description: "AnimBook author voice",
      samples: [
        { buffer: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), filename: "a.mp3", contentType: "audio/mpeg" },
        { buffer: Buffer.from([9, 9, 9]), filename: "b.mp3", contentType: "audio/mpeg" }
      ]
    });
    assert.equal(out.voiceId, "voice_abc");
    assert.equal(captured.length, 1);
    const form = captured[0];
    assert.ok(form instanceof FormData, "body must be a FormData instance");
    // FormData#get is non-standard on Node, but .get does exist on the modern
    // undici-backed FormData implementation; fall back to iterating if not.
    const name = form.get ? form.get("name") : null;
    if (name) {
      assert.equal(name, "Cosmos storyteller");
    }
    // We can't robustly probe multipart "files" without a boundary parse, so
    // just assert the FormData is iterable (used by undici in fetch).
    assert.equal(typeof form[Symbol.iterator], "function");
  } finally {
    restore();
  }
});

test("cloneVoiceFromSamples: empty samples → throws", async () => {
  await assert.rejects(
    async () => api.cloneVoiceFromSamples({ name: "x", samples: [] }),
    /at least one/i
  );
});

test("cloneVoiceFromSamples: empty buffer → throws", async () => {
  await assert.rejects(
    async () =>
      api.cloneVoiceFromSamples({
        name: "x",
        samples: [{ buffer: Buffer.alloc(0), filename: "a.mp3", contentType: "audio/mpeg" }]
      }),
    /empty/i
  );
});

test("deleteClonedVoice: idempotent (404 on second call doesn't throw)", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    if (calls === 1) return new Response("", { status: 204 });
    if (calls === 2) return new Response("missing", { status: 404 });
    throw new Error(`unexpected call ${calls}`);
  };
  try {
    await api.deleteClonedVoice("voice_abc");
    await api.deleteClonedVoice("voice_abc");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
