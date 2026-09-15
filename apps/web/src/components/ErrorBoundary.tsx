import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  fallback: (error: Error, reset: () => void) => ReactNode;
  children: ReactNode;
  /** Optional hook fired before render — useful for telemetry */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

/**
 * Reusable error boundary. Wraps any subtree; on error swaps in the fallback
 * render-prop with a reset() that clears the error and retries the subtree.
 *
 * Use:
 *   <ErrorBoundary fallback={(err, reset) => <ErrorState error={err} onRetry={reset} />}>
 *     <ReaderStage />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.error("[ErrorBoundary]", error, info.componentStack);
    }
    this.props.onError?.(error, info);
  }

  reset = (): void => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) return this.props.fallback(error, this.reset);
    return this.props.children;
  }
}

interface ErrorStateProps {
  error: Error;
  title?: string;
  onRetry?: () => void;
  /** Optional reduced-view fallback for the Reader (keeps the layout intact). */
  compact?: boolean;
}

/**
 * Default error state UI — used by the Reader, Library, Dream, Companion,
 * Memory, Worlds, Studio, and School pages.
 *
 * Honors `compact` for the Reader so the page stays navigable; full-page
 * version for the catalogue and content shell.
 */
export function ErrorState({ error, title, onRetry, compact }: ErrorStateProps) {
  const heading = title ?? "Something went sideways";
  if (compact) {
    return (
      <div
        className="animbook-error-compact"
        role="alert"
        style={{
          padding: "1.5rem",
          border: "1px solid var(--border, rgba(255,255,255,0.12))",
          borderRadius: 12,
          background: "var(--surface-1, #0d1424)",
          color: "var(--text, #fff)",
          display: "grid",
          gap: 12
        }}
      >
        <strong>{heading}</strong>
        <p style={{ margin: 0, opacity: 0.7, fontSize: 14 }}>
          {error.message || "An unexpected error interrupted the page."}
        </p>
        {onRetry ? (
          <button
            onClick={onRetry}
            style={{
              justifySelf: "start",
              padding: "8px 16px",
              border: "none",
              borderRadius: 8,
              background: "var(--accent, #C49A1C)",
              color: "#0D1B2E",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div
      className="animbook-error-full"
      role="alert"
      style={{
        minHeight: "60vh",
        display: "grid",
        placeItems: "center",
        padding: "3rem 1.5rem",
        textAlign: "center"
      }}
    >
      <div style={{ maxWidth: 480, display: "grid", gap: 16 }}>
        <h1 style={{ margin: 0 }}>{heading}</h1>
        <p style={{ margin: 0, opacity: 0.7 }}>
          The page couldn’t load. {error.message ? `(${error.message})` : ""}
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {onRetry ? (
            <button
              onClick={onRetry}
              style={{
                padding: "10px 20px",
                border: "none",
                borderRadius: 10,
                background: "var(--accent, #C49A1C)",
                color: "#0D1B2E",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Try again
            </button>
          ) : null}
          <a
            href="/"
            style={{
              padding: "10px 20px",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 10,
              color: "inherit",
              textDecoration: "none"
            }}
          >
            Back to library
          </a>
        </div>
      </div>
    </div>
  );
}
