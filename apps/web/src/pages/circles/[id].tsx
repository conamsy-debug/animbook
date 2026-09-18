import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Topbar } from "@/components/Topbar";
import { EmptyState, LoadingState } from "@/components/States";
import { reportContent } from "@/lib/community";
import {
  closeCircle,
  deleteCirclePost,
  getCircle,
  leaveCircle,
  postToCircle,
  type CircleDetail
} from "@/lib/circles";
import { useToastStore } from "@/lib/store";

export default function CircleRoom() {
  const router = useRouter();
  const toast = useToastStore((s) => s.push);
  const id = typeof router.query.id === "string" ? router.query.id : null;
  const [circle, setCircle] = useState<CircleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const load = () =>
      getCircle(id)
        .then((c) => {
          if (!cancelled) setCircle(c);
        })
        .catch((err) => {
          if (!cancelled) setError((err as { details?: { error?: string } }).details?.error ?? "This circle isn't available");
        });
    void load();
    const timer = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [circle?.posts.length]);

  async function send() {
    if (!id || text.trim().length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const { post, held } = await postToCircle(id, text.trim());
      setText("");
      if (held) setNotice("Thanks — a moderator will look at that before the others see it.");
      else setCircle((prev) => (prev ? { ...prev, posts: [...prev.posts, { ...post, mine: true }] } : prev));
    } catch (err) {
      const detail = (err as { details?: { error?: string } }).details?.error;
      setNotice(detail ?? `Couldn't post: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function removePost(postId: string) {
    try {
      await deleteCirclePost(postId);
      setCircle((prev) => (prev ? { ...prev, posts: prev.posts.filter((p) => p.id !== postId) } : prev));
    } catch (err) {
      toast(`Couldn't remove: ${(err as Error).message}`);
    }
  }

  async function report(postId: string) {
    if (!window.confirm("Report this message to AnimBook?")) return;
    try {
      await reportContent({ targetType: "CIRCLE_POST", targetId: postId, reason: "other" });
      toast("Reported — thank you.");
    } catch (err) {
      toast(`Couldn't report: ${(err as Error).message}`);
    }
  }

  async function copyInvite() {
    if (!circle?.inviteCode) return;
    const link = `${window.location.origin}/circles/join/${circle.inviteCode}`;
    try {
      await navigator.clipboard.writeText(link);
      toast("Invite link copied");
    } catch {
      window.prompt("Copy this invite link", link);
    }
  }

  if (error) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <EmptyState title="Not available" message={error} cta={{ href: "/circles", label: "Your circles" }} />
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        {!circle && <LoadingState message="Opening the circle…" />}
        {circle && (
          <>
            <header className="circle-head">
              <div>
                <span className="label">Reading circle</span>
                <h1>{circle.name}</h1>
                {circle.book && (
                  <p className="muted">
                    Reading <Link href={`/book/${circle.book.slug}`}>{circle.book.title}</Link>
                  </p>
                )}
              </div>
              <div className="circle-actions">
                {circle.inviteCode && (
                  <button type="button" className="btn primary" onClick={copyInvite}>
                    Copy invite link
                  </button>
                )}
                {circle.role === "OWNER" ? (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={async () => {
                      if (!window.confirm("Close this circle for everyone?")) return;
                      await closeCircle(circle.id);
                      void router.push("/circles");
                    }}
                  >
                    Close circle
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={async () => {
                      if (!window.confirm("Leave this circle?")) return;
                      await leaveCircle(circle.id);
                      void router.push("/circles");
                    }}
                  >
                    Leave
                  </button>
                )}
              </div>
            </header>

            <div className="circle-layout">
              <section className="circle-feed-wrap">
                <div className="circle-feed" ref={feedRef}>
                  {circle.posts.length === 0 && <p className="muted small">No messages yet. Say what you thought of the first pages.</p>}
                  {circle.posts.map((post) => (
                    <article key={post.id} className={`circle-post${post.mine ? " mine" : ""}`}>
                      <div className="note-head">
                        {post.user.avatarUrl ? <img src={post.user.avatarUrl} alt="" /> : <span className="note-initial">{post.user.name.charAt(0).toUpperCase()}</span>}
                        <span className="note-who">
                          {post.user.handle ? <Link href={`/author/${post.user.handle}`}>{post.user.name}</Link> : post.user.name}
                          <small>
                            {new Date(post.createdAt).toLocaleString()}
                            {post.pageNum ? ` · page ${post.pageNum}` : ""}
                          </small>
                        </span>
                        {post.mine || circle.role === "OWNER" ? (
                          <button type="button" className="note-action" onClick={() => removePost(post.id)}>
                            Delete
                          </button>
                        ) : (
                          <button type="button" className="note-action" onClick={() => report(post.id)}>
                            Report
                          </button>
                        )}
                      </div>
                      <p>{post.text}</p>
                    </article>
                  ))}
                </div>
                <div className="note-compose">
                  <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 1000))} rows={3} placeholder="Say something to the circle…" />
                  <div className="note-compose-row">
                    <span className="muted small">{text.length}/1000</span>
                    <button type="button" className="btn primary" onClick={send} disabled={busy || text.trim().length === 0}>
                      {busy ? "Sending…" : "Send"}
                    </button>
                  </div>
                  {notice && <p className="note-notice">{notice}</p>}
                </div>
              </section>

              <aside className="circle-members">
                <h3>
                  Members <span className="muted">({circle.members.length})</span>
                </h3>
                <ul>
                  {circle.members.map((member) => (
                    <li key={member.user.id}>
                      {member.user.avatarUrl ? <img src={member.user.avatarUrl} alt="" /> : <span className="note-initial">{member.user.name.charAt(0).toUpperCase()}</span>}
                      <span>
                        {member.user.handle ? <Link href={`/author/${member.user.handle}`}>{member.user.name}</Link> : member.user.name}
                        {member.role === "OWNER" && <small> · host</small>}
                      </span>
                    </li>
                  ))}
                </ul>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
