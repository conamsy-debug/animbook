import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { BookCard } from "@/components/BookCard";
import { EmptyState, LoadingState } from "@/components/States";
import { FollowButton } from "@/components/FollowButton";
import { MessageAuthorButton } from "@/components/MessageAuthorButton";
import { getAuthor, getMyProfile, type AuthorProfile } from "@/lib/community";

export default function AuthorPage() {
  const router = useRouter();
  const handle = typeof router.query.handle === "string" ? router.query.handle : null;
  const [author, setAuthor] = useState<AuthorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [canMessage, setCanMessage] = useState(false);

  useEffect(() => {
    getMyProfile()
      .then((me) => {
        setMyId(me?.id ?? null);
        setCanMessage(Boolean(me?.messagingAvailable));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    getAuthor(handle)
      .then((a) => {
        if (!cancelled) setAuthor(a);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        {loading && <LoadingState message="Opening the author's shelf…" />}
        {missing && (
          <EmptyState
            title="No such author"
            message="This author page doesn't exist, or the handle has changed."
            cta={{ href: "/library", label: "Browse the library" }}
          />
        )}
        {author && (
          <>
            <header className="author-head">
              <div className="author-identity">
                {author.avatarUrl ? (
                  <img className="author-avatar" src={author.avatarUrl} alt="" />
                ) : (
                  <span className="author-avatar placeholder">{author.name.charAt(0).toUpperCase()}</span>
                )}
                <div>
                <span className="label">Author</span>
                <h1>{author.name}</h1>
                <p className="author-handle">@{author.handle}</p>
                {author.bio && <p className="author-bio">{author.bio}</p>}
                <p className="muted small">
                  {author.followers} {author.followers === 1 ? "follower" : "followers"} · {author.books.length}{" "}
                  {author.books.length === 1 ? "AnimBook" : "AnimBooks"}
                </p>
                </div>
              </div>
              {myId === author.id ? (
                <Link href="/profile" className="btn ghost">
                  Edit your page
                </Link>
              ) : (
                <div className="author-actions">
                  <FollowButton authorId={author.id} authorName={author.name} />
                  <MessageAuthorButton
                    authorId={author.id}
                    authorName={author.name}
                    acceptsMessages={author.acceptsMessages}
                    messagingAvailable={canMessage}
                  />
                </div>
              )}
            </header>

            {author.books.length === 0 ? (
              <EmptyState title="Nothing published yet" message="Follow to hear when this author's first AnimBook arrives." />
            ) : (
              <>
                <h2 className="section-title">Books</h2>
                <div className="grid">
                  {author.books.map((book) => (
                    <BookCard key={book.id} book={book} />
                  ))}
                </div>
              </>
            )}
            <p className="muted small" style={{ marginTop: 28 }}>
              <Link href="/library">← Back to the library</Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
