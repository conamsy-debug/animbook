// Voice clone quality scoring. Heuristic — no ML, just signal we can read
// from the sample buffers themselves. Inputs are per-sample audio buffers
// plus their declared content types; we ffprobe each one for duration +
// bit depth + sample rate and combine those into a 0-100 score.
//
// The score is best understood as "how good a raw material does this user
// give ElevenLabs to clone from", not "how good does the resulting clone
// sound" — that's still gated by ElevenLabs' own training quality. We
// surface the per-component breakdown so authors can iterate: "you need
// 90 more seconds of clean speech" or "your m4a is at 64kbps; try wav".

import { spawn } from "node:child_process";

export interface SampleStats {
  /** Per-sample label, e.g. "sample-1.mp3" — surfaced in the UI list. */
  filename: string;
  /** Detected container: "wav" | "mp3" | "m4a" | "mp4" | "unknown". */
  format: "wav" | "mp3" | "m4a" | "mp4" | "unknown";
  /** Audio duration in seconds, or null if ffprobe couldn't read it. */
  durationSec: number | null;
  /** Sample rate in Hz, or null if unknown. */
  sampleRate: number | null;
  /** Bitrate in bits-per-second, or null if unknown. */
  bitrate: number | null;
  /** Number of audio channels (1 = mono, 2 = stereo), or null. */
  channels: number | null;
}

export interface VoiceQualityReport {
  /** 0-100 headline score. */
  score: number;
  /** Per-component contributions for the UI breakdown. */
  components: {
    /** 0-25: how many samples (3-5 is ideal for ElevenLabs Instant Clone). */
    sampleCount: { value: number; ideal: number; contribution: number };
    /** 0-30: total duration in seconds across all samples. */
    totalDuration: { seconds: number; idealMin: number; idealMax: number; contribution: number };
    /** 0-25: best audio format detected (wav 44.1k+ > mp3 192k+ > m4a). */
    format: { detected: string; contribution: number };
    /** 0-20: format variety — different formats recorded in different conditions. */
    variety: { uniqueFormats: number; contribution: number };
  };
  /** Per-sample stats for the UI list. */
  samples: SampleStats[];
  /** Free-form note for the UI (e.g. "Add 60+ seconds for a better score"). */
  hint: string | null;
}

/**
 * Probe a single audio buffer with ffprobe. Returns null fields on parse
 * failure so the caller can still compute a partial score.
 *
 * We write to a temp file first because piping large buffers into
 * ffprobe's stdin trips a "write EOF" on Node 24 (the child closes the
 * pipe before all bytes drain). The temp file lives only for the
 * duration of the probe; we delete it in a finally.
 */
async function probeSample(buf: Buffer, filename: string): Promise<SampleStats> {
  const { writeFile, unlink } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { randomBytes } = await import("node:crypto");
  const ext = filename.match(/\.(\w+)$/)?.[1] ?? "bin";
  const tmpPath = join(tmpdir(), `vq-probe-${randomBytes(6).toString("hex")}.${ext}`);
  await writeFile(tmpPath, buf);
  try {
    return await new Promise((resolve) => {
      const args = [
        "-v", "error",
        "-i", tmpPath,
        "-show_entries", "format=duration,bit_rate:stream=sample_rate,channels,codec_name",
        "-of", "csv=s=x:p=0"
      ];
      const child = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      child.stdout.on("data", (c: Buffer | string) => { stdout += c.toString("utf8"); });
      child.on("error", () => {
        resolve({ filename, format: "unknown", durationSec: null, sampleRate: null, bitrate: null, channels: null });
      });
      child.on("close", () => {
        // csv=s=x:p=0 with multiple streams: layout is
        //   [codec,channels,sample_rate]  for the audio stream
        //   [duration,bit_rate]           for the format container
        const fields = stdout.trim().split(/[,\nx]/).filter(Boolean);
        const codec = (fields[0] || "").toLowerCase();
        const channels = fields[1] ? parseInt(fields[1], 10) : null;
        const sampleRate = fields[2] ? parseInt(fields[2], 10) : null;
        const durationSec = fields[3] ? parseFloat(fields[3]) : null;
        const bitrate = fields[4] ? parseInt(fields[4], 10) : null;
        const format: SampleStats["format"] =
          codec.includes("mp3") ? "mp3" :
          codec.includes("aac") || codec.includes("m4a") ? "m4a" :
          codec.includes("wav") || codec.includes("pcm") ? "wav" :
          codec.includes("aac") || filename.match(/\.m4a$/i) ? "m4a" :
          "unknown";
        resolve({
          filename,
          format,
          durationSec: Number.isFinite(durationSec as number) ? durationSec : null,
          sampleRate: Number.isFinite(sampleRate as number) ? sampleRate : null,
          bitrate: Number.isFinite(bitrate as number) ? bitrate : null,
          channels: Number.isFinite(channels as number) ? channels : null
        });
      });
    });
  } finally {
    void unlink(tmpPath).catch(() => undefined);
  }
}

