import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { api, type DreamSession } from "../../src/api";
import { fonts, palette, radii, spacing } from "../../src/theme";

export default function DreamTab() {
  const [sessions, setSessions] = useState<DreamSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.dream
      .listSessions()
      .then((res) => setSessions(res.items ?? []))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const totalSessions = sessions.length;
  const fellAsleep = sessions.filter((s) => s.fellAsleepAt).length;
  const totalPages = sessions.reduce((sum, s) => sum + s.pagesRead, 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={styles.label}>AnimBook DREAM</Text>
      <Text style={styles.h1}>Sleep-mode drift log</Text>
      <Text style={styles.muted}>
        The AnimBook sleep-mode. Open any WELLNESS vertical AnimBook and the Reader auto-applies a softer palette,
        slower narration, and a looping ambient track. Twenty minutes of stillness counts as falling asleep.
      </Text>

      <View style={styles.statRow}>
        <Stat value={String(totalSessions)} label="Sessions" />
        <Stat value={String(fellAsleep)} label="Fell asleep" />
        <Stat value={String(totalPages)} label="Pages in DREAM" />
      </View>

      {loading && <ActivityIndicator color={palette.wellness} style={{ marginTop: spacing.xl }} />}
      {error && <Text style={[styles.muted, { color: palette.error, marginTop: spacing.lg }]}>Offline · {error}</Text>}

      {sessions.map((s) => (
        <View key={s.id} style={styles.sessionCard}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={[styles.label, { color: palette.wellness }]}>{s.ambientTrack.replace("_", " ")}</Text>
            <Text style={styles.muted}>{new Date(s.startedAt).toLocaleString()}</Text>
          </View>
          <Text style={styles.sessionTitle}>{s.bookId}</Text>
          <Text style={styles.muted}>
            Pages read: {s.pagesRead} · {s.endedAt ? "closed" : "in progress"}
          </Text>
          {s.fellAsleepAt && (
            <Text style={[styles.label, { color: palette.wellness, marginTop: spacing.xs }]}>
              Fell asleep at {new Date(s.fellAsleepAt).toLocaleTimeString()}
            </Text>
          )}
          {s.exitReason && <Text style={styles.muted}>exit: {s.exitReason}</Text>}
        </View>
      ))}

      {sessions.length === 0 && !loading && (
        <Pressable
          onPress={() => {
            void api.dream.open("the-sleeping-coast", "ocean_waves").catch(() => undefined);
          }}
          style={styles.cta}
        >
          <Text style={styles.ctaText}>Open a DREAM session on The Sleeping Coast</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
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
    fontSize: 36,
    color: palette.text,
    marginVertical: spacing.xs
  },
  muted: {
    color: palette.textMuted,
    fontSize: 13,
    lineHeight: 18
  },
  statRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginVertical: spacing.lg
  },
  stat: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border
  },
  statValue: {
    fontFamily: fonts.serif,
    fontSize: 28,
    color: palette.wellness
  },
  statLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: palette.textMuted,
    textTransform: "uppercase",
    marginTop: spacing.xs
  },
  sessionCard: {
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.md
  },
  sessionTitle: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: palette.text,
    marginVertical: spacing.xs
  },
  cta: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.wellness,
    marginTop: spacing.lg
  },
  ctaText: {
    color: palette.wellness,
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    textAlign: "center"
  }
});