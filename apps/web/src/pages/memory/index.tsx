// AnimBook Memory — reader's adaptive profile. The Reader pulls this on
// every page flip and applies palette / pacing / narration speed / motion
// level / font size / feature flags. The page lets the reader pick a
// preset OR tweak individual dials, then saves to /api/memory/settings.
// Adaptive tuning (signal-driven) is wired in via /api/memory/adapt.
import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";
import { useResilientFetch } from "@/lib/useResilientFetch";
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

/**
 * Preset definitions. Each preset is a bag of values that together
 * produce a recognisable reading feel. The page derives the active
 * preset from the live profile (so the highlight stays correct after
 * the user nudges a slider) and applies the preset by writing all five
 * dials + palette in one PUT.
 */
const PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  values: Pick<MemoryProfile, "palette" | "pacing" | "narrationSpeed" | "motionLevel" | "fontSize">;
}> = [
  {
    id: "default",
    label: "Default",
    description: "Standard AnimBook pacing.",
    values: { palette: "default", pacing: "default", narrationSpeed: 1, motionLevel: 1, fontSize: 18 }
  },
  {
    id: "calm",
    label: "Calm",
    description: "Slower pacing, low motion, cool palette.",
    values: { palette: "cool", pacing: "leisurely", narrationSpeed: 0.85, motionLevel: 0.7, fontSize: 18 }
  },
  {
    id: "playful",
    label: "Playful",
    description: "Brisk pacing, warm palette, more motion.",
    values: { palette: "warm", pacing: "brisk", narrationSpeed: 1.1, motionLevel: 1.3, fontSize: 18 }
  },
  {
    id: "study",
    label: "Study",
    description: "Focused pacing, larger text, graphite palette.",
    values: { palette: "graphite", pacing: "focused", narrationSpeed: 1, motionLevel: 0.5, fontSize: 20 }
  },
  {
    id: "immersive",
    label: "Immersive",
    description: "Leisurely pacing, neon palette, full motion.",
    values: { palette: "neon", pacing: "leisurely", narrationSpeed: 0.95, motionLevel: 1.2, fontSize: 18 }
  }
];

const PALETTES: Array<{ id: string; label: string; swatch: string }> = [
  { id: "default", label: "Default", swatch: "#C49A1C" },
  { id: "cool", label: "Cool", swatch: "#14818E" },
  { id: "warm", label: "Warm", swatch: "#D9872A" },
  { id: "graphite", label: "Graphite", swatch: "#56738A" },
  { id: "neon", label: "Neon", swatch: "#9D4C73" }
];

/**
 * Determine which preset a given profile matches. Profiles are
 * considered to "match" a preset when every dial is within tolerance of
 * the preset's value. Returns null if no preset matches cleanly (i.e. the
 * user has nudged dials into a custom mix).
 */