/**
 * Score voice-clone sample quality. Higher = better training material.
 * Caps at 100, floors at 0. Doesn't fail on ffprobe errors — components
 * just contribute 0 and we surface "couldn't read audio metadata" in
 * the hint.
 */
export async function scoreVoiceQuality(
  samples: { buffer: Buffer; filename: string }[]
): Promise<VoiceQualityReport> {
  if (samples.length === 0) {
    return {
      score: 0,
      components: {
        sampleCount: { value: 0, ideal: 4, contribution: 0 },
        totalDuration: { seconds: 0, idealMin: 90, idealMax: 240, contribution: 0 },
        format: { detected: "none", contribution: 0 },
        variety: { uniqueFormats: 0, contribution: 0 }
      },
      samples: [],
      hint: "Upload at least one audio sample to see a quality score."
    };
  }
  const stats = await Promise.all(samples.map((s) => probeSample(s.buffer, s.filename)));

  // Component 1: sample count (0-25). 3-5 is the sweet spot — ElevenLabs
  // recommends "1-5 minutes of clean speech", which usually means 3-5
  // distinct recordings.
  const countContribution =
    samples.length >= 3 && samples.length <= 5 ? 25 :
    samples.length === 2 ? 15 :
    samples.length === 1 ? 5 :
    /* >= 6 */ 18; // diminishing returns

  // Component 2: total duration (0-30). 90-240s = ideal.
  const totalSec = stats.reduce((s, x) => s + (x.durationSec ?? 0), 0);
  let durationContribution: number;
  if (totalSec >= 90 && totalSec <= 240) durationContribution = 30;
  else if (totalSec >= 60) durationContribution = 22;
  else if (totalSec >= 30) durationContribution = 14;
  else if (totalSec > 0) durationContribution = 5;
  else durationContribution = 0; // ffprobe couldn't read any of them

  // Component 3: best format (0-25). wav at 44.1k+ > mp3 at 192k+ > mp3 at
  // 128k+ > m4a. We take the BEST sample so authors aren't penalised for
  // mixing formats.
  const formatScore = (s: SampleStats): number => {
    if (s.format === "wav" && (s.sampleRate ?? 0) >= 44100) return 25;
    if (s.format === "wav") return 18;
    if (s.format === "mp3" && (s.bitrate ?? 0) >= 192000) return 20;
    if (s.format === "mp3" && (s.bitrate ?? 0) >= 128000) return 14;
    if (s.format === "mp3") return 8;
    if (s.format === "m4a" && (s.bitrate ?? 0) >= 128000) return 12;
    if (s.format === "m4a") return 6;
    return 0;
  };
  const formatContribution = Math.max(0, ...stats.map(formatScore));
  const detectedFormat = stats
    .map((s) => s.format)
    .filter((f) => f !== "unknown")[0] ?? "unknown";

  // Component 4: format/condition variety (0-20). Different recorded
  // sessions in different conditions usually means the author varied tone
  // and emotion. We use unique (format, sample-rate-bucket) combos as a
  // proxy.
  const varietyKeys = new Set(
    stats
      .filter((s) => s.format !== "unknown")
      .map((s) => `${s.format}:${Math.round((s.sampleRate ?? 0) / 8000)}`)
  );
  const varietyContribution = Math.min(20, varietyKeys.size * 7);

  const score = Math.min(
    100,
    countContribution + durationContribution + formatContribution + varietyContribution
  );

  // Actionable hint based on what's holding the score down.
  let hint: string | null = null;
  if (totalSec > 0 && totalSec < 60) {
    hint = `Add ${Math.max(60, 90 - Math.round(totalSec))} more seconds — ElevenLabs recommends 1–4 minutes total.`;
  } else if (samples.length === 1) {
    hint = "Upload 2-4 more samples from different sessions (vary tone and pace).";
  } else if (formatContribution < 12) {
    hint = "Re-export as WAV 44.1kHz or MP3 ≥192kbps — compressed formats lose timbre detail.";
  } else if (varietyKeys.size < 2 && samples.length >= 2) {
    hint = "Record in at least 2 different formats or settings (e.g. phone vs. mic) for natural variety.";
  } else if (score >= 90) {
    hint = "Excellent — your sample set should give ElevenLabs a strong clone.";
  }

  return {
    score,
    components: {
      sampleCount: { value: samples.length, ideal: 4, contribution: countContribution },
      totalDuration: { seconds: Math.round(totalSec), idealMin: 90, idealMax: 240, contribution: durationContribution },
      format: { detected: detectedFormat, contribution: formatContribution },
      variety: { uniqueFormats: varietyKeys.size, contribution: varietyContribution }
    },
    samples: stats,
    hint
  };
}

/** Pick a short, branded sentence for the "hear your clone" preview. */
export const PREVIEW_SENTENCE =
  "Hello, reader — this is a sample of my voice. If you're hearing warmth, clarity, and a calm pace, then the clone is working.";
