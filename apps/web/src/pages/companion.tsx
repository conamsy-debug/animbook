import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";

interface CompanionLink {
  id: string;
  bookId: string;
  markerHash: string;
  nfcTagId: string;
  experienceMode: "AR_OVERLAY" | "NFC_ANCHOR" | "AR_AND_NFC";
  anchorPage: number;
  title: string | null;
  companionLabel: string | null;
  createdAt: string;
}

interface BookRef {
  id: string;
  slug: string;
  title: string;
  author: string;
  vertical: string;
  coverUrl: string | null;
  status: string;
}

interface ListedBook {
  id: string;
  slug: string;
  title: string;
  author: string;
  vertical: string;
  coverUrl: string | null;
}

interface AnalyticsSummary {
  total: number;
  byTrigger: { triggerMode: string; count: number; avgPageReached: number }[];
}

function MarkerTile({ hash }: { hash: string }) {
  // Deterministic 6x6 QR-like tile built from the hash bytes.
  // Live WebXR is opt-in; the static tile is the universal fallback.
  const cells = useMemo(() => {
    const out: boolean[] = [];
    for (let i = 0; i < 36; i++) {
      const byte = parseInt(hash.slice(i * 2, i * 2 + 2), 16);
      out.push(((byte >> (i % 8)) & 1) === 1);
    }
    return out;
  }, [hash]);
  return (
    <div className="companion-marker" aria-label="AnimBook AR marker">
      <svg viewBox="0 0 6 6" role="img" aria-label="AR marker">
        {cells.map((on, idx) => (
          <rect key={idx} x={idx % 6} y={Math.floor(idx / 6)} width="1" height="1" fill={on ? "var(--wellness)" : "transparent"} />
        ))}
      </svg>
    </div>
  );
}

export default function CompanionPage() {
  const [books, setBooks] = useState<ListedBook[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [link, setLink] = useState<CompanionLink | null>(null);
  const [book, setBook] = useState<BookRef | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [nfcInput, setNfcInput] = useState("");
  const [markerInput, setMarkerInput] = useState("");
  const [anchorPage, setAnchorPage] = useState(1);
  const [nfcAvailable, setNfcAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ items: ListedBook[] }>("/api/books?status=PUBLISHED&limit=24")
      .then((res) => {
        if (cancelled) return;
        setBooks(res.items);
        if (res.items[0]) setSelectedSlug(res.items[0].slug);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
      });
    if (typeof window !== "undefined" && "NDEFReader" in window) {
      setNfcAvailable(true);
    } else if (typeof window !== "undefined") {
      setNfcAvailable(false);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSlug) return;
    let cancelled = false;
    setError(null);
    setStatusMessage("Loading companion…");
    Promise.all([
      apiFetch<{ book: BookRef; link: CompanionLink | null }>(`/api/studio-pro/companion/${selectedSlug}`),
      apiFetch<{ book: BookRef; link: CompanionLink | null; summary: AnalyticsSummary | null; sessions: unknown[] }>(
        `/api/studio-pro/companion/${selectedSlug}/analytics`
      ).catch(() => null)
    ]).then(([res, ana]) => {
      if (cancelled) return;
      setBook(res.book);
      setLink(res.link);
      setAnalytics(ana?.summary ?? null);
      setAnchorPage(res.link?.anchorPage ?? 1);
      if (res.link) {
        setStatusMessage(`Companion link ready · ${res.link.experienceMode}`);
      } else {
        setStatusMessage("No companion yet — mint one below.");
      }
    }).catch((err) => {
      if (cancelled) return;
      setError((err as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedSlug]);

  async function mintLink() {
    if (!selectedSlug) return;
    setError(null);
    setStatusMessage("Minting companion link…");
    try {
      const res = await apiFetch<{ book: BookRef; link: CompanionLink }>(`/api/studio-pro/companion/${selectedSlug}`, {
        method: "POST",
        json: { experienceMode: "AR_AND_NFC", anchorPage }
      });
      setBook(res.book);
      setLink(res.link);
      setStatusMessage(`Minted · marker ${res.link.markerHash.slice(0, 8)}…`);
      // Refresh analytics
      const ana = await apiFetch<{ summary: AnalyticsSummary | null }>(`/api/studio-pro/companion/${selectedSlug}/analytics`).catch(() => null);
      setAnalytics(ana?.summary ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function pinPage() {
    if (!selectedSlug) return;
    setStatusMessage("Pinning anchor page…");
    try {
      const res = await apiFetch<{ link: CompanionLink }>(`/api/studio-pro/companion/${selectedSlug}/page`, {
        method: "POST",
        json: { anchorPage }
      });
      setLink(res.link);
      setStatusMessage(`Anchor → page ${res.link.anchorPage}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function openSession(triggerMode: "AR_OVERLAY" | "NFC_ANCHOR" | "MANUAL") {
    if (!link) return;
    try {
      const res = await apiFetch<{ session: { id: string } }>(`/api/studio-pro/sessions`, {
        method: "POST",
        json: { linkId: link.id, triggerMode, pageReached: link.anchorPage }
      });
      setStatusMessage(`Companion session opened (${triggerMode}) · id ${res.session.id.slice(0, 8)}…`);
      // Refresh analytics
      const ana = await apiFetch<{ summary: AnalyticsSummary | null }>(`/api/studio-pro/companion/${selectedSlug}/analytics`).catch(() => null);
      setAnalytics(ana?.summary ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function resolveByMarker() {
    if (!markerInput.trim()) return;
    setError(null);
    try {
      const res = await apiFetch<{ book: BookRef | null; link: CompanionLink }>(
        `/api/studio-pro/scan/marker/${encodeURIComponent(markerInput.trim())}`
      );
      if (res.book?.slug) setSelectedSlug(res.book.slug);
      setStatusMessage(`Marker resolved → ${res.book?.slug ?? "unknown"}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function resolveByNfc() {
    if (!nfcInput.trim()) return;
    setError(null);
    try {
      const res = await apiFetch<{ book: BookRef | null; link: CompanionLink }>(
        `/api/studio-pro/scan/nfc/${encodeURIComponent(nfcInput.trim())}`
      );
      if (res.book?.slug) setSelectedSlug(res.book.slug);
      setStatusMessage(`NFC tag resolved → ${res.book?.slug ?? "unknown"}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function scanNfc() {
    if (typeof window === "undefined") return;
    if (!("NDEFReader" in window)) {
      setStatusMessage("Web NFC unavailable on this device. Use the manual entry below.");
      return;
    }
    try {
      const reader = new (window as unknown as { NDEFReader: new () => { scan: () => Promise<void>; onerror: ((e: unknown) => void) | null } }).NDEFReader();
      await reader.scan();
      setStatusMessage("Web NFC scan started. Tap an AnimBook NFC tag to continue.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header style={{ margin: "32px 0 16px" }}>
          <p className="label">AnimBook STUDIO PRO</p>
          <h1>Companion</h1>
          <p className="muted" style={{ maxWidth: 640 }}>
            Every AnimBook has a deterministic AR marker (a small QR-like tile) and a unique NFC tag id. Point your camera at the cover in the WebXR overlay, or tap the tag with Web NFC, and the AnimBook opens on the anchor page you chose.
          </p>
        </header>

        {error && <p className="muted" style={{ color: "var(--error)" }}>{error}</p>}
        {statusMessage && <p className="muted">{statusMessage}</p>}

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, margin: "16px 0" }}>
          <div className="companion-card">
            <p className="label">Pick a book</p>
            <select
              value={selectedSlug ?? ""}
              onChange={(e) => setSelectedSlug(e.target.value)}
            >
              {books.map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.title} · {b.vertical}
                </option>
              ))}
            </select>
          </div>
          <div className="companion-card">
            <p className="label">Anchor page</p>
            <input
              type="number"
              min={1}
              max={9999}
              value={anchorPage}
              onChange={(e) => setAnchorPage(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary" onClick={mintLink}>
                {link ? "Re-mint companion" : "Mint companion link"}
              </button>
              {link && (
                <button type="button" className="btn" onClick={pinPage}>
                  Pin anchor page
                </button>
              )}
            </div>
          </div>
        </section>

        {book && link && (
          <section className="companion-grid">
            <div className="companion-card">
              <p className="label">AR marker</p>
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <MarkerTile hash={link.markerHash} />
                <div style={{ display: "grid", gap: 6 }}>
                  <p className="muted" style={{ margin: 0, fontFamily: "var(--mono)", fontSize: ".7rem" }}>{link.markerHash}</p>
                  <button type="button" className="btn" onClick={() => openSession("AR_OVERLAY")}>
                    Open AR overlay session
                  </button>
                </div>
              </div>
            </div>
            <div className="companion-card">
              <p className="label">NFC tag</p>
              <p style={{ margin: 0, fontFamily: "var(--mono)", fontSize: "1rem", letterSpacing: ".06em" }}>{link.nfcTagId}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn btn-primary" onClick={scanNfc}>
                  {nfcAvailable === false ? "NFC not available" : "Start Web NFC scan"}
                </button>
                <button type="button" className="btn" onClick={() => openSession("NFC_ANCHOR")}>
                  Open NFC session
                </button>
              </div>
              {nfcAvailable === false && (
                <p className="muted" style={{ margin: 0, fontSize: ".7rem" }}>
                  Web NFC is only exposed on Chrome for Android today. On other surfaces, paste the tag id below.
                </p>
              )}
            </div>
            <div className="companion-card">
              <p className="label">AR overlay preview</p>
              <div className="companion-overlay" aria-label="AR overlay simulation">
                <span className="label">AR_OVERLAY</span>
                <span className="anchor-page">Page {link.anchorPage}</span>
                <span className="book-title">{book.title}</span>
              </div>
              <button type="button" className="btn" onClick={() => openSession("MANUAL")}>
                Open manual session
              </button>
            </div>
          </section>
        )}

        <section style={{ margin: "32px 0" }}>
          <p className="label">Manual resolvers</p>
          <div className="companion-grid">
            <div className="companion-fallback">
              <strong>Marker lookup</strong>
              <input
                placeholder="Paste marker hash"
                value={markerInput}
                onChange={(e) => setMarkerInput(e.target.value)}
              />
              <button type="button" className="btn" onClick={resolveByMarker}>Resolve</button>
            </div>
            <div className="companion-fallback">
              <strong>NFC tag lookup</strong>
              <input
                placeholder="Paste NFC tag id (e.g. AB-… )"
                value={nfcInput}
                onChange={(e) => setNfcInput(e.target.value)}
              />
              <button type="button" className="btn" onClick={resolveByNfc}>Resolve</button>
            </div>
          </div>
        </section>

        {analytics && (
          <section style={{ margin: "32px 0" }}>
            <p className="label">Companion reach</p>
            <h2>Analytics</h2>
            <div className="dream-stat-grid">
              <div className="dream-stat">
                <span className="stat-value">{analytics.total}</span>
                <span className="stat-label">Total sessions</span>
              </div>
              {analytics.byTrigger.map((b) => (
                <div className="dream-stat" key={b.triggerMode}>
                  <span className="stat-value">{b.count}</span>
                  <span className="stat-label">{b.triggerMode.replace("_", " ").toLowerCase()}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section style={{ margin: "48px 0 32px" }}>
          <p className="label">How STUDIO PRO Companion works</p>
          <ol style={{ color: "var(--text-muted)", paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Pick a published AnimBook and choose an <strong>anchor page</strong>.</li>
            <li>Companion mints a deterministic <strong>marker hash</strong> and an <strong>NFC tag id</strong>.</li>
            <li>Print the marker on the book cover; program the NFC tag with the tag id.</li>
            <li>Reader scans → AnimBook opens on the anchor page, AR overlay or NFC anchor logged.</li>
            <li>Creator sees reach in the analytics card above.</li>
          </ol>
        </section>
      </main>
    </div>
  );
}