function detectActivePreset(profile: MemoryProfile): string | null {
  const tol = {
    narrationSpeed: 0.05,
    motionLevel: 0.10,
    fontSize: 2
  };
  for (const preset of PRESETS) {
    const v = preset.values;
    if (profile.palette !== v.palette) continue;
    if (profile.pacing !== v.pacing) continue;
    if (Math.abs(profile.narrationSpeed - v.narrationSpeed) > tol.narrationSpeed) continue;
    if (Math.abs(profile.motionLevel - v.motionLevel) > tol.motionLevel) continue;
    if (Math.abs(profile.fontSize - v.fontSize) > tol.fontSize) continue;
    return preset.id;
  }
  return null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export default function MemoryPage() {
  const [profile, setProfile] = useState<MemoryProfile | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const toast = useToastStore((s) => s.push);

  // 8s timeout + 4s stuck hint so a slow API never traps the user on
  // "Loading your AnimBook memory…" forever. The toast below handles
  // the error message; the hook handles the timeouts.
  const { data, loading, stuck, retry } = useResilientFetch<{ profile: MemoryProfile }>(
    "/api/memory/settings",
    { tag: "[MEMORY]", toastOnError: false }
  );

  useEffect(() => {
    if (data) setProfile(data.profile);
  }, [data]);

  // Reset "saved" pill to idle after 1.6s so it doesn't linger.
  useEffect(() => {
    if (saveState !== "saved") return;
    const t = window.setTimeout(() => setSaveState("idle"), 1600);
    return () => window.clearTimeout(t);
  }, [saveState]);

  async function update(patch: Partial<MemoryProfile>) {
    if (!profile) return;
    setSaveState("saving");
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ profile: MemoryProfile }>("/api/memory/settings", {
        method: "PUT",
        json: { ...profile, ...patch }
      });
      setProfile(res.profile);
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      setErrorMsg((err as Error).message);
      toast(`Save failed: ${(err as Error).message}`);
    }
  }

  async function applyPreset(presetId: string) {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    await update(preset.values);
  }

  async function resetDefaults() {
    await applyPreset("default");
  }

  const activePresetId = useMemo(() => (profile ? detectActivePreset(profile) : null), [profile]);

  if (!profile) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <div className="empty-state">
            {loading ? "Loading your AnimBook memory…" : "Memory offline."}
            {stuck && loading && (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    if (typeof window !== "undefined") window.location.reload();
                  }}
                >
                  Still loading? Tap to retry.
                </button>
              </div>
            )}
            {!loading && (
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn primary" onClick={retry}>
                  Retry
                </button>
              </div>
            )}
          </div>
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
            <span className="muted" style={{ marginLeft: 8, fontSize: "0.85rem" }}>
              Your reader profile — drives palette, pacing and the Reader controls.
            </span>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {errorMsg ? <span className="memory-save-state error" title={errorMsg}>Save failed</span> : null}
            <span className={`memory-save-state ${saveState === "idle" ? "saved" : saveState}`}>
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Error" : "Synced"}
            </span>
          </div>
        </header>

        <section className="card">
          <h3>Presets</h3>
          <p className="muted">
            One-tap personality profiles. Pick the closest feel and tune from there — the active preset auto-detects from your live dials.
          </p>
          <div className="memory-presets">
            {PRESETS.map((preset) => {
              const selected = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`preset${selected ? " selected" : ""}`}
                  onClick={() => void applyPreset(preset.id)}
                  aria-pressed={selected}
                  data-active={selected ? "true" : undefined}
                >
                  <span className="preset-label">{selected ? "Active preset" : "Preset"}</span>
                  <span className="preset-title">{preset.label}</span>
                  <span className="preset-desc">{preset.description}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#14818E" }} />
              <h2>Tuning</h2>
            </div>
          </header>

          <div className="memory-presets">
            <div className="tuning-card">
              <span className="label">Palette</span>
              <div className="swatches" role="radiogroup" aria-label="Palette">
                {PALETTES.map((palette) => {
                  const selected = profile.palette === palette.id;
                  return (
                    <button
                      key={palette.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={palette.label}
                      title={palette.label}
                      className={`swatch${selected ? " selected" : ""}`}
                      style={{ background: palette.swatch }}
                      onClick={() => void update({ palette: palette.id })}
                    />
                  );
                })}
              </div>
              <p className="muted" style={{ marginTop: 8, fontSize: "0.85rem" }}>
                Current: <strong>{PALETTES.find((p) => p.id === profile.palette)?.label ?? profile.palette}</strong>
              </p>
            </div>

            <div className="tuning-card">
              <span className="label">Narration speed</span>
              <span className="value">{profile.narrationSpeed.toFixed(2)}×</span>
              <input
                type="range"
                aria-label="Narration speed"
                min={0.5}
                max={1.5}
                step={0.05}
                value={profile.narrationSpeed}
                onChange={(e) => void update({ narrationSpeed: Number(e.target.value) })}
              />
            </div>

            <div className="tuning-card">
              <span className="label">Motion level</span>
              <span className="value">{profile.motionLevel.toFixed(2)}×</span>
              <input
                type="range"
                aria-label="Motion level"
                min={0}
                max={2}
                step={0.1}
                value={profile.motionLevel}
                onChange={(e) => void update({ motionLevel: Number(e.target.value) })}
              />
            </div>

            <div className="tuning-card">
              <span className="label">Font size</span>
              <span className="value">{profile.fontSize}px</span>
              <input
                type="range"
                aria-label="Font size"
                min={14}
                max={36}
                step={1}
                value={profile.fontSize}
                onChange={(e) => void update({ fontSize: Number(e.target.value) })}
              />
            </div>

            <div className="tuning-card">
              <span className="label">Feature flags</span>
              <label className="flag-row">
                <input
                  type="checkbox"
                  checked={profile.lensEnabled}
                  onChange={(e) => void update({ lensEnabled: e.target.checked })}
                />
                <span>AnimBook LENS (first-person)</span>
              </label>
              <label className="flag-row">
                <input
                  type="checkbox"
                  checked={profile.echoEnabled}
                  onChange={(e) => void update({ echoEnabled: e.target.checked })}
                />
                <span>AnimBook ECHO (haptics)</span>
              </label>
            </div>

            <div className="tuning-card">
              <span className="label">Reset</span>
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                Restore the default preset. Use this if your tweaks have drifted and you want to start over.
              </p>
              <button
                type="button"
                className="btn ghost"
                onClick={() => void resetDefaults()}
                style={{ alignSelf: "flex-start" }}
              >
                Reset to defaults
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
