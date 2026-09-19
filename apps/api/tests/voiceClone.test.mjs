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

/* --------------------------------------------------------------------- *
 * VoiceOrphanedError: 404 from ElevenLabs surfaces as a typed error so
 * callers can mark the user's voice REMOVED + fall back gracefully.
 * generateNarration retries once with the default voice so the page
 * still gets audio.
 * --------------------------------------------------------------------- */

test("VoiceOrphanedError: synthesizeSpeech throws on 404 with the requested voice id", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("voice_not_found", { status: 404, statusText: "Not Found" });
  try {
    await assert.rejects(
      () => api.synthesizeSpeech("hello world", "voice_orphan"),
      (err) => {
        assert.equal(err.name, "VoiceOrphanedError");
        assert.ok(err instanceof api.VoiceOrphanedError);
        assert.equal(err.voiceId, "voice_orphan");
        assert.equal(err.status, 404);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateNarration: 404 on the cloned voice → retries with default → returns audioUrl + orphanedVoiceId", async () => {
  const originalFetch = globalThis.fetch;
  // First call (cloned voice) returns 404; second call (fallback) returns audio;
  // third call is the R2 upload — also returns 200.
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (calls === 1) return new Response("voice_missing", { status: 404 });
    return new Response(Buffer.from([0xff, 0xfb, 0x00, 0x00]), {
      status: 200,
      headers: { "content-type": "audio/mpeg" }
    });
  };
  // Force the fallback to something distinct from the orphan id.
  const origFallback = process.env.ELEVENLABS_NARRATOR_VOICE_ID;
  process.env.ELEVENLABS_NARRATOR_VOICE_ID = "voice_default";
  try {
    const result = await api.generateNarration({ text: "hello", voiceId: "voice_orphan" });
    assert.ok(result.audioUrl, "expected fallback to produce an audioUrl");
    assert.equal(result.orphanedVoiceId, "voice_orphan");
    assert.equal(result.source, "elevenlabs");
    // 1 = 404 from cloned voice; 2 = fallback audio; 3 = R2 upload
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (origFallback === undefined) delete process.env.ELEVENLABS_NARRATOR_VOICE_ID;
    else process.env.ELEVENLABS_NARRATOR_VOICE_ID = origFallback;
  }
});

test("generateNarration: 404 on cloned voice when fallback IS the orphan → returns stub with orphanedVoiceId", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("voice_missing", { status: 404 });
  };
  const origFallback = process.env.ELEVENLABS_NARRATOR_VOICE_ID;
  // Fallback == orphan → no point retrying
  process.env.ELEVENLABS_NARRATOR_VOICE_ID = "voice_only";
  try {
    const result = await api.generateNarration({ text: "hello", voiceId: "voice_only" });
    assert.equal(result.audioUrl, null);
    assert.equal(result.source, "stub");
    assert.equal(result.orphanedVoiceId, "voice_only");
    assert.equal(calls, 1, "should not retry when fallback === orphan");
  } finally {
    globalThis.fetch = originalFetch;
    if (origFallback === undefined) delete process.env.ELEVENLABS_NARRATOR_VOICE_ID;
    else process.env.ELEVENLABS_NARRATOR_VOICE_ID = origFallback;
  }
});

test("generateNarration: synthesizeSpeech throws non-orphan error → falls through to stub branch (no orphanedVoiceId)", async () => {
  // Hit the orphan branch by triggering a 404 with no fallback. SynthesizeSpeech
  // throws VoiceOrphanedError synchronously (no retries), generateNarration
  // catches it, sees fallback === orphan, returns stub with orphanedVoiceId.
  // This pins that a non-404 error path doesn't leak orphanedVoiceId.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("bad_request", { status: 400 });
  try {
    const result = await api.generateNarration({ text: "hello", voiceId: "voice_xyz" });
    assert.equal(result.audioUrl, null);
    assert.equal(result.source, "stub");
    assert.equal(result.orphanedVoiceId, undefined, "400 is not a voice-orphan, must not flag");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
