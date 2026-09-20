import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/lib/store";

interface BookOption {
  id: string;
  slug: string;
  title: string;
  pageCount: number;
}

interface ActiveSession {
  id: string;
  title: string;
  status: string;
  currentPage: number;
  startedAt: string;
  attendeeCount: number;
  host: { id: string; name: string };
  book: { id: string; slug: string; title: string; totalPages: number; coverUrl: string | null };
}

interface HostSession extends Omit<ActiveSession, "attendeeCount"> {}

interface LiveEventRow {
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export default function LivePage() {
  const [books, setBooks] = useState<BookOption[]>([]);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [hostTitle, setHostTitle] = useState("Live reading");
  const [hostBookId, setHostBookId] = useState<string>("");
  const [activeSession, setActiveSession] = useState<HostSession | null>(null);
  const [events, setEvents] = useState<LiveEventRow[]>([]);
  const [starting, setStarting] = useState(false);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const sourceRef = useRef<EventSource | null>(null);
  const toast = useToastStore((s) => s.push);

  /** Pull books this user owns through Studio — these are the only books they
   *  have authority to take live (no reading someone else's work aloud). */
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ items: { book: BookOption | null }[] }>("/api/studio/projects");
        if (cancelled) return;
        const opts = res.items
          .map((p) => p.book)
          .filter((b): b is BookOption => !!b && b.pageCount > 0);
        setBooks(opts);
        if (opts.length > 0) setHostBookId((cur) => cur || opts[0].id);
      } catch (err) {
        if (!cancelled) toast(`Studio offline: ${(err as Error).message}`);
      } finally {
        if (!cancelled) setLoadingBooks(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  /** Public listing of LIVE sessions — attendee count comes from the in-memory
   *  bus so hosts can see who's watching right now (falls back to 0 across
   *  server restarts). */
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ items: ActiveSession[] }>("/api/live/active");
        if (!cancelled) setSessions(res.items);
      } catch (err) {
        if (!cancelled) toast(`Live feed offline: ${(err as Error).message}`);
      }
    }
    load();
    const interval = window.setInterval(load, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [toast]);

  useEffect(() => () => {
    sourceRef.current?.close();
  }, []);

  async function startSession() {
    if (!hostBookId || starting) return;
    setStarting(true);
    try {
      const res = await apiFetch<{ session: HostSession }>("/api/live/sessions", {
        method: "POST",
        json: { bookId: hostBookId, title: hostTitle }
      });
      setSessions((prev) => [{ ...res.session, attendeeCount: 0 }, ...prev]);
      setActiveSession(res.session);
      subscribe(res.session.id);
      toast(`Live session "${res.session.title}" started`);
    } catch (err) {
      toast(`Could not start: ${(err as Error).message}`);
    } finally {
      setStarting(false);
    }
  }

  function subscribe(sessionId: string) {
    sourceRef.current?.close();
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const es = new EventSource(`${base}/api/live/sessions/${sessionId}/events`);
    es.addEventListener("live", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { type: string; payload: Record<string, unknown> };
        setEvents((prev) => [{ ...data, at: new Date().toISOString() }, ...prev].slice(0, 30));
      } catch {
        // ignore malformed payloads
      }
    });
    es.onerror = () => {
      // EventSource auto-reconnects; no toast, no action.
    };
    sourceRef.current = es;
  }

  async function flipPage(delta: number) {
    if (!activeSession) return;
    const next = Math.max(1, Math.min(activeSession.book.totalPages, activeSession.currentPage + delta));
    if (next === activeSession.currentPage) return;
    try {
      await apiFetch(`/api/live/sessions/${activeSession.id}/append`, {
        method: "POST",
        json: { type: "page.flipped", payload: { pageNum: next } }
      });
      setActiveSession({ ...activeSession, currentPage: next });
    } catch (err) {
      toast(`Could not flip: ${(err as Error).message}`);
    }
  }

  async function endSession() {
    if (!activeSession) return;
    try {
      await apiFetch(`/api/live/sessions/${activeSession.id}/end`, { method: "POST" });
      setActiveSession(null);
      setEvents([]);
      sourceRef.current?.close();
      toast("Live session ended");
      setSessions((prev) => prev.filter((s) => s.id !== activeSession.id));
    } catch (err) {
      toast(`Could not end: ${(err as Error).message}`);
    }
  }

  const activeBook = useMemo(
    () => books.find((b) => b.id === hostBookId) ?? null,
    [books, hostBookId]
  );

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header className="section-header">
          <div className="left">
            <span className="dot" style={{ background: "#D46A0A" }} />
            <h1>AnimBook LIVE</h1>
          </div>
          <span className="label">Real-time storytelling</span>
        </header>

        <section className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <article className="card">
            <h3>Host a new session</h3>
            {loadingBooks ? (
              <p className="muted">Loading your books…</p>
            ) : books.length === 0 ? (
              <p className="muted">
                You don't have any published books yet. Finish a Studio project first.
              </p>
            ) : (
              <>
                <label>
                  <span className="label">Book</span>
                  <select
                    value={hostBookId}
                    onChange={(e) => setHostBookId(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    {books.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title} · {b.pageCount} pp
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ marginTop: 8, display: "block" }}>
                  <span className="label">Session title</span>
                  <input
                    value={hostTitle}
                    onChange={(e) => setHostTitle(e.target.value)}
                    placeholder="Live reading"
                  />
                </label>
                <button
                  type="button"
                  className="btn primary"
                  onClick={startSession}
                  disabled={starting || !hostBookId}
                  style={{ marginTop: 12 }}
                >
                  {starting ? "Starting…" : "Start live session"}
                </button>
              </>
            )}
          </article>

          <article className="card">
            <h3>Active session</h3>
            {activeSession ? (
              <>
                <p className="muted">{activeSession.book.title}</p>
                <h2 style={{ fontSize: "1.4rem", margin: "4px 0 0" }}>{activeSession.title}</h2>
                <p style={{ marginTop: 6 }}>
                  Page {activeSession.currentPage} of {activeSession.book.totalPages}
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => flipPage(-1)}
                    disabled={activeSession.currentPage <= 1}
                  >
                    ‹ Prev
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => flipPage(1)}
                    disabled={activeSession.currentPage >= activeSession.book.totalPages}
                  >
                    Next ›
                  </button>
                  <button type="button" className="btn ghost" onClick={endSession}>
                    End
                  </button>
                </div>
                <p style={{ marginTop: 10 }}>
                  <Link href={`/live/${activeSession.id}`} className="muted small">
                    Share attendee link →
                  </Link>
                </p>
              </>
            ) : (
              <p className="muted">No live session. Start one to drive a real-time audience.</p>
            )}
          </article>
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#14818E" }} />
              <h2>Live stream</h2>
            </div>
            <span className="label">{events.length} events</span>
          </header>
          {events.length === 0 ? (
            <div className="empty-state">
              No events yet. Open a live session and flip a page.
            </div>
          ) : (
            <ul className="timeline">
              {events.map((event, idx) => (
                <motion.li
                  key={idx}
                  className="row"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                >
                  <strong>{event.type}</strong>
                  <span>
                    {new Date(event.at).toLocaleTimeString()} ·{" "}
                    <code>{JSON.stringify(event.payload)}</code>
                  </span>
                </motion.li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#C49A1C" }} />
              <h2>Happening now</h2>
            </div>
            <span className="label">{sessions.length} live</span>
          </header>
          {sessions.length === 0 ? (
            <div className="empty-state">No sessions are live right now.</div>
          ) : (
            <ul className="card-grid">
              {sessions.map((s) => (
                <li key={s.id} className="card" style={{ padding: 16 }}>
                  <p className="muted small" style={{ marginBottom: 4 }}>
                    {s.host.name}
                  </p>
                  <h3 style={{ marginTop: 0 }}>{s.title}</h3>
                  <p className="muted small" style={{ margin: "4px 0 12px" }}>
                    {s.book.title} · page {s.currentPage} / {s.book.totalPages}
                  </p>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="pill" title="Attendees connected right now">
                      ● {s.attendeeCount}
                    </span>
                    <Link href={`/live/${s.id}`} className="btn" style={{ marginLeft: "auto" }}>
                      Join
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {activeBook && (
          <p className="muted small" style={{ marginTop: 16 }}>
            Selected book has {activeBook.pageCount} pages.
          </p>
        )}
      </main>
    </div>
  );
}
