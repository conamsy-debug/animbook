import { useEffect, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/lib/store";

interface MemoryProfile {
  palette: string;
  pacing: string;
  cameraStyle: string;
  narrationSpeed: number;
  fontSize: number;
  motionLevel: number;
  lensEnabled: boolean;
  echoEnabled: boolean;
}

const presets = [
  { id: "default", label: "Default", description: "Standard AnimBook pacing." },
  { id: "calm", label: "Calm", description: "Slower pacing, low motion, cool palette." },
  { id: "playful", label: "Playful", description: "Brisk pacing, warm palette, more motion." },
  { id: "study", label: "Study", description: "Focused pacing, larger text, graphite palette." },
  { id: "immersive", label: "Immersive", description: "Leisurely pacing, neon palette, full motion." }
];

const palettes = [
  { id: "default", label: "Default", swatch: "#C49A1C" },
  { id: "cool", label: "Cool", swatch: "#14818E" },
  { id: "warm", label: "Warm", swatch: "#D9872A" },
  { id: "graphite", label: "Graphite", swatch: "#56738A" },
  { id: "neon", label: "Neon", swatch: "#9D4C73" }
];

export default function MemoryPage() {
  const [profile, setProfile] = useState<MemoryProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToastStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ profile: MemoryProfile }>("/api/memory/settings");
        if (!cancelled) setProfile(res.profile);
      } catch (err) {
        if (!cancelled) toast(`Could not load memory: ${(err as Error).message}`);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  async function update(patch: Partial<MemoryProfile>) {
    if (!profile) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ profile: MemoryProfile }>("/api/memory/settings", {
        method: "PUT",
        json: { ...profile, ...patch }
      });
      setProfile(res.profile);
    } catch (err) {
      toast(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <div className="empty-state">Loading your AnimBook memory…</div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header className="section-header">
          <div className="left">
            <span className="dot" style={{ background: "#9A6EBC" }} />
            <h1>AnimBook Memory</h1>
          </div>
          <span className="label">{saving ? "Saving…" : "Saved"}</span>
        </header>

        <section className="card">
          <h3>Presets</h3>
          <p className="muted">One-tap personality profiles. Pick the closest feel and tune from there.</p>
          <div className="grid">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="card"
                style={{ alignItems: "flex-start", textAlign: "left", borderColor: profile.pacing === preset.id ? "#9A6EBC" : undefined }}
                onClick={() => {
                  const id = preset.id as keyof typeof PRESET_OVERRIDES;
                  const override = PRESET_OVERRIDES[id];
                  if (override) void update(override);
                }}
              >
                <span className="by">Preset</span>
                <h3 style={{ marginTop: 6 }}>{preset.label}</h3>
                <p className="muted">{preset.description}</p>
              </button>
            ))}
          </div>
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#14818E" }} />
              <h2>Tuning</h2>
            </div>
          </header>

          <div className="grid">
            <div className="card">
              <span className="label">Palette</span>
              <div className="swatches" style={{ marginTop: 12 }}>
                {palettes.map((palette) => (
                  <button
                    key={palette.id}
                    type="button"
                    aria-label={palette.label}
                    className="swatch"
                    style={{
                      background: palette.swatch,
                      borderColor: profile.palette === palette.id ? "var(--text)" : "var(--border)",
                      borderWidth: profile.palette === palette.id ? 2 : 1,
                      cursor: "pointer"
                    }}
                    onClick={() => update({ palette: palette.id })}
                  />
                ))}
              </div>
              <p className="muted" style={{ marginTop: 8 }}>Current: {profile.palette}</p>
            </div>

            <div className="card">
              <span className="label">Narration speed</span>
              <h3 style={{ marginTop: 6 }}>{profile.narrationSpeed.toFixed(2)}×</h3>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.05}
                value={profile.narrationSpeed}
                onChange={(e) => update({ narrationSpeed: Number(e.target.value) })}
              />
            </div>

            <div className="card">
              <span className="label">Motion level</span>
              <h3 style={{ marginTop: 6 }}>{profile.motionLevel.toFixed(2)}×</h3>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={profile.motionLevel}
                onChange={(e) => update({ motionLevel: Number(e.target.value) })}
              />
            </div>

            <div className="card">
              <span className="label">Font size</span>
              <h3 style={{ marginTop: 6 }}>{profile.fontSize}px</h3>
              <input
                type="range"
                min={14}
                max={36}
                step={1}
                value={profile.fontSize}
                onChange={(e) => update({ fontSize: Number(e.target.value) })}
              />
            </div>

            <div className="card">
              <span className="label">Feature flags</span>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                <input type="checkbox" checked={profile.lensEnabled} onChange={(e) => update({ lensEnabled: e.target.checked })} style={{ width: 18, height: 18 }} />
                <span>AnimBook LENS (first-person)</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                <input type="checkbox" checked={profile.echoEnabled} onChange={(e) => update({ echoEnabled: e.target.checked })} style={{ width: 18, height: 18 }} />
                <span>AnimBook ECHO (haptics)</span>
              </label>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

const PRESET_OVERRIDES: Record<string, Partial<{ palette: string; pacing: string; narrationSpeed: number; motionLevel: number; fontSize: number }>> = {
  default: { palette: "default", pacing: "default", narrationSpeed: 1, motionLevel: 1, fontSize: 18 },
  calm: { palette: "cool", pacing: "leisurely", narrationSpeed: 0.85, motionLevel: 0.7, fontSize: 18 },
  playful: { palette: "warm", pacing: "brisk", narrationSpeed: 1.1, motionLevel: 1.3, fontSize: 18 },
  study: { palette: "graphite", pacing: "focused", narrationSpeed: 1, motionLevel: 0.5, fontSize: 20 },
  immersive: { palette: "neon", pacing: "leisurely", narrationSpeed: 0.95, motionLevel: 1, fontSize: 18 }
};