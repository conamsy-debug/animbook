import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/lib/store";

interface SessionDetail {
  id: string;
  title: string;
  status: "LIVE" | "ENDED";
  currentPage: number;
  startedAt: string;
  endedAt: string | null;
  attendeeCount: number;
  host: { id: string; name: string };
  book: { id: string; slug: string; title: string; totalPages: number; coverUrl: string | null };
}

interface LiveEvent {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Attendee view: someone the host shared a link with. Reads along without
 * driving anything. Auto-flip comes from the Reader when the attendee follows
 * the "Read along" CTA (?live=<sessionId>) — here we just show what's
 * happening right now.
 */
export default function AttendeeLivePage() {
  const router = useRouter();
  const sessionId = typeof router.query.sessionId === "string" ? router.query.sessionId : null;
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [latestEvent, setLatestEvent] = useState<LiveEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const toast = useToastStore((s) => s.push);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ session: SessionDetail }>(`/api/live/sessions/${sessionId}`);
        if (!cancelled) setSession(res.session);
      } catch (err) {
        if (!cancelled) {
          const msg = (err as Error).message;
          setError(msg);
          toast(`Could not load session: ${msg}`);
        }
      }
    }
    load();
    const interval = window.setInterval(load, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [sessionId, toast]);

  // SSE subscription — the heartbeat we ignore, the 'live' events drive the
  // currentPage + a "the host just flipped" flash.
  useEffect(() => {
    if (!sessionId || !session || session.status !== "LIVE") return;
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const es = new EventSource(`${base}/api/live/sessions/${sessionId}/events`);
    es.addEventListener("live", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as LiveEvent;
        setLatestEvent(data);
        if (data.type === "session.ended") {
          setSession((prev) => (prev ? { ...prev, status: "ENDED", endedAt: new Date().toISOString() } : prev));
        }
        if (data.type === "page.flipped") {
          const next = Number(data.payload["pageNum"]);
          if (Number.isFinite(next)) {
            setSession((prev) => (prev ? { ...prev, currentPage: next } : prev));
          }
        }
      } catch {
        // ignore
      }
    });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    sourceRef.current = es;
    return () => {
      es.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [sessionId, session?.status]);

  if (error && !session) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <p className="muted" style={{ marginTop: 32 }}>
            {error}. <Link href="/live">Back to live</Link>
          </p>
        </main>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <p className="muted" style={{ marginTop: 32 }}>Loading session…</p>
        </main>
      </div>
    );
  }

  const ended = session.status === "ENDED";
  const readAlongHref = `/read/${session.book.slug ?? session.book.id}?live=${session.id}`;

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header className="section-header">
          <div className="left">
            <span
              className="dot"
              style={{ background: ended ? "#56738A" : "#D46A0A" }}
            />
            <h1>{session.title}</h1>
          </div>
          <span className="label">
            {ended ? "Ended" : connected ? "● Live" : "Reconnecting…"}
          </span>
        </header>

        <section className="grid" style={{ gridTemplateColumns: "200px 1fr", gap: 24 }}>
          <div>
            {session.book.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.book.coverUrl}
                alt={session.book.title}
                style={{ width: "100%", borderRadius: 12, border: "1px solid #1f2937" }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  aspectRatio: "3/4",
                  borderRadius: 12,
                  background: "#0d1424",
                  border: "1px dashed #1f2937",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#56738A"
                }}
              >
                No cover
              </div>
            )}
          </div>
          <div>
            <p className="muted small" style={{ marginBottom: 4 }}>
              Hosted by {session.host.name}
            </p>
            <h2 style={{ margin: "4px 0 16px" }}>{session.book.title}</h2>

            <div
              className="card"
              style={{
                padding: 24,
                background: "#0d1424",
                border: "1px solid #1f2937",
                borderRadius: 12
              }}
            >
              <p className="muted small" style={{ margin: 0 }}>
                {ended ? "Last page shown" : "Currently reading"}
              </p>
              <p
                style={{
                  fontSize: "2.4rem",
                  fontWeight: 700,
                  margin: "4px 0 0",
                  color: ended ? "#56738A" : "#C49A1C"
                }}
              >
                Page {session.currentPage}
                <span className="muted small" style={{ marginLeft: 8 }}>
                  of {session.book.totalPages}
                </span>
              </p>
              {!ended && (
                <p className="muted small" style={{ marginTop: 8 }}>
                  {session.attendeeCount} watching now ·{" "}
                  {latestEvent?.type === "page.flipped" ? "just flipped" : "waiting for the host"}
                </p>
              )}
              {ended && (
                <p className="muted small" style={{ marginTop: 8 }}>
                  This session ended
                  {session.endedAt ? ` ${new Date(session.endedAt).toLocaleString()}` : ""}.
                  The book is still yours to read.
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              {!ended && (
                <Link href={readAlongHref} className="btn primary">
                  Read along
                </Link>
              )}
              <Link href={`/read/${session.book.slug ?? session.book.id}`} className="btn">
                {ended ? "Read the book" : "Open book alone"}
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
