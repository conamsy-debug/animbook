import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View
} from "react-native";
import { api, type MemoryProfile } from "../../src/api";
import { fonts, palette, radii, spacing } from "../../src/theme";

const PRESETS: { id: string; label: string; patch: Partial<MemoryProfile> }[] = [
  { id: "default", label: "Default", patch: {} },
  { id: "calm", label: "Calm", patch: { pacing: "leisurely", narrationSpeed: 0.85, motionLevel: 0.7, palette: "cool" } },
  { id: "playful", label: "Playful", patch: { pacing: "brisk", narrationSpeed: 1.1, motionLevel: 1.3, palette: "warm" } },
  { id: "study", label: "Study", patch: { pacing: "focused", narrationSpeed: 1.0, fontSize: 20, palette: "graphite" } },
  { id: "immersive", label: "Immersive", patch: { pacing: "leisurely", narrationSpeed: 0.95, motionLevel: 1.0, palette: "neon" } }
];

export default function MemoryTab() {
  const [profile, setProfile] = useState<MemoryProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.memory.get();
      setProfile(res.profile);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function applyPreset(preset: typeof PRESETS[number]) {
    setSaving(true);
    try {
      const res = await api.memory.update(preset.patch);
      setProfile(res.profile);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleLens(enabled: boolean) {
    if (!profile) return;
    setSaving(true);
    try {
      const res = await api.memory.update({ lensEnabled: enabled });
      setProfile(res.profile);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleEcho(enabled: boolean) {
    if (!profile) return;
    setSaving(true);
    try {
      const res = await api.memory.update({ echoEnabled: enabled });
      setProfile(res.profile);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={styles.label}>AnimBook MEMORY</Text>
      <Text style={styles.h1}>Your reading profile</Text>
      <Text style={styles.muted}>
        Memory captures palette, pacing, narration speed, motion level, and the Lens / Echo toggles.
        Pick a preset to set the tone.
      </Text>

      {loading && <ActivityIndicator color={palette.gold} style={{ marginTop: spacing.xl }} />}
      {error && <Text style={[styles.muted, { color: palette.error, marginTop: spacing.lg }]}>Offline · {error}</Text>}

      {profile && (
        <>
          <View style={styles.statGrid}>
            <Stat label="palette" value={profile.palette} />
            <Stat label="pacing" value={profile.pacing} />
            <Stat label="narration" value={`${(profile.narrationSpeed * 100).toFixed(0)}%`} />
            <Stat label="motion" value={`${(profile.motionLevel * 100).toFixed(0)}%`} />
            <Stat label="font" value={`${profile.fontSize}px`} />
            <Stat label="camera" value={profile.cameraStyle} />
          </View>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>Presets</Text>
          <View style={styles.presetRow}>
            {PRESETS.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => applyPreset(p)}
                disabled={saving}
                style={({ pressed }) => [
                  styles.preset,
                  {
                    borderColor: pressed ? palette.gold : palette.border,
                    backgroundColor: pressed ? palette.surface : palette.bg
                  }
                ]}
              >
                <Text style={styles.presetLabel}>{p.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>Toggles</Text>
          <View style={styles.toggleRow}>
            <View style={styles.toggleItem}>
              <Text style={styles.toggleTitle}>Lens</Text>
              <Text style={styles.muted}>First-person view (you are the narrator).</Text>
              <Switch
                value={profile.lensEnabled}
                onValueChange={toggleLens}
                trackColor={{ true: palette.gold, false: palette.border }}
              />
            </View>
            <View style={styles.toggleItem}>
              <Text style={styles.toggleTitle}>Echo</Text>
              <Text style={styles.muted}>Haptic pulse on each page flip.</Text>
              <Switch
                value={profile.echoEnabled}
                onValueChange={toggleEcho}
                trackColor={{ true: palette.gold, false: palette.border }}
              />
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.4,
    color: palette.textMuted,
    textTransform: "uppercase"
  },
  h1: {
    fontFamily: fonts.serif,
    fontSize: 40,
    color: palette.text,
    marginVertical: spacing.xs
  },
  muted: {
    color: palette.textMuted,
    fontSize: 13,
    lineHeight: 18
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg
  },
  stat: {
    flexBasis: "31%",
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border
  },
  statValue: {
    fontFamily: fonts.serif,
    fontSize: 22,
    color: palette.gold,
    textTransform: "capitalize"
  },
  statLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: palette.textMuted,
    textTransform: "uppercase",
    marginTop: spacing.xs
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md
  },
  preset: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1
  },
  presetLabel: {
    color: palette.text,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  toggleRow: {
    marginTop: spacing.md,
    gap: spacing.md
  },
  toggleItem: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border
  },
  toggleTitle: {
    color: palette.text,
    fontFamily: fonts.serif,
    fontSize: 20,
    marginBottom: spacing.xs
  }
});