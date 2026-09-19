// Author voice cloning UI. Upload 1-8 audio samples, get a cloned voice,
// preview the clone in your own voice, and read the per-component quality
// score. Renders a card the /profile page composes inside the existing
// layout.
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/lib/store";

export interface AuthorVoiceStatus {
  hasVoice: boolean;
  voiceId: string | null;
  status: "NONE" | "UPLOADING" | "CLONED" | "FAILED" | "REMOVED";
  sampleUrl: string | null;
  sampleUrls: Array<{ url: string; filename: string; contentType: string }> | null;
  consentAt: string | null;
  failureReason: string | null;
  quality: {
    score: number;
    details: VoiceQualityDetails | null;
    computedAt: string | null;
  } | null;
}

export interface VoiceQualityDetails {
  score: number;
  components: {
    sampleCount: { value: number; ideal: number; contribution: number };
    totalDuration: { seconds: number; idealMin: number; idealMax: number; contribution: number };
    format: { detected: string; contribution: number };
    variety: { uniqueFormats: number; contribution: number };
  };
  samples: Array<{
    filename: string;
    format: string;
    durationSec: number | null;
    sampleRate: number | null;
    bitrate: number | null;
  }>;
  hint: string | null;
}

const MAX_SAMPLES = 8;
const MAX_BYTES_EACH = 12 * 1024 * 1024;
const ACCEPT = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a";

export default function AuthorVoice() {
  const toast = useToastStore((s) => s.push);
  const [status, setStatus] = useState<AuthorVoiceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [voiceName, setVoiceName] = useState("");
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewAudio, setPreviewAudio] = useState<{ url: string; synthMs: number; text: string } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const s = await apiFetch<AuthorVoiceStatus>("/api/account/voice");
      setStatus(s);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  // Poll while cloning is in flight so the status flips ready without reload.
  useEffect(() => {
    if (!status) return;
    if (status.status !== "UPLOADING") return;
    const id = setInterval(() => { void refresh(); }, 4000);
    return () => clearInterval(id);
  }, [status?.status]);

  function pickFiles(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const next: File[] = [...files];
    for (const f of Array.from(picked)) {
      if (f.size > MAX_BYTES_EACH) {
        toast(`"${f.name}" is ${Math.round(f.size / 1024 / 1024)}MB; max is 12MB each`);
        continue;
      }
      if (!ACCEPT.split(",").some((m) => m === f.type) && !/\.(mp3|wav|m4a|mp4)$/i.test(f.name)) {
        toast(`"${f.name}" isn't an MP3, WAV or M4A`);
        continue;
      }
      if (next.length >= MAX_SAMPLES) {
        toast(`Max ${MAX_SAMPLES} samples — remove one to add another`);
        break;
      }
      // Dedup by name+size so picking the same file twice doesn't dup.
      if (next.some((n) => n.name === f.name && n.size === f.size)) continue;
      next.push(f);
    }
    setFiles(next);
  }

  function removeFile(idx: number) {
    setFiles((cur) => cur.filter((_, i) => i !== idx));
  }

  function totalBytes(): number {
    return files.reduce((s, f) => s + f.size, 0);
  }

  async function upload() {
    if (files.length === 0) { toast("Pick at least one audio file first"); return; }
    if (voiceName.trim().length < 2) { toast("Give your voice a name"); return; }
    if (!consent) { toast("Tick the consent checkbox first"); return; }
    setBusy(true);
    try {
      // Convert each File → base64. The route accepts a JSON envelope.
      const samples = await Promise.all(files.map(async (f) => ({
        filename: f.name,
        contentType: f.type || "audio/mpeg",
        base64: await blobToBase64(f)
      })));
      const res = await fetch("/api/account/voice/samples", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: voiceName.trim().slice(0, 80), consent: true, samples })
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `HTTP ${res.status}`);
      }
      toast(`Cloning ${files.length} sample${files.length === 1 ? "" : "s"} — this takes ~30 seconds`);
      setFiles([]);
      setVoiceName("");
      setConsent(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refresh();
    } catch (err) {
      toast(`Could not clone: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    setPreviewBusy(true);
    setPreviewAudio(null);
    try {
      const res = await apiFetch<{ audioUrl: string; text: string; synthMs: number }>("/api/account/voice/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      setPreviewAudio({ url: res.audioUrl, synthMs: res.synthMs, text: res.text });
    } catch (err) {
      toast(`Preview failed: ${(err as Error).message}`);
    } finally {
      setPreviewBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove your cloned voice? New narrations will fall back to a curated voice.")) return;
    setBusy(true);
    try {
      await apiFetch("/api/account/voice", { method: "DELETE" });
      toast("Your cloned voice has been removed");
      setPreviewAudio(null);
      await refresh();
    } catch (err) {
      toast(`Could not remove: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !status) {
    return (
      <section className="author-voice-card">
        <h3>Your voice</h3>
        <p className="hint">Loading voice status…</p>
      </section>
    );
  }

  const hasCloned = status?.hasVoice && status?.voiceId;
  const isCloning = status?.status === "UPLOADING";
  const quality = status?.quality;
  const totalSizeMb = (totalBytes() / 1024 / 1024).toFixed(1);

  return (
    <section className="author-voice-card">
      <h3>Your voice</h3>
      {hasCloned ? (
        <div className="ready">
          <p>
            <span className="dot ready" /> Your cloned voice is live. It narrates every book you author by default.
          </p>
          <p className="meta">
            Voice id <code>{status?.voiceId}</code> · cloned {status?.consentAt ? new Date(status.consentAt).toLocaleDateString() : ""}
            {status?.sampleUrls && status.sampleUrls.length > 1 ? ` · ${status.sampleUrls.length} samples` : ""}
          </p>
          {status?.sampleUrl ? (
            <audio controls preload="none" src={status.sampleUrl} className="voice-sample" />
          ) : null}

          {/* Quality badge — only render when we have a score */}
          {quality ? <VoiceQualityBadge quality={quality.details} /> : null}

          {/* Preview your clone */}
          <div className="preview-block">
            <button
              type="button"
              className="btn ghost"
              onClick={() => void preview()}
              disabled={previewBusy || isCloning}
            >
              {previewBusy ? "Synthesising…" : "Hear your clone"}
            </button>
            <p className="hint">
              Plays a sample sentence in your voice so you can verify the clone before narrating a book. Costs a few ElevenLabs characters per click.
            </p>
            {previewAudio ? (
              <div className="preview-audio">
                <audio controls preload="metadata" src={previewAudio.url} className="voice-sample" />
                <p className="meta">
                  Synthesised in {previewAudio.synthMs}ms · &ldquo;{previewAudio.text}&rdquo;
                </p>
              </div>
            ) : null}
          </div>

          <button type="button" className="btn ghost" onClick={() => void remove()} disabled={busy}>
            {busy ? "Removing…" : "Remove my voice"}
          </button>
        </div>
      ) : (
        <div className="empty">
          <p>
            Upload 1&ndash;8 audio samples (1&ndash;4 minutes total) and we&apos;ll clone your voice with ElevenLabs.
            Your voice will narrate every book you author &mdash; readers can still swap to a curated narrator if they prefer.
          </p>
          <ol className="instructions">
            <li>Record several short clips in a quiet room (read aloud in different tones).</li>
            <li>Save as MP3, WAV, or M4A. Up to 12MB per sample, 8 samples max.</li>
            <li>Tick the consent box &mdash; we keep the audio + timestamp + IP as an audit trail.</li>
          </ol>
          <div style={{ flex: 1 }} />

          <label className="field">
            <span>Voice name (readers see &quot;By [name]&quot;)</span>
            <input
              type="text"
              maxLength={80}
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value)}
              placeholder="e.g. Cosmos storyteller"
            />
          </label>

          <div className="field">
            <span>Audio samples ({files.length}/{MAX_SAMPLES}, {totalSizeMb}MB total)</span>
            <label className="file-drop">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                multiple
                onChange={(e) => pickFiles(e.target.files)}
              />
              <span>Pick files or drop here</span>
            </label>
            {files.length > 0 ? (
              <ul className="sample-list">
                {files.map((f, i) => (
                  <li key={`${f.name}-${f.size}-${i}`}>
                    <span>
                      <strong>{f.name}</strong> · {Math.round(f.size / 1024)}KB
                    </span>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => removeFile(i)}
                      aria-label={`Remove ${f.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">No files picked yet.</p>
            )}
          </div>

          <label className="consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              I confirm this is my own voice and I consent to AnimBook sending these samples to ElevenLabs for cloning, and to storing
              the audio + my IP + timestamp as a legal record of consent.
            </span>
          </label>

          {status?.status === "FAILED" && status.failureReason ? (
            <p className="error">
              Last attempt failed: {status.failureReason.slice(0, 240)}
            </p>
          ) : null}
          {isCloning ? (
            <p className="hint">
              <span className="spinner" /> Cloning your voice — refresh-free in a few seconds.
            </p>
          ) : null}

          <div className="panel-actions">
            <button
              type="button"
              className="btn"
              onClick={() => void upload()}
              disabled={busy || files.length === 0 || voiceName.trim().length < 2 || !consent}
            >
              {busy
                ? "Uploading…"
                : files.length === 1
                  ? "Clone my voice"
                  : `Clone from ${files.length} samples`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------------- *
 * Quality badge — pill that breaks down the score into the four
 * components (sampleCount, duration, format, variety). Used both in the
 * "ready" state to celebrate a strong clone and in the "empty" state
 * preview to teach authors what good looks like.
 * --------------------------------------------------------------------- */

function VoiceQualityBadge({ quality }: { quality: VoiceQualityDetails | null }) {
  if (!quality) return null;
  const { score, components, samples, hint } = quality;
  const tone = score >= 80 ? "great" : score >= 60 ? "ok" : score >= 40 ? "meh" : "low";
  const totalSeconds = components.totalDuration.seconds;
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  const durationLabel = `${mm}:${ss.toString().padStart(2, "0")}`;

  return (
    <div className={`quality-badge quality-${tone}`} aria-label={`Clone quality ${score} out of 100`}>
      <div className="quality-headline">
        <span className="score">{score}</span>
        <span className="of">/ 100</span>
        <span className="tone">{tone === "great" ? "Excellent clone" : tone === "ok" ? "Solid clone" : tone === "meh" ? "Could be better" : "Re-train recommended"}</span>
      </div>
      <ul className="quality-breakdown">
        <li>
          <span className="cmp-label">Samples</span>
          <span className="cmp-value">{components.sampleCount.value} <span className="cmp-target">/ {components.sampleCount.ideal} ideal</span></span>
          <span className="cmp-points">+{components.sampleCount.contribution}</span>
        </li>
        <li>
          <span className="cmp-label">Duration</span>
          <span className="cmp-value">{durationLabel} <span className="cmp-target">/ {Math.floor(components.totalDuration.idealMin / 60)}–{Math.floor(components.totalDuration.idealMax / 60)} min</span></span>
          <span className="cmp-points">+{components.totalDuration.contribution}</span>
        </li>
        <li>
          <span className="cmp-label">Format</span>
          <span className="cmp-value">{components.format.detected}</span>
          <span className="cmp-points">+{components.format.contribution}</span>
        </li>
        <li>
          <span className="cmp-label">Variety</span>
          <span className="cmp-value">{components.variety.uniqueFormats} unique</span>
          <span className="cmp-points">+{components.variety.contribution}</span>
        </li>
      </ul>
      {samples.length > 0 ? (
        <details className="quality-samples">
          <summary>{samples.length} sample{samples.length === 1 ? "" : "s"} probed</summary>
          <ul>
            {samples.map((s) => (
              <li key={s.filename}>
                <code>{s.filename}</code>
                {" · "}
                {s.format}
                {s.durationSec ? ` · ${Math.round(s.durationSec)}s` : ""}
                {s.sampleRate ? ` · ${(s.sampleRate / 1000).toFixed(1)}kHz` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {hint ? <p className="quality-hint">{hint}</p> : null}
    </div>
  );
}

/** Convert a File to a base64 string. Uses FileReader for safety on large files. */
function blobToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned non-string"));
        return;
      }
      // result is "data:<type>;base64,<payload>" — strip the prefix.
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(f);
  });
}
