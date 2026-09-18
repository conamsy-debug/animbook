import { useState } from "react";
import { useRouter } from "next/router";
import { messageAuthor } from "@/lib/messages";
import { useToastStore } from "@/lib/store";

interface Props {
  authorId: string;
  authorName: string;
  /** False when the author has closed their inbox — then nothing is shown at all. */
  acceptsMessages: boolean;
  /** False for school and child accounts — then nothing is shown at all. */
  messagingAvailable: boolean;
  bookId?: string;
}

const MAX = 1000;

export function MessageAuthorButton({ authorId, authorName, acceptsMessages, messagingAvailable, bookId }: Props) {
  const router = useRouter();
  const toast = useToastStore((s) => s.push);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  // The button isn't rendered at all for accounts that can't message, rather
  // than rendered-and-disabled: there's nothing to explain and nothing to try.
  if (!messagingAvailable || !acceptsMessages) return null;

  async function send() {
    setBusy(true);
    try {
      const res = await messageAuthor(authorId, text.trim(), bookId);
      toast(res.held ? "Sent — it'll appear once it's been looked over" : `Message sent to ${authorName}`);
      setText("");
      setOpen(false);
      void router.push(`/messages/${res.threadId}`);
    } catch (err) {
      const detail = (err as { details?: { error?: string } }).details?.error;
      toast(detail ?? `Couldn't send: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
        Message {authorName.split(" ")[0]}
      </button>
    );
  }

  return (
    <div className="message-composer">
      <label className="field">
        <span>Write to {authorName}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={MAX}
          placeholder={`Say what you thought of their book…`}
        />
      </label>
      <p className="muted small">
        {authorName} can read this, close the conversation, or block you. Keep it about the books — messages are screened,
        and you can report anything you're sent.
      </p>
      <div className="message-composer-actions">
        <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={send} disabled={busy || text.trim().length < 2}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
