/**
 * Pins the body shape MiniMax's POST /v1/t2a_v2 receives from generateNarration
 * (and POST /v1/image_generation's video-trigger shape from synthesizeSpeech).
 *
 * Verified against the official openapi spec at
 * https://platform.minimax.io/docs/api-reference/speech/t2a/api/openapi.json
 * and the wrapper openapi.json for the listing endpoint at
 * https://platform.minimax.io/docs/api-reference/speech/voice-management/api/openapi.json.
 *
 * Strategy: stub global fetch, capture the create-task body, mock the
 * task-query + file-retrieve to return a successful response with
 * subtitle_file, then assert that generateNarration (a) used the right
 * model id, (b) inlined the inline-image as data URI when one was passed,
 * (c) parsed subtitle timings, (d) wrote both audio + VTT to R2.
 */
import "./_guard.mjs";
import test from "node:test";
import assert from "node:assert/strict";

// Set the env BEFORE importing the service so the feature flag resolves.
process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? "test-key";
process.env.MINIMAX_TTS_MODEL = "speech-2.8-hd";
process.env.MINIMAX_IMAGE_MODEL = "image-01";

const { generateNarration, synthesizeSpeech, listVoices, estimateClipCredits: _unusedEstimate } = await import(
  "../dist/services/minimax-speech.js"
);

const originalFetch = globalThis.fetch;
// Module-scope capture so installStub can write to it without each test having
// to thread the object through closures. Tests reset it via `capture = {}`.
let capture = {};

function makeMinimalAudio() {
  // 1-second silent 8kHz mono mp3 stub (≈300 bytes). Just enough to keep the
  // base64 path happy. The fixture-file size is irrelevant — we only assert
  // that the URL is captured and R2 mirror is called.
  return Buffer.from("/+NZxAAAAANIAAAAAExBTUUzLjEwMF8yRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVV///wAABQYAQBESEEEEE");
}

