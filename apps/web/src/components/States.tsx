import type { CSSProperties, ReactNode } from "react";

interface LoadingStateProps {
  /** Single-line message under the spinner. */
  message?: string;
  /** Number of placeholder slots to render (used by Library / Worlds lists). */
  skeleton?: number;
  /** Layout hint — `card` renders 4-up skeleton cards; `list` rows; `inline` spinner. */
  variant?: "card" | "list" | "inline";
}

const cardStyle: CSSProperties = {
  aspectRatio: "3 / 4",
  borderRadius: 14,
  background: "linear-gradient(110deg, rgba(255,255,255,0.04) 8%, rgba(255,255,255,0.12) 18%, rgba(255,255,255,0.04) 33%)",
  backgroundSize: "200% 100%",
  animation: "animbook-shimmer 1.6s ease-in-out infinite"
};

const rowStyle: CSSProperties = {
  height: 64,
  borderRadius: 10,
  background: "linear-gradient(110deg, rgba(255,255,255,0.04) 8%, rgba(255,255,255,0.12) 18%, rgba(255,255,255,0.04) 33%)",
  backgroundSize: "200% 100%",
  animation: "animbook-shimmer 1.6s ease-in-out infinite"
};

/**
 * Shared loading shell. Cards (catalogue), rows (My Library), or inline (Reader).
 * Uses pure CSS shimmer — no JS, no images.
 */
export function LoadingState({ message, skeleton, variant = "inline" }: LoadingStateProps) {
  if (variant === "card") {
    const n = skeleton ?? 8;
    return (
      <div aria-busy="true" aria-live="polite" style={{ padding: "1rem 0" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 16
          }}
        >
          {Array.from({ length: n }).map((_, i) => (
            <div key={i} style={cardStyle} />
          ))}
        </div>
        {message ? (
          <p style={{ marginTop: 12, opacity: 0.6, fontSize: 14 }}>{message}</p>
        ) : null}
      </div>
    );
  }
  if (variant === "list") {
    const n = skeleton ?? 4;
    return (
      <div aria-busy="true" aria-live="polite" style={{ display: "grid", gap: 12, padding: "1rem 0" }}>
        {Array.from({ length: n }).map((_, i) => (
          <div key={i} style={rowStyle} />
        ))}
      </div>
    );
  }
  // inline
  return (
    <div
      role="status"
      aria-busy="true"
      style={{
        display: "grid",
        placeItems: "center",
        padding: "3rem 1rem",
        gap: 12,
        textAlign: "center"
      }}
    >
      <div
        aria-hidden
        style={{
          width: 36,
          height: 36,
          border: "3px solid rgba(255,255,255,0.12)",
          borderTopColor: "var(--accent, #C49A1C)",
          borderRadius: "50%",
          animation: "animbook-spin 0.9s linear infinite"
        }}
      />
      {message ? <p style={{ margin: 0, opacity: 0.7, fontSize: 14 }}>{message}</p> : null}
      <style jsx>{`
        @keyframes animbook-spin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes animbook-shimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
      `}</style>
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  message?: string;
  icon?: ReactNode;
  cta?: { href: string; label: string };
}

/**
 * Shared empty state. Used when a list has no items (no AnimBooks yet,
 * no Library entries, no search results, no consents, etc.).
 */
export function EmptyState({ title, message, icon, cta }: EmptyStateProps) {
  return (
    <div
      role="status"
      style={{
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        padding: "3rem 1.5rem",
        gap: 12,
        border: "1px dashed rgba(255,255,255,0.12)",
        borderRadius: 14
      }}
    >
      {icon ? <div style={{ fontSize: 36 }}>{icon}</div> : null}
      <h2 style={{ margin: 0, fontSize: 22 }}>{title}</h2>
      {message ? <p style={{ margin: 0, opacity: 0.7, maxWidth: 480 }}>{message}</p> : null}
      {cta ? (
        <a
          href={cta.href}
          style={{
            marginTop: 8,
            padding: "10px 20px",
            borderRadius: 10,
            background: "var(--accent, #C49A1C)",
            color: "#0D1B2E",
            fontWeight: 600,
            textDecoration: "none"
          }}
        >
          {cta.label}
        </a>
      ) : null}
    </div>
  );
}
