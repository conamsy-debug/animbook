import Link from "next/link";
import type { BookSummary } from "@/lib/api";
import { verticalAccent, verticalById } from "@/lib/verticals";

export function BookCard({ book, compact = false }: { book: BookSummary; compact?: boolean }) {
  const accent = verticalAccent(book.vertical);
  return (
    <Link href={`/book/${book.slug}`} className={`book-card${compact ? " compact" : ""}`} aria-label={`Open ${book.title}`}>
      <div className="cover" style={{ backgroundImage: book.coverUrl ? `url(${book.coverUrl})` : undefined }} />
      <span className="by" style={{ color: accent }}>
        {verticalById(book.vertical)?.label ?? book.vertical}
        {compact ? "" : ` · ${book.author}`}
      </span>
      <h3>{book.title}</h3>
      {book.subtitle && !compact && <span className="book-card-subtitle">{book.subtitle}</span>}
      {!compact && (
        <p className="muted" style={{ margin: 0, fontSize: ".9rem" }}>
          {book.synopsis.slice(0, 110)}
          {book.synopsis.length > 110 ? "…" : ""}
        </p>
      )}
      <span className="label">{book.totalPages} pages</span>
    </Link>
  );
}
