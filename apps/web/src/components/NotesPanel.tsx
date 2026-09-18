import Link from "next/link";
import { useEffect, useState } from "react";
import { addNote, deleteNote, getNotes, type MarginNote } from "@/lib/notes";
import { reportContent } from "@/lib/community";
import { useToastStore } from "@/lib/store";

const MAX = 280;

/** Notes readers have left on this page, and the box to add one. */
export function NotesPanel({ pageId, pageNum, onClose, onCountChange }: {
  pageId: string;
  pageNum: number;
  onClose(): void;
  onCountChange?(pageId: string, count: number): void;
}) {
  const toast = useToastStore((s) => s.push);
  const [notes, setNotes] = useState<MarginNote[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNotes(null);
    getNotes(pageId)
      .then((list) => {
        if (cancelled) return;
        setNotes(list);
        onCountChange?.(pageId, list.filter((n) => !n.pending && !n.removed).length);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  async function submit() {
    const value = text.trim();
    if (value.length < 2) return;
    setBusy(true);
    setNotice(null);
    try {
      const { note, held } = await addNote(pageId, value);
      setNotes((prev) => [...(prev ?? []), note]);
      setText("");
      if (held) setNotice("Thanks — a moderator will take a look before this note appears to others.");
    } catch (err) {
      const detail = (err as { details?: { error?: string } }).details?.error;
      setNotice(detail ?? `Couldn't post that: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteNote(id);
      setNotes((prev) => (prev ?? []).filter((n) => n.id !== id));
    } catch (err) {
      toast(`Couldn't remove: ${(err as Error).message}`);
    }
  }

  async function report(note: MarginNote) {
    if (!window.confirm("Report this note to AnimBook?")) return;
    try {
      await reportContent({ targetType: "NOTE", targetId: note.id, reason: "other" });
      toast("Reported — thank you. We'll take a look.");
    } catch (err) {
      toast(`Couldn't report: ${(err as Error).message}`);
    }
  }

  return (
    <aside className="notes-panel" aria-label={`Notes on page ${pageNum}`}>
      <header>
        <h3>Notes on page {pageNum}</h3>
        <button type="button" className="icon-btn small" onClick={onClose} aria-label="Close notes">
          <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div className="notes-list">
        {notes === null && <p className="muted small">Loading…</p>}
        {notes?.length === 0 && <p className="muted small">No notes yet. Be the first to leave one.</p>}
        {notes?.map((note) => (
          <article key={note.id} className={`note${note.pending ? " pending" : ""}`}>
            <div className="note-head">
              {note.author.avatarUrl ? (
                <img src={note.author.avatarUrl} alt="" />
              ) : (
                <span className="note-initial">{note.author.name.charAt(0).toUpperCase()}</span>
              )}
              <span className="note-who">
                {note.author.handle ? (
                  <Link href={`/author/${note.author.handle}`}>{note.author.name}</Link>
                ) : (
                  note.author.name
                )}
                <small>{new Date(note.createdAt).toLocaleDateString()}</small>
              </span>
              {note.mine ? (
                <button type="button" className="note-action" onClick={() => remove(note.id)}>
                  Delete
                </button>
              ) : (
                <button type="button" className="note-action" onClick={() => report(note)}>
                  Report
                </button>
              )}
            </div>
            <p>{note.text}</p>
            {note.pending && <span className="note-pending">Waiting to be checked — only you can see this.</span>}
          </article>
        ))}
      </div>

      <div className="note-compose">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX))}
          rows={3}
          placeholder="What did this page make you think?"
        />
        <div className="note-compose-row">
          <span className="muted small">
            {text.length}/{MAX}
          </span>
          <button type="button" className="btn primary" onClick={submit} disabled={busy || text.trim().length < 2}>
            {busy ? "Posting…" : "Post note"}
          </button>
        </div>
        {notice && <p className="note-notice">{notice}</p>}
      </div>
    </aside>
  );
}
