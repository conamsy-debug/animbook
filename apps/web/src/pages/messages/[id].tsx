import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Topbar } from "@/components/Topbar";
import { EmptyState, LoadingState } from "@/components/States";
import { closeThread, getThread, replyInThread, type ChatMessage, type ThreadDetail } from "@/lib/messages";
import { reportContent } from "@/lib/community";
import { useToastStore } from "@/lib/store";

const MAX = 1000;

export default function ThreadPage() {
  const router = useRouter();
  const toast = useToastStore((s) => s.push);
  const id = typeof router.query.id === "string" ? router.query.id : null;
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refused, setRefused] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await getThread(id);
      setThread(r.thread);
      setMessages(r.messages);
      setRefused(null);
    } catch (err) {
      const detail = (err as { details?: { error?: string } }).details?.error;
      setRefused(detail ?? "This conversation isn't available.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Light refresh while the tab is open, so a reply lands without a reload.
  useEffect(() => {
    if (!id || refused) return;
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [id, refused, load]);

  async function send() {
    if (!id) return;
    setBusy(true);
    try {
      const res = await replyInThread(id, text.trim());
      setMessages((m) => [...m, res.message]);
      setText("");
      if (res.held) toast("Sent — it'll appear once it's been looked over");
    } catch (err) {
      const detail = (err as { details?: { error?: string } }).details?.error;
      toast(detail ?? `Couldn't send: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    if (!id) return;
    await closeThread(id);
    toast("Conversation ended");
    void load();
  }

  async function report() {
    if (!id) return;
    await reportContent({ targetType: "MESSAGE", targetId: id, reason: "harassment" });
    toast("Reported — someone will look at this conversation");
  }

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container narrow">
        {loading && <LoadingState message="Opening the conversation…" />}
        {refused && <EmptyState title="Not available" message={refused} cta={{ href: "/messages", label: "Back to messages" }} />}

        {thread && !refused && (
          <>
            <header className="thread-head">
              <div>
                <span className="label">{thread.role === "reader" ? "You wrote to" : "Reader"}</span>
                <h1>{thread.other.name}</h1>
                {thread.book && (
                  <p className="muted small">
                    About <Link href={`/book/${thread.book.slug}`}>{thread.book.title}</Link>
                  </p>
                )}
              </div>
              <div className="thread-head-actions">
                <button type="button" className="btn ghost small" onClick={report}>
                  Report
                </button>
                {thread.role === "author" && thread.status === "OPEN" && (
                  <button type="button" className="btn ghost small" onClick={end}>
                    End conversation
                  </button>
                )}
              </div>
            </header>

            <ol className="message-list">
              {messages.map((m) => (
                <li key={m.id} className={m.mine ? "message mine" : "message"}>
                  <p>{m.text}</p>
                  <span className="muted small">
                    {new Date(m.createdAt).toLocaleString()}
                    {m.pending ? " · waiting to be looked over" : ""}
                    {m.removed ? " · removed" : ""}
                  </span>
                </li>
              ))}
            </ol>

            {thread.status === "CLOSED" ? (
              <p className="muted">This conversation has ended. Nothing more can be sent either way.</p>
            ) : (
              <div className="message-composer">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                  maxLength={MAX}
                  placeholder="Write a reply…"
                />
                <div className="message-composer-actions">
                  <button type="button" className="btn primary" onClick={send} disabled={busy || text.trim().length < 2}>
                    {busy ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            )}

            <p className="muted small" style={{ marginTop: 24 }}>
              <Link href="/messages">← All messages</Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