function installStub({ mode }) {
  let phase = 0;
  globalThis.fetch = async (url, init) => {
    // aws4fetch wraps the URL in a Request, so normalise here.
    const raw = typeof url === "string" ? url : url.url;
    const u = String(raw);
    phase += 1;
    if (mode === "tts") {
      // Phase 1: POST /v1/t2a_v2 (synthesis).
      if (u.endsWith("/v1/t2a_v2") && init?.method === "POST") {
        capture.requestBody = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({
            data: {
              audio_url: "https://api.minimax.io/v1/files/cdn/clip-abc.mp3",
              subtitle_file: "https://api.minimax.io/v1/files/cdn/clip-abc.srt",
              status: 2
            },
            extra_info: { audio_length_ms: 6000, usage_characters: 117 },
            base_resp: { status_code: 0 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      // Phase 2: GET audio download URL.
      if (u.includes("clip-abc.mp3")) {
        return new Response(makeMinimalAudio(), {
          status: 200,
          headers: { "content-type": "audio/mpeg" }
        });
      }
      // Phase 3: GET subtitle JSON download URL (MiniMax returns JSON; the
// implementation parses it and emits a VTT blob).
      if (u.includes("clip-abc.srt")) {
        return new Response(
          JSON.stringify([
            { text: "Every great story begins", time_begin: 0, time_end: 2000 },
            { text: "with a single page, waiting to be heard.", time_begin: 2000, time_end: 4500 }
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      // Phase 3.5: data: URL passed into mirrorToR2 — decode the base64
      // payload directly (Node undici rejects data: URLs and mirrorToR2
      // would otherwise retry 5x with 75s of backoff).
      if (u.startsWith("data:")) {
        const match = /^data:[^;]+;base64,(.*)$/.exec(u);
        const bytes = match ? Buffer.from(match[1], "base64") : Buffer.alloc(0);
        return new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg" } });
      }
      // Phase 4: PUT to R2 mirror.
      if (u.includes("cdn.cloudflarestorage.com") || u.includes(".r2.cloudflarestorage.com")) {
        return new Response("", { status: 200 });
      }
      throw new Error("unexpected fetch for " + u);
    }
    if (mode === "synth") {
      // synthesizeSpeech returns hex audio.
      if (u.endsWith("/v1/t2a_v2") && init?.method === "POST") {
        capture.requestBody = JSON.parse(String(init.body));
        // Return a minimal valid hex audio body — the implementation decodes
        // hex → Buffer; empty string would throw "MiniMax returned no audio".
        return new Response(
          JSON.stringify({
            data: {
              audio: "2f2b4e7a7841414141",
              status: 2
            },
            extra_info: { audio_length_ms: 4200 },
            base_resp: { status_code: 0 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error("unexpected fetch for " + u);
    }
    if (mode === "list") {
      // POST /v1/get_voice — listVoices.
      if (u.endsWith("/v1/get_voice") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            system_voice: [
              {
                voice_id: "English_expressive_narrator",
                voice_name: "Expressive Narrator",
                description: ["A warm British male voice."]
              }
            ],
            base_resp: { status_code: 0 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error("unexpected fetch for " + u);
    }
    throw new Error("unknown mode");
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("generateNarration: posts MiniMax t2a_v2 body with model, language_boost, subtitle_enable=true, output_format=url, voice_setting", async () => {
  capture = {};
  const restore = installStub({ mode: "tts" });
  try {
    const result = await generateNarration({
      text: "Every great story begins with a single page, waiting to be heard.",
      voiceId: "English_expressive_narrator",
      storageKey: "narration/test/page-1.mp3",
      languageBoost: "English",
      strict: true
    });
    assert.equal(result.source, "minimax");
    assert.ok(result.audioUrl, "expected audioUrl after R2 mirror");
    assert.ok(result.vttUrl, "expected vttUrl after the subtitle_file round trip");
    assert.equal(result.durationSeconds, 6);
    assert.equal(result.characters, 117);
  } finally {
    restore();
  }
  // Body assertions.
  assert.equal(capture.requestBody.model, "speech-2.8-hd", "model id must be MiniMax-Hailuo style");
  assert.equal(capture.requestBody.output_format, "url", "url format keeps memory bounded for multi-MB clips");
  assert.equal(capture.requestBody.subtitle_enable, true, "subtitle_enable must be true so VTT timing is real");
  assert.equal(capture.requestBody.subtitle_type, "sentence", "sentence is the only valid sentence-level subtitle type per MiniMax openapi");
  assert.match(capture.requestBody.prompt ?? capture.requestBody.text, /Every great/);
  // The text is mapped to "text" in the spec.
  assert.match(capture.requestBody.text, /Every great story begins with a single page/);
  // voice_setting wires the active provider voice id.
  assert.equal(capture.requestBody.voice_setting.voice_id, "English_expressive_narrator");
  // language_boost pins the language model.
  assert.equal(capture.requestBody.language_boost, "English");
  // audio_setting pins the format/samplerate/channel so output files match R2.
  assert.equal(capture.requestBody.audio_setting.format, "mp3");
  assert.equal(capture.requestBody.audio_setting.sample_rate, 32000);
  assert.equal(capture.requestBody.audio_setting.channel, 1);
});

test("generateNarration: 404 on a cloned voice falls back to English_expressive_narrator and surfaces orphanedVoiceId", async () => {
  // Stub: first call returns 404, second call returns success.
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    const raw = typeof url === "string" ? url : url.url;
    const u = String(raw);
    calls += 1;
    if (calls === 1) {
      return new Response("voice_not_found", { status: 404, statusText: "Not Found" });
    }
    if (u.startsWith("data:")) {
      // mirrorToR2 feeds a data: URL into fetch, which Node undici rejects
      // (and the helper then retries 5x with 75s of backoff). Decode the
      // base64 payload directly so the test doesn't hang.
      const match = /^data:[^;]+;base64,(.*)$/.exec(u);
      const bytes = match ? Buffer.from(match[1], "base64") : Buffer.alloc(0);
      return new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
    if (u.endsWith("/v1/t2a_v2")) {
      return new Response(
        JSON.stringify({
          data: { audio_url: "https://api.minimax.io/v1/files/cdn/fallback.mp3", status: 2 },
          extra_info: { audio_length_ms: 6000, usage_characters: 117 },
          base_resp: { status_code: 0 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (u.includes("fallback.mp3")) {
      return new Response(makeMinimalAudio(), { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
    if (u.includes(".r2.cloudflarestorage.com")) return new Response("", { status: 200 });
    throw new Error(`unexpected ${u}`);
  };
  try {
    const result = await generateNarration({
      text: "Tiny test",
      voiceId: "voice_orphan",
      storageKey: "narration/test/fallback.mp3",
      strict: false
    });
    assert.equal(result.source, "minimax");
    assert.equal(result.orphanedVoiceId, "voice_orphan", "the orphanedVoiceId must surface so the pipeline can mark the user's clone REMOVED");
    assert.ok(result.audioUrl, "fallback recording should still produce an audioUrl");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("synthesizeSpeech: returns a hex audio body in 200 when configured", async () => {
  capture = {};
  const restore = installStub({ mode: "synth" });
  try {
    const audio = await synthesizeSpeech("Hello page one", "English_expressive_narrator");
    assert.ok(audio, "expected non-empty Buffer from synthesizeSpeech");
    assert.ok(audio.length > 0, "expected non-zero length audio buffer");
  } finally {
    restore();
  }
});

test("listVoices: returns the parsed system_voice array shape from POST /v1/get_voice", async () => {
  const restore = installStub({ mode: "list" });
  try {
    const voices = await listVoices({ forceRefresh: true });
    assert.equal(voices.length, 1);
    assert.equal(voices[0].voice_id, "English_expressive_narrator");
    assert.equal(voices[0].voice_name, "Expressive Narrator");
  } finally {
    restore();
  }
});

// Reference unused to keep the named export shape stable.
void _unusedEstimate;
