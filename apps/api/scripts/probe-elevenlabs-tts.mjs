const key = process.env.ELEVENLABS_API_KEY;
const voice = "21m00Tcm4TlvDq8ikWAM"; // Rachel, default
const r = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
  {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
      Accept: "audio/mpeg"
    },
    body: JSON.stringify({
      text: "Smoke test.",
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true }
    })
  }
);
console.log("status:", r.status);
console.log("content-type:", r.headers.get("content-type"));
const buf = Buffer.from(await r.arrayBuffer());
console.log("bytes:", buf.length);
if (!r.ok) {
  console.log("body:", buf.toString("utf8").slice(0, 500));
}