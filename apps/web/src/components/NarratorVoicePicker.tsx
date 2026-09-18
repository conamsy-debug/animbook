// Narrator voice picker for Studio. Lists curated voices + the author's
// own clone when one exists, persists the choice via the Studio route and
// optionally re-queues narration so every page re-renders in the new voice.
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export interface NarratorVoice {
  id: string;
  label: string;
  description: string;
  isAuthor: boolean;
  elevenVoiceId: string;
}

export interface NarratorVoicePickerProps {
  projectId: string;
  onSaved?: () => void;
}

interface NarratorVoicePayload {
  voices: NarratorVoice[];
  selectedVoiceId: string | null;
  hasClone: boolean;
}

export default function NarratorVoicePicker({ projectId, onSaved }: NarratorVoicePickerProps) {
  const [voices, setVoices] = useState<NarratorVoice[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hasClone, setHasClone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reNarrate, setReNarrate] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await apiFetch<NarratorVoicePayload>(`/api/studio/projects/${encodeURIComponent(projectId)}/narrator-voice`);
        if (cancelled) return;
        setVoices(data.voices);
        setSelected(data.selectedVoiceId);
        setHasClone(data.hasClone);
      } catch {
        setVoices([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [projectId]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      await apiFetch(`/api/studio/projects/${encodeURIComponent(projectId)}/narrator-voice`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceId: selected, reNarrate })
      });
      if (onSaved) onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="hint">Loading narrator options…</p>;
  if (voices.length === 0) return <p className="hint">No voices available — check the integrations panel.</p>;

  return (
    <div className="narrator-picker">
      {!hasClone ? (
        <p className="hint muted small" style={{ marginTop: 0 }}>
          You don&apos;t have a cloned voice yet. Open your <a href="/profile">profile</a> to upload audio samples
          and a &quot;By [Your Name]&quot; option will appear here.
        </p>
      ) : null}
      <div className="voice-list">
        {voices.map((v) => (
          <label key={v.id} className={`voice-option ${v.isAuthor ? "author" : ""} ${selected === v.id ? "selected" : ""}`}>
            <input
              type="radio"
              name="narratorVoice"
              value={v.id}
              checked={selected === v.id}
              onChange={() => setSelected(v.id)}
            />
            <div>
              <strong>{v.label}</strong>
              <p>{v.description}</p>
              {v.isAuthor && hasClone ? <span className="voice-tag">Your voice</span> : null}
            </div>
          </label>
        ))}
      </div>

      <label className="renarrate">
        <input type="checkbox" checked={reNarrate} onChange={(e) => setReNarrate(e.target.checked)} />
        <span>Re-narrate every page in the new voice (clears cached audio).</span>
      </label>

      <div className="panel-actions">
        <button
          type="button"
          className="btn"
          onClick={() => void save()}
          disabled={saving || !selected || selected === ""}
        >
          {saving ? "Saving…" : "Save narrator voice"}
        </button>
      </div>
    </div>
  );
}
