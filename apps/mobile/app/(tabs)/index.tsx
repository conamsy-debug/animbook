import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import { api, type BookSummary } from "../../src/api";
import { hapticLight } from "../../src/haptics";
import { fonts, palette, radii, spacing, verticalAccent } from "../../src/theme";

const VERTICAL_FILTERS = ["ALL", "CONSUMER", "KIDS", "EDU", "FAITH", "VERSE", "WELLNESS", "TRAVEL", "ORIGINALS"];

export default function LibraryTab() {
  const router = useRouter();
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [filter, setFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await api.listBooks();
      setBooks(res.items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = filter === "ALL" ? books : books.filter((b) => b.vertical === filter);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={palette.gold} />}
    >
      <View style={styles.brandRow}>
        <View>
          <Text style={styles.label}>AnimBook · mobile</Text>
          <Text style={styles.h1}>The Library</Text>
        </View>
        {Platform.OS !== "web" ? (
          <BlurView intensity={50} tint="dark" style={styles.brandPill}>
            <Text style={styles.brandPillText}>{books.length} books</Text>
          </BlurView>
        ) : (
          <View style={[styles.brandPill, { backgroundColor: palette.surface }]}>
            <Text style={styles.brandPillText}>{books.length} books</Text>
          </View>
        )}
      </View>
      <Text style={styles.muted}>
        A book that moves. Pick any title to open the Reader.
      </Text>

      <View style={styles.filterRow}>
        <FlatList
          data={VERTICAL_FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(v) => v}
          contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.md }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setFilter(item)}
              style={{
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radii.pill,
                backgroundColor: filter === item ? palette.gold : palette.surface,
                borderWidth: 1,
                borderColor: filter === item ? palette.gold : palette.border
              }}
            >
              <Text
                style={{
                  color: filter === item ? palette.bg : palette.text,
                  fontFamily: fonts.mono,
                  fontSize: 10,
                  letterSpacing: 1.4,
                  textTransform: "uppercase"
                }}
              >
                {item}
              </Text>
            </Pressable>
          )}
        />
      </View>

      {loading && <ActivityIndicator color={palette.gold} style={{ marginTop: spacing.xl }} />}
      {error && <Text style={[styles.muted, { color: palette.error, marginTop: spacing.lg }]}>Offline · {error}</Text>}

      {filtered.map((book) => (
        <Pressable
          key={book.id}
          onPress={() => {
            void hapticLight();
            router.push(`/read/${book.slug}`);
          }}
          style={({ pressed }) => [
            styles.bookRow,
            { opacity: pressed ? 0.7 : 1 }
          ]}
        >
          <View style={styles.cover}>
            {book.coverUrl ? (
              <Image source={{ uri: book.coverUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
            ) : (
              <Text style={{ color: palette.textMuted, fontFamily: fonts.mono, fontSize: 11, textAlign: "center", padding: spacing.sm }}>{book.title}</Text>
            )}
          </View>
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text style={[styles.by, { color: verticalAccent(book.vertical) }]}>
              {book.vertical} · {book.author}
            </Text>
            <Text style={styles.h3}>{book.title}</Text>
            <Text style={styles.muted} numberOfLines={3}>
              {book.synopsis}
            </Text>
            <Text style={styles.label}>{book.totalPages} pages</Text>
          </View>
        </Pressable>
      ))}
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
    lineHeight: 18
  },
  by: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  filterRow: {
    marginTop: spacing.md
  },
  bookRow: {
    flexDirection: "row",
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.md
  },
  cover: {
    width: 96,
    height: 144,
    borderRadius: radii.md,
    backgroundColor: palette.card,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center"
  },
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: spacing.sm
  },
  brandPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: "hidden"
  },
  brandPillText: {
    color: palette.text,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase"
  }
});