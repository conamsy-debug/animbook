import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { api, type CompanionLink } from "../../src/api";
import { fonts, palette, radii, spacing } from "../../src/theme";

const MODES = ["AR_OVERLAY", "NFC_ANCHOR", "AR_AND_NFC"];

function MarkerTile({ hash }: { hash: string }) {
  const cells = useMemo(() => {
    const out: boolean[] = [];
    for (let i = 0; i < 36; i++) {
      const byte = parseInt(hash.slice(i * 2, i * 2 + 2), 16);
      out.push(((byte >> (i % 8)) & 1) === 1);
    }
    return out;
  }, [hash]);
  return (
    <View
      style={{
        width: 160,
        height: 160,
        borderRadius: radii.md,
        backgroundColor: palette.surface,
        borderWidth: 1,
        borderColor: palette.wellness,
        flexDirection: "row",
        flexWrap: "wrap",
        padding: 8
      }}
    >
      {cells.map((on, idx) => (
        <View
          key={idx}
          style={{
            width: "13.6%",
            height: "13.6%",
            backgroundColor: on ? palette.wellness : "transparent",
            margin: 1
          }}
        />
      ))}
    </View>
  );
}

export default function CompanionTab() {
  const [books, setBooks] = useState<{ slug: string; title: string; vertical: string }[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [link, setLink] = useState<CompanionLink | null>(null);
  const [anchorPage, setAnchorPage] = useState("1");
  const [loading, setLoading] = useState(true);
  const [minted, setMinted] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listBooks()
      .then((res) => {
        setBooks(res.items.map((b) => ({ slug: b.slug, title: b.title, vertical: b.vertical })));
        if (res.items[0]) setSelectedSlug(res.items[0].slug);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedSlug) return;
    setMinted(false);
    setLink(null);
    setStatusMessage("Loading…");
    api.companion
      .forBook(selectedSlug)
      .then((res) => {
        setLink(res.link);
        setAnchorPage(String(res.link?.anchorPage ?? 1));
        setStatusMessage(res.link ? "Companion ready" : "Mint a companion link");
      })
      .catch((err) => setError((err as Error).message));
  }, [selectedSlug]);

  async function mint(mode: string) {
    if (!selectedSlug) return;
    setError(null);
    setStatusMessage("Minting companion link…");
    try {
      const res = await api.companion.mint(selectedSlug, Math.max(1, Number.parseInt(anchorPage, 10) || 1), mode);
      setLink(res.link);
      setMinted(true);
      setStatusMessage(`Minted · ${res.link.markerHash.slice(0, 8)}…`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function pin() {
    if (!selectedSlug) return;
    try {
      const res = await api.companion.pin(selectedSlug, Math.max(1, Number.parseInt(anchorPage, 10) || 1));
      setLink(res.link);
      setStatusMessage(`Anchor pinned to page ${res.link.anchorPage}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function openSession(triggerMode: "AR_OVERLAY" | "NFC_ANCHOR" | "MANUAL") {
    if (!link) return;
    try {
      await api.companion.openSession(link.id, triggerMode, link.anchorPage);
      setStatusMessage(`Companion session opened (${triggerMode})`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={styles.label}>AnimBook STUDIO PRO</Text>
      <Text style={styles.h1}>Companion</Text>
      <Text style={styles.muted}>
        Every AnimBook mints a deterministic AR marker and a unique NFC tag id. Print the marker on the cover,
        program the NFC tag with the tag id, and the book opens on the anchor page you choose.
      </Text>

      {loading && <ActivityIndicator color={palette.wellness} style={{ marginTop: spacing.xl }} />}
      {error && <Text style={[styles.muted, { color: palette.error, marginTop: spacing.lg }]}>Offline · {error}</Text>}

      <Text style={[styles.label, { marginTop: spacing.lg }]}>Pick a book</Text>
      <View style={{ marginTop: spacing.sm }}>
        {books.slice(0, 8).map((b) => (
          <Pressable
            key={b.slug}
            onPress={() => setSelectedSlug(b.slug)}
            style={[
              styles.bookRow,
              { borderColor: selectedSlug === b.slug ? palette.wellness : palette.border }
            ]}
          >
            <Text style={[styles.bookTitle, { color: selectedSlug === b.slug ? palette.wellness : palette.text }]}>
              {b.title}
            </Text>
            <Text style={styles.muted}>{b.vertical}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.label, { marginTop: spacing.lg }]}>Anchor page</Text>
      <TextInput
        value={anchorPage}
        onChangeText={setAnchorPage}
        keyboardType="number-pad"
        style={styles.input}
        placeholder="1"
        placeholderTextColor={palette.textMuted}
      />

      <Text style={[styles.label, { marginTop: spacing.md }]}>Modes</Text>
      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
        {MODES.map((m) => (
          <Pressable key={m} onPress={() => void mint(m)} style={styles.modeChip}>
            <Text style={styles.modeLabel}>{m.replace("_", " ")}</Text>
          </Pressable>
        ))}
      </View>

      {link && (
        <>
          <Text style={[styles.label, { marginTop: spacing.lg }]}>Marker</Text>
          <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center", marginTop: spacing.sm }}>
            <MarkerTile hash={link.markerHash} />
            <View style={{ flex: 1 }}>
              <Text style={styles.muted} numberOfLines={3}>{link.markerHash}</Text>
            </View>
          </View>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>NFC tag</Text>
          <Text style={[styles.nfcTag, { fontFamily: fonts.mono }]}>{link.nfcTagId}</Text>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>Open a session</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
            <Pressable onPress={() => void openSession("AR_OVERLAY")} style={styles.cta}>
              <Text style={styles.ctaText}>AR overlay</Text>
            </Pressable>
            <Pressable onPress={() => void openSession("NFC_ANCHOR")} style={styles.cta}>
              <Text style={styles.ctaText}>NFC anchor</Text>
            </Pressable>
            <Pressable onPress={() => void openSession("MANUAL")} style={styles.cta}>
              <Text style={styles.ctaText}>Manual</Text>
            </Pressable>
          </View>

          <Pressable onPress={() => void pin()} style={[styles.cta, { marginTop: spacing.md }]}>
            <Text style={styles.ctaText}>Pin anchor page to {anchorPage}</Text>
          </Pressable>
        </>
      )}

      {statusMessage && (
        <Text style={[styles.muted, { marginTop: spacing.lg }]}>{statusMessage}{minted ? " · fresh mint" : ""}</Text>
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
    fontSize: 36,
    color: palette.text,
    marginVertical: spacing.xs
  },
  muted: {
    color: palette.textMuted,
    fontSize: 13,
    lineHeight: 18
  },
  bookRow: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: palette.surface,
    borderWidth: 1,
    marginBottom: spacing.sm
  },
  bookTitle: {
    fontFamily: fonts.serif,
    fontSize: 16
  },
  input: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    fontFamily: fonts.mono
  },
  modeChip: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.wellness,
    alignItems: "center"
  },
  modeLabel: {
    color: palette.wellness,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  nfcTag: {
    color: palette.wellness,
    fontSize: 18,
    marginTop: spacing.sm,
    letterSpacing: 1.6
  },
  cta: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.wellness,
    alignItems: "center"
  },
  ctaText: {
    color: palette.wellness,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  }
});