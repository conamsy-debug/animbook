import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/lib/store";

interface ActiveSession {
  id: string;
  title: string;
  status: string;
  currentPage: number;
  startedAt: string;
  book: { id: string; slug: string; title: string; totalPages: number };
}

export default function LivePage() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [hostTitle, setHostTitle] = useState("Live reading");
  const [hostBookId, setHostBookId] = useState("the-night-train");
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [events, setEvents] = useState<{ type: string; payload: Record<string, unknown>; at: string }[]>([]);
  const sourceRef = useRef<EventSource | null>(null);
  const toast = useToastStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ items: ActiveSession[] }>("/api/live/sessions");
        if (!cancelled) setSessions(res.items);
      } catch (err) {
        if (!cancelled) toast(`Live feed offline: ${(err as Error).message}`);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  useEffect(() => () => {
    sourceRef.current?.close();
  }, []);

  async function startSession() {
    try {
      const res = await apiFetch<{ session: ActiveSession }>("/api/live/sessions", {
        method: "POST",
        json: { bookId: hostBookId, title: hostTitle }
      });
      setSessions((prev) => [res.session, ...prev]);
      setActiveSession(res.session);
      subscribe(res.session.id);
      toast(`Live session "${res.session.title}" started`);
    } catch (err) {
      toast(`Could not start: ${(err as Error).message}`);
    }
  }

  function subscribe(sessionId: string) {
    sourceRef.current?.close();
    const es = new EventSource(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/live/sessions/${sessionId}/events`);
    es.addEventListener("live", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { type: string; payload: Record<string, unknown> };
        setEvents((prev) => [{ ...data, at: new Date().toISOString() }, ...prev].slice(0, 30));
      } catch {
        // ignore
      }
    });
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
    } catch (err) {
      toast(`Could not end: ${(err as Error).message}`);
    }
  }

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
            <label>
              <span className="label">Book</span>
              <input value={hostBookId} onChange={(e) => setHostBookId(e.target.value)} />
            </label>
            <label style={{ marginTop: 8, display: "block" }}>
              <span className="label">Title</span>
              <input value={hostTitle} onChange={(e) => setHostTitle(e.target.value)} />
            </label>
            <button type="button" className="btn primary" onClick={startSession} style={{ marginTop: 12 }}>
              Start live session
            </button>
          </article>

          <article className="card">
            <h3>Active session</h3>
            {activeSession ? (
              <>
                <p className="muted">{activeSession.book.title}</p>
                <h2 style={{ fontSize: "1.4rem" }}>{activeSession.title}</h2>
                <p>Page {activeSession.currentPage} of {activeSession.book.totalPages}</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn" onClick={() => flipPage(-1)} disabled={activeSession.currentPage <= 1}>‹ Prev</button>
                  <button type="button" className="btn" onClick={() => flipPage(1)} disabled={activeSession.currentPage >= activeSession.book.totalPages}>Next ›</button>
                  <button type="button" className="btn ghost" onClick={endSession}>End</button>
                </div>
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
            <div className="empty-state">No events yet. Open a live session and flip a page.</div>
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
                  <span>{new Date(event.at).toLocaleTimeString()} · {JSON.stringify(event.payload)}</span>
                </motion.li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}