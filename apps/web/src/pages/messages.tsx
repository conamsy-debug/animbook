import { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { EmptyState, LoadingState } from "@/components/States";
import { listThreads, type ThreadSummary } from "@/lib/messages";

export default function MessagesPage() {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    listThreads()
      .then((r) => {
        setThreads(r.threads);
        setAvailable(r.messagingAvailable);
      })
      .catch(() => setThreads([]));
  }, []);

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header className="library-head">
          <div>
            <span className="label">Messages</span>
            <h1>Readers and authors</h1>
            <p className="muted">
              A private line between a reader and an author about their books. Nothing else on AnimBook is private like
              this, so it stays narrow: readers write to authors, authors answer, and either of you can end it.
            </p>
          </div>
        </header>

        {!available && (
          <EmptyState
            title="Messaging is off for this account"
            message="School and child accounts use notes and reading circles instead, where everything is in the open."
            cta={{ href: "/library", label: "Back to the library" }}
          />
        )}

        {available && threads === null && <LoadingState message="Opening your messages…" />}
        {available && threads?.length === 0 && (
          <EmptyState
            title="No messages yet"
            message="Open an author's page and write to them about a book of theirs you've read."
            cta={{ href: "/library", label: "Browse the library" }}
          />
        )}

        {available && threads && threads.length > 0 && (
          <ul className="thread-list">
            {threads.map((t) => (
              <li key={t.id} className={t.unread ? "thread-row unread" : "thread-row"}>
                <Link href={`/messages/${t.id}`}>
                  {t.other.avatarUrl ? (
                    <img className="author-avatar small" src={t.other.avatarUrl} alt="" />
                  ) : (
                    <span className="author-avatar placeholder small">{t.other.name.charAt(0).toUpperCase()}</span>
                  )}
                  <div className="thread-row-body">
                    <div className="thread-row-head">
                      <strong>{t.other.name}</strong>
                      <span className="muted small">
                        {t.role === "author" ? "reader" : "author"}
                        {t.status === "CLOSED" ? " · ended" : ""}
                      </span>
                    </div>
                    {t.book && <p className="muted small">About {t.book.title}</p>}
                    {t.preview && <p className="thread-preview">{t.preview}</p>}
                  </div>
                  {t.unread && <span className="thread-dot" aria-label="Unread" />}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
