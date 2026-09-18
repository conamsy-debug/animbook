import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Topbar } from "@/components/Topbar";
import { EmptyState, LoadingState } from "@/components/States";
import { createCircle, joinCircle, listCircles, type CircleSummary } from "@/lib/circles";
import { useToastStore } from "@/lib/store";

export default function CirclesPage() {
  const router = useRouter();
  const toast = useToastStore((s) => s.push);
  const [circles, setCircles] = useState<CircleSummary[] | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const bookId = typeof router.query.bookId === "string" ? router.query.bookId : undefined;
  const bookTitle = typeof router.query.title === "string" ? router.query.title : undefined;

  useEffect(() => {
    listCircles()
      .then(setCircles)
      .catch(() => setCircles([]));
  }, []);

  useEffect(() => {
    if (bookTitle && !name) setName(`${bookTitle} reading circle`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookTitle]);

  async function start() {
    setBusy(true);
    try {
      const circle = await createCircle(name.trim(), bookId);
      toast("Circle started — share the invite link");
      void router.push(`/circles/${circle.id}`);
    } catch (err) {
      const detail = (err as { details?: { error?: string } }).details?.error;
      toast(detail ?? `Couldn't start the circle: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    setBusy(true);
    try {
      const id = await joinCircle(code.trim());
      void router.push(`/circles/${id}`);
    } catch (err) {
      const detail = (err as { details?: { error?: string } }).details?.error;
      toast(detail ?? `Couldn't join: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header className="library-head">
          <div>
            <span className="label">Reading circles</span>
            <h1>Read together</h1>
            <p className="muted">A small private group around one book. Invite by link; only members can see what&apos;s said.</p>
          </div>
        </header>

        <div className="circle-start">
          <label className="field">
            <span>Start a circle</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tuesday night readers" maxLength={60} />
          </label>
          <button type="button" className="btn primary" onClick={start} disabled={busy || name.trim().length < 2}>
            Start
          </button>
          <span className="circle-or">or</span>
          <label className="field">
            <span>Join with an invite code</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste the code" />
          </label>
          <button type="button" className="btn" onClick={join} disabled={busy || code.trim().length < 4}>
            Join
          </button>
        </div>

        {circles === null && <LoadingState message="Finding your circles…" />}
        {circles?.length === 0 && (
          <EmptyState title="No circles yet" message="Start one above, or open a book and start a circle from its page." />
        )}
        <div className="grid">
          {circles?.map((circle) => (
            <Link key={circle.id} href={`/circles/${circle.id}`} className="circle-card">
              <span className="circle-cover" style={{ backgroundImage: circle.book?.coverUrl ? `url(${circle.book.coverUrl})` : undefined }} />
              <span className="circle-text">
                <strong>{circle.name}</strong>
                {circle.book && <small>{circle.book.title}</small>}
                <small className="muted">
                  {circle._count.members} {circle._count.members === 1 ? "member" : "members"} · {circle._count.posts}{" "}
                  {circle._count.posts === 1 ? "message" : "messages"}
                  {circle.role === "OWNER" ? " · yours" : ""}
                </small>
              </span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
