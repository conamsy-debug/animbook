import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { BlurView } from "expo-blur";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, type BookSummary, type DreamProfile, type MemoryProfile, type PageRecord } from "../../src/api";
import { hapticFlip, hapticDream } from "../../src/haptics";
import { ensureNotificationPermission, registerNotificationHandler, scheduleDreamDriftLog } from "../../src/notifications";
import { fonts, palette, radii, spacing, verticalAccent } from "../../src/theme";

const { width: SCREEN_W } = Dimensions.get("window");

export default function ReaderScreen() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [book, setBook] = useState<BookSummary | null>(null);
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [memory, setMemory] = useState<MemoryProfile | null>(null);
  const [dreamProfile, setDreamProfile] = useState<DreamProfile | null>(null);
  const [dreamSessionId, setDreamSessionId] = useState<string | null>(null);

  // 3D flip animation value
  const flip = useRef(new Animated.Value(0)).current;

  // Register the notification handler once on mount.
  useEffect(() => {
    void (async () => {
      await registerNotificationHandler();
      const granted = await ensureNotificationPermission();
      if (granted) {
        // Honour the iOS / Android notification toggle.
      }
    })();
  }, []);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getBook(slug),
      api.getBookPages(slug),
      api.memory.get().catch(() => null),
      api.dream.profile(slug).catch(() => null)
    ])
      .then(([bookRes, pagesRes, memRes, dreamRes]) => {
        if (cancelled) return;
        setBook(bookRes);
        setPages(pagesRes.pages);
        if (memRes) setMemory(memRes.profile);
        if (dreamRes && dreamRes.active && dreamRes.profile) setDreamProfile(dreamRes.profile);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Open a DREAM session if the profile is active.
  useEffect(() => {
    if (!dreamProfile || !slug || dreamSessionId) return;
    api.dream
      .open(slug, dreamProfile.ambientTrack)
      .then((res) => {
        setDreamSessionId(res.session.id);
        void hapticDream();
        if (book?.title) void scheduleDreamDriftLog(book.title);
      })
      .catch(() => undefined);
  }, [dreamProfile, slug, dreamSessionId, book?.title]);

  // Close the DREAM session on unmount.
  useEffect(() => {
    return () => {
      if (!dreamSessionId) return;
      void api.dream.end(dreamSessionId, "reader_left", false).catch(() => undefined);
    };
  }, [dreamSessionId]);

  const isWellnessDream = !!dreamProfile;

  const currentPage = pages[pageIndex];

  function animateTo(direction: 1 | -1) {
    void hapticFlip();
    flip.setValue(0);
    Animated.timing(flip, {
      toValue: direction,
      duration: dreamProfile?.flipDurationMs ?? 540,
      useNativeDriver: true
    }).start(() => {
      setPageIndex((idx) => Math.max(0, Math.min(pages.length - 1, idx + direction)));
      flip.setValue(0);
    });
  }

  const frontInterpolate = flip.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });
  const backInterpolate = flip.interpolate({ inputRange: [-1, 0], outputRange: ["-180deg", "0deg"] });

  const pageWidth = Math.min(SCREEN_W - 32, 380);
  const pageHeight = pageWidth * 1.35;

  const paletteHint = isWellnessDream ? dreamProfile?.palette : memory?.palette;
  const motionScale = isWellnessDream ? dreamProfile?.motionLevel ?? 0.4 : memory?.motionLevel ?? 1;
  const fontSize = isWellnessDream ? dreamProfile?.fontSize ?? 22 : memory?.fontSize ?? 18;

  const cardStyle = useMemo(
    () => ({
      width: pageWidth,
      height: pageHeight,
      transform: [{ perspective: 1800 }, { scale: motionScale }]
    }),
    [pageWidth, pageHeight, motionScale]
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: palette.bg }]}>
        <ActivityIndicator color={palette.gold} size="large" />
        <Text style={styles.muted}>Opening the AnimBook…</Text>
      </View>
    );
  }
  if (error || !book) {
    return (
      <View style={[styles.center, { backgroundColor: palette.bg }]}>
        <Text style={styles.muted}>Could not open book · {error ?? "missing"}</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backLabel}>Back to library</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.shell, { backgroundColor: isWellnessDream ? "#0A0710" : palette.bg }]}>
      {isWellnessDream && (
        Platform.OS !== "web" ? (
          <BlurView intensity={60} tint="dark" style={styles.dreamBanner}>
            <View style={styles.dreamDot} />
            <Text style={styles.dreamText}>{dreamProfile?.caption}</Text>
          </BlurView>
        ) : (
          <View style={[styles.dreamBanner, { backgroundColor: "rgba(10, 18, 16, 0.92)" }]}>
            <View style={styles.dreamDot} />
            <Text style={styles.dreamText}>{dreamProfile?.caption}</Text>
          </View>
        )
      )}

      <View style={styles.bookHeader}>
        <Text style={[styles.label, { color: verticalAccent(book.vertical) }]}>{book.vertical} · {book.author}</Text>
        <Text style={styles.title}>{book.title}</Text>
      </View>

      <View style={styles.stage}>
        <Animated.View style={[styles.card, cardStyle, { transform: [...cardStyle.transform, { rotateY: frontInterpolate }] }]}>
          <View style={styles.cardInner}>
            {currentPage?.posterUrl ? (
              <Image source={{ uri: currentPage.posterUrl }} style={styles.poster} resizeMode="cover" />
            ) : (
              <View style={[styles.poster, { backgroundColor: palette.card, justifyContent: "center" }]}>
                <Text style={styles.muted} numberOfLines={3}>{currentPage?.chapter ?? book.title}</Text>
              </View>
            )}
            <View style={styles.body}>
              <Text style={[styles.bodyText, { fontSize, color: paletteHint === "cool" ? "#cfe7da" : palette.text }]}>
                {currentPage?.textExcerpt}
              </Text>
              <Text style={styles.chapter}>{currentPage?.chapter}</Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.card,
            cardStyle,
            {
              transform: [
                ...cardStyle.transform,
                { rotateY: backInterpolate },
                { translateX: -pageWidth / 2 }
              ],
              position: "absolute",
              opacity: 0.4
            }
          ]}
        >
          <View style={[styles.cardInner, { backgroundColor: palette.surface }]}>
            <Text style={styles.muted}>— AnimBook —</Text>
          </View>
        </Animated.View>
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={() => pageIndex > 0 && animateTo(-1)}
          disabled={pageIndex === 0}
          style={[styles.btn, pageIndex === 0 && { opacity: 0.3 }]}
        >
          <Text style={styles.btnLabel}>‹ Prev</Text>
        </Pressable>
        <Text style={styles.pageLabel}>
          {pageIndex + 1} / {pages.length}
        </Text>
        <Pressable
          onPress={() => pageIndex < pages.length - 1 && animateTo(1)}
          disabled={pageIndex >= pages.length - 1}
          style={[styles.btn, pageIndex >= pages.length - 1 && { opacity: 0.3 }]}
        >
          <Text style={styles.btnLabel}>Next ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  label: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase"
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 32,
    color: palette.text,
    marginTop: spacing.xs
  },
  muted: {
    color: palette.textMuted,
    fontSize: 13,
    fontFamily: fonts.mono,
    textAlign: "center",
    paddingHorizontal: spacing.lg
  },
  backBtn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border
  },
  backLabel: {
    color: palette.text,
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  bookHeader: {
    marginBottom: spacing.md
  },
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  card: {
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: "hidden",
    backfaceVisibility: "hidden"
  },
  cardInner: {
    flex: 1,
    padding: spacing.md
  },
  poster: {
    width: "100%",
    height: 220,
    borderRadius: radii.md,
    backgroundColor: palette.card,
    alignItems: "center",
    justifyContent: "center"
  },
  body: {
    flex: 1,
    paddingTop: spacing.md
  },
  bodyText: {
    color: palette.text,
    fontFamily: fonts.serif,
    lineHeight: 30
  },
  chapter: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    color: palette.textMuted,
    textTransform: "uppercase",
    marginTop: spacing.md
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginTop: spacing.lg
  },
  btn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.gold,
    alignItems: "center"
  },
  btnLabel: {
    color: palette.gold,
    fontFamily: fonts.mono,
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  pageLabel: {
    color: palette.text,
    fontFamily: fonts.mono,
    fontSize: 14
  },
  dreamBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: "rgba(10, 18, 16, 0.9)",
    borderWidth: 1,
    borderColor: palette.wellness,
    alignSelf: "center",
    marginBottom: spacing.md
  },
  dreamDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.wellness
  },
  dreamText: {
    color: palette.text,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  }
});