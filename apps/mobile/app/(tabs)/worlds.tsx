import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { useRouter } from "expo-router";
import { api } from "../../src/api";
import { fonts, palette, radii, spacing, verticalAccent } from "../../src/theme";

interface WorldItem {
  id: string;
  slug: string;
  name: string;
  synopsis: string;
  accentColor: string;
}

export default function WorldsTab() {
  const router = useRouter();
  const [items, setItems] = useState<WorldItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listWorlds()
      .then((res) => setItems(res.items ?? []))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={styles.label}>AnimBook next-gen</Text>
      <Text style={styles.h1}>Worlds</Text>
      <Text style={styles.muted}>
        Shared-character universes. Read the books in any order — characters cross over.
      </Text>

      {loading && <ActivityIndicator color={palette.gold} style={{ marginTop: spacing.xl }} />}
      {error && <Text style={[styles.muted, { color: palette.error, marginTop: spacing.lg }]}>Offline · {error}</Text>}

      {items.map((world) => (
        <Pressable
          key={world.id}
          onPress={() => router.push(`/worlds/${world.slug}`)}
          style={({ pressed }) => [styles.worldCard, { opacity: pressed ? 0.7 : 1, borderColor: world.accentColor ?? palette.gold }]}
        >
          <Text style={[styles.label, { color: world.accentColor ?? palette.gold }]}>{world.name}</Text>
          <Text style={styles.h3}>An AnimBook universe</Text>
          <Text style={styles.muted}>{world.synopsis}</Text>
        </Pressable>
      ))}

      {items.length === 0 && !loading && (
        <Text style={styles.muted}>No worlds yet. The flagship — Lagos Nights — appears once the seed runs.</Text>
      )}
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
    fontSize: 40,
    color: palette.text,
    marginVertical: spacing.xs
  },
  h3: {
    fontFamily: fonts.serif,
    fontSize: 22,
    color: palette.text,
    marginVertical: spacing.xs
  },
  muted: {
    color: palette.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md
  },
  worldCard: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    marginTop: spacing.lg
  }
});

const _verticalAccent = verticalAccent;
void _verticalAccent;