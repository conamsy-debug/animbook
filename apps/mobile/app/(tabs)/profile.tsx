import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { api } from "../../src/api";
import { hapticLight, hapticSuccess } from "../../src/haptics";
import {
  cancelAll,
  cancelScheduled,
  ensureNotificationPermission,
  listScheduled,
  notificationsAvailable,
  scheduleDailyReadingReminder
} from "../../src/notifications";
import { fonts, palette, radii, spacing } from "../../src/theme";

export default function ProfileTab() {
  const [base, setBase] = useState<string>(api.baseUrl());
  const [health, setHealth] = useState<string>("…");
  const [permission, setPermission] = useState<string>(notificationsAvailable() ? "… checking" : "web");
  const [scheduledCount, setScheduledCount] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  async function refreshPermissions() {
    if (!notificationsAvailable()) {
      setPermission("web");
      setScheduledCount(0);
      return;
    }
    const granted = await ensureNotificationPermission();
    setPermission(granted ? "granted" : "denied");
    const list = await listScheduled();
    setScheduledCount(Array.isArray(list) ? list.length : 0);
  }

  useEffect(() => {
    api
      .health()
      .then((res) => setHealth(`${res.status} · ${res.service}`))
      .catch((err) => setHealth(`offline · ${(err as Error).message}`));
    void refreshPermissions();
  }, []);

  async function onScheduleReminder() {
    if (!notificationsAvailable()) return;
    setBusy(true);
    try {
      await scheduleDailyReadingReminder();
      void hapticSuccess();
      await refreshPermissions();
    } finally {
      setBusy(false);
    }
  }

  async function onCancelAll() {
    if (!notificationsAvailable()) return;
    setBusy(true);
    try {
      await cancelAll();
      void hapticLight();
      await refreshPermissions();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={styles.label}>AnimBook</Text>
      <Text style={styles.h1}>Profile</Text>
      <Text style={styles.muted}>
        The mobile shell is a thin client over the AnimBook API. Configure EXPO_PUBLIC_API_URL at build time
        to point at a different environment.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>API</Text>
        <Text style={styles.value}>{base}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Health</Text>
        <Text style={styles.value}>{health}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Phase</Text>
        <Text style={styles.value}>Phase 8 · mobile polish</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>14 of 14 next-gen</Text>
        <Text style={[styles.value, { fontFamily: fonts.serif, fontSize: 18, lineHeight: 24 }]}>
          MEMORY · ORACLE · LENS · ECHO · LIVE · LIVE TRANSLATION · DREAM · WORLDS · STAGE · SIGNAL · NETWORK · ARCHIVE · SCHOOL · STUDIO PRO
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Notifications</Text>
        <Text style={styles.value}>permission: {permission}</Text>
        <Text style={styles.value}>scheduled: {scheduledCount}</Text>
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
          <Pressable
            onPress={onScheduleReminder}
            disabled={busy || permission === "web"}
            style={({ pressed }) => [styles.cta, { opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.ctaText}>Daily reminder</Text>
          </Pressable>
          <Pressable
            onPress={onCancelAll}
            disabled={busy || permission === "web"}
            style={({ pressed }) => [styles.cta, { opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.ctaText}>Cancel all</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Deep links</Text>
        <Text style={styles.value}>animbook://read/&lt;slug&gt;</Text>
        <Text style={styles.value}>animbook://companion/&lt;slug&gt;</Text>
        <Text style={styles.value}>animbook://dream</Text>
        <Text style={styles.value}>animbook://memory</Text>
      </View>

      <ActivityIndicator color={palette.gold} style={{ marginTop: spacing.lg }} />
    </ScrollView>
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
    lineHeight: 18,
    marginBottom: spacing.md
  },
  card: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    marginTop: spacing.sm
  },
  value: {
    color: palette.text,
    fontFamily: fonts.mono,
    fontSize: 14,
    marginTop: spacing.xs
  },
  cta: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.gold,
    alignItems: "center"
  },
  ctaText: {
    color: palette.gold,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  }
});