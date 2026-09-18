// Author voice cloning UI. Upload audio samples, get the cloned voice id,
// optionally preview a short sample, and remove the clone. Renders a card
// the /profile page composes inside the existing layout.
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/lib/store";

export interface AuthorVoiceStatus {
  hasVoice: boolean;
  voiceId: string | null;
  status: "NONE" | "UPLOADING" | "CLONED" | "FAILED" | "REMOVED";
  sampleUrl: string | null;
  consentAt: string | null;
  failureReason: string | null;
}

const MAX_BYTES = 25 * 1024 * 1024;

export default function AuthorVoice() {
  const toast = useToastStore((s) => s.push);
  const [status, setStatus] = useState<AuthorVoiceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [voiceName, setVoiceName] = useState("");
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
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

  function pickFile(f: File | null) {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast(`File is ${Math.round(f.size / 1024 / 1024)}MB; max is 25MB`);
      return;
    }
    if (!/^audio\/(mpeg|mp3|wav|x-wav|mp4|x-m4a|aac)$/i.test(f.type) && !/\.(mp3|wav|m4a|mp4)$/i.test(f.name)) {
      toast("Pick an MP3, WAV or M4A audio file");
      return;
    }
    setFile(f);
  }

  async function upload() {
    if (!file) { toast("Pick an audio file first"); return; }
    if (voiceName.trim().length < 2) { toast("Give your voice a name"); return; }
    if (!consent) { toast("Tick the consent checkbox first"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/account/voice", {
        method: "POST",
        headers: {
          "content-type": file.type || "audio/mpeg",
          "x-voice-name": voiceName.trim().slice(0, 80),
          "x-voice-consent": "true"
        },
        body: file
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { voiceId: string; status: string };
      toast("Voice cloning — this takes ~30 seconds");
      setFile(null);
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

  async function remove() {
    if (!window.confirm("Remove your cloned voice? New narrations will fall back to a curated voice.")) return;
    setBusy(true);
    try {
      await apiFetch("/api/account/voice", { method: "DELETE" });
      toast("Your cloned voice has been removed");
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
          </p>
          {status?.sampleUrl ? (
            <audio controls preload="none" src={status.sampleUrl} className="voice-sample" />
          ) : null}
          <button type="button" className="btn ghost" onClick={() => void remove()} disabled={busy}>
            {busy ? "Removing…" : "Remove my voice"}
          </button>
        </div>
      ) : (
        <div className="empty">
          <p>
            Upload 1–5 minutes of your own speech and we&apos;ll clone it with ElevenLabs.
            Your voice will narrate every book you author — readers can still swap to a curated narrator if they prefer.
          </p>
          <ol className="instructions">
            <li>Record a quiet, varied sample (read aloud in different tones).</li>
            <li>Save as MP3, WAV, or M4A. Up to 25MB.</li>
            <li>Tick the consent box — we keep the audio + timestamp + IP as an audit trail.</li>
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

          <label className="field">
            <span>Audio sample</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <p className="hint">
                {file.name} · {Math.round(file.size / 1024)}KB
              </p>
            ) : null}
          </label>

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
              disabled={busy || !file || voiceName.trim().length < 2 || !consent}
            >
              {busy ? "Uploading…" : "Clone my voice"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
