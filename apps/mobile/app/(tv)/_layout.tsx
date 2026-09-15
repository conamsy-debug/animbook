/**
 * AnimBook mobile — Apple TV layout.
 *
 * Mirrors the standalone `apps/tv` web shell but inside the Expo source
 * tree, so when the user runs `expo run:ios --device "Apple TV"` on a
 * Mac, the focus-driven UI ships as a native tvOS app.
 *
 * The focus engine:
 *   - On tvOS native, `react-native-tvos` exposes `TVFocusGuideView` +
 *     `useFocusable` from `@noriginmedia/react-native-tvos-parallax-carousel`.
 *   - On web, we fall back to a CSS / DOM focus ring driven by the
 *     `useFocusGroup` hook (rotated here as `useTvFocus`).
 *
 * Both paths emit a `focused` boolean the focusable child can read to
 * scale + glow.
 */
import { useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { api, type BookSummary } from "../../src/api";
import { fonts, palette, radii, spacing } from "../../src/theme";

interface FocusState {
  index: number;
  register(el: HTMLElement | null): void;
  focusFirst(): void;
}

function useTvFocus(selector: string): FocusState {
  const [index, setIndex] = useState(0);
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!root) return;
    const getItems = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector));
    const items = getItems();
    if (items.length === 0) return;

    function focusItem(el: HTMLElement | null) {
      if (!el) return;
      el.focus();
      el.classList.add("is-focused");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    focusItem(items[0] ?? null);

    const onKey = (event: KeyboardEvent) => {
      const live = getItems();
      if (live.length === 0) return;
      const current = live.findIndex((el) => el === document.activeElement);
      let next = current < 0 ? 0 : current;
      let handled = false;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        next = (current + 1) % live.length;
        handled = true;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        next = (current - 1 + live.length) % live.length;
        handled = true;
      }
      if (handled) {
        event.preventDefault();
        live.forEach((el) => el.classList.remove("is-focused"));
        focusItem(live[next] ?? null);
        setIndex(next);
      }
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [root, selector]);

  return {
    index,
    register(el: HTMLElement | null) {
      if (el && el !== root) setRoot(el);
    },
    focusFirst() {
      // unused on web — focus happens automatically in the effect above
    }
  };
}

export default function TvLayout() {
  const router = useRouter();
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const focus = useTvFocus(".focusable");

  useEffect(() => {
    api.listBooks().then((r) => setBooks(r.items ?? [])).catch((e) => setError(e.message));
  }, []);

  // Top-level `Escape` returns to Library / mobile home route.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Menu") {
        router.replace("/");
      }
    };
    if (Platform.OS === "web") {
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    return undefined;
  }, [router]);

  return (
    <ScrollView
      ref={(el) => focus.register(el as unknown as HTMLElement | null)}
      tabIndex={0}
      style={{ flex: 1, backgroundColor: palette.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
    >
      <header style={styles.header}>
        <Text style={styles.label}>AnimBook · tv</Text>
        <Text style={styles.h1}>The Library</Text>
        <Text style={styles.muted}>
          The 10-foot view. Use the remote arrows to move the focus ring,
          press Enter to open a book.
        </Text>
      </header>

      {error && <Text style={[styles.muted, { color: palette.error }]}>{error}</Text>}

      <section style={styles.grid}>
        {books.map((book) => (
          <button
            key={book.id}
            className="focusable"
            onClick={() => router.push(`/read/${book.slug}`)}
            style={styles.card}
          >
            <View style={styles.cover}>
              {book.coverUrl ? (
                <img src={book.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <Text style={styles.muted}>{book.title}</Text>
              )}
            </View>
            <Text style={[styles.by, { color: palette.gold }]}>
              {book.vertical} · {book.author}
            </Text>
            <Text style={styles.cardTitle}>{book.title}</Text>
            <Text style={styles.muted}>{book.totalPages} pages</Text>
          </button>
        ))}
      </section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.lg },
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
    fontSize: 13
  },
  grid: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md
  },
  card: {
    flexBasis: "30%",
    padding: spacing.md,
    backgroundColor: palette.surface,
    borderWidth: 3,
    borderColor: "transparent",
    borderRadius: radii.lg,
    textAlign: "left"
  },
  cover: {
    width: "100%",
    aspectRatio: 2 / 3,
    backgroundColor: palette.card,
    borderRadius: radii.md,
    overflow: "hidden",
    marginBottom: spacing.sm,
    alignItems: "center",
    justifyContent: "center"
  },
  by: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase"
  },
  cardTitle: {
    fontFamily: fonts.serif,
    fontSize: 24,
    color: palette.text,
    marginVertical: spacing.xs
  }
});
