import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/lib/store";

interface ResilientFetchOptions {
  /** Tag used in console.warn messages. Default: the API path. */
  tag?: string;
  /** Auto-toast on error. Default: true. */
  toastOnError?: boolean;
  /** Stuck threshold (ms) before "Tap to retry" appears. Default: 4000. */
  stuckMs?: number;
  /** Hard timeout (ms) before the fetch is abandoned and the error
   *  state is shown. Default: 8000. */
  timeoutMs?: number;
  /** Skip the fetch on first render (e.g. when waiting on a parent). */
  enabled?: boolean;
}

interface ResilientFetchResult<T> {
  data: T | null;
  loading: boolean;
  /** Set when the API returned non-2xx OR the timeout fired. */
  error: string | null;
  /** True after `stuckMs` elapses with no data — show a manual escape. */
  stuck: boolean;
  /** Force the effect to re-run. */
  retry: () => void;
}

/**
 * Resilient one-shot fetch for top-level page loads.
 *
 * Same safety net we now use on /edu and /signal:
 * - 8s ceiling timeout so a hung API never leaves the page on "Loading…"
 * - 4s "stuck" hint with a manual Retry button (window.location.reload)
 * - console.warn per failure for browser-console debugging
 * - Optional toast on error
 *
 * Cancels on unmount and on retry-key bump. Pass `enabled: false` to
 * skip the fetch until a dependency becomes ready.
 *
 * Usage:
 *   const { data, loading, error, stuck, retry } = useResilientFetch<{ items: Book[] }>(
 *     "/api/books?vertical=EDU",
 *     { tag: "[WORLDS]" }
 *   );
 */
export function useResilientFetch<T>(
  path: string | null,
  options: ResilientFetchOptions = {}
): ResilientFetchResult<T> {
  const {
    tag,
    toastOnError = true,
    stuckMs = 4_000,
    timeoutMs = 8_000,
    enabled = true
  } = options;
  const toast = useToastStore((s) => s.push);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const retry = useCallback(() => setRetryKey((k) => k + 1), []);

  useEffect(() => {
    if (!path || !enabled) return;
    let cancelled = false;
    let stuckTimer: number | undefined;
    let timeout: number | undefined;
    setLoading(true);
    setError(null);
    setStuck(false);
    async function load() {
      try {
        const res = await apiFetch<T>(path);
        if (cancelled) return;
        // Success — kill the pending timers so a slow-but-eventually-
        // successful fetch doesn't end up with both data AND the
        // "API may be down" error state at the same time.
        if (stuckTimer !== undefined) window.clearTimeout(stuckTimer);
        if (timeout !== undefined) window.clearTimeout(timeout);
        setData(res);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(tag ?? `[fetch ${path}]`, "failed:", err);
        setError(msg);
        setLoading(false);
        if (toastOnError) toast(`Couldn't load (${tag ?? path}): ${msg}`);
      }
    }
    stuckTimer = window.setTimeout(() => {
      if (!cancelled) setStuck(true);
    }, stuckMs);
    timeout = window.setTimeout(() => {
      if (cancelled) return;
      console.warn(tag ?? `[fetch ${path}]`, "timeout at", timeoutMs, "ms");
      setError("Request is taking longer than expected. The API may be down — try again in a moment.");
      setLoading(false);
    }, timeoutMs);
    load();
    return () => {
      cancelled = true;
      if (stuckTimer !== undefined) window.clearTimeout(stuckTimer);
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [path, enabled, retryKey, tag, toastOnError, stuckMs, timeoutMs, toast]);

  return { data, loading, error, stuck, retry };
}
