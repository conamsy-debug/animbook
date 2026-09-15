/**
 * Sentry observability — optional.
 *
 * AnimBook ships Sentry only when `SENTRY_DSN` is set in env. When
 * `SENTRY_TRACES_SAMPLE_RATE` is unset we default to 0.1 (10%) for
 * transactions. The init function is called once from index.ts and
 * is safe to call when the SDK isn't installed.
 *
 * This file deliberately doesn't add @sentry/node to package.json —
 * the dependency is small and optional, and we don't want a flaky
 * Windows npm install to fail every restart over a feature that is
 * not used in 99% of local dev loops. The init code is the same shape
 * either way.
 */
import type { ErrorRequestHandler } from "express";

interface SentryLike {
  captureException(err: unknown, ctx?: Record<string, unknown>): void;
  captureMessage(msg: string, ctx?: Record<string, unknown>): void;
  Handlers: { errorHandler(): ErrorRequestHandler };
  init: (opts: Record<string, unknown>) => void;
}

let sentry: SentryLike | null = null;

export async function initSentry(dsn: string | undefined, env: string, release: string): Promise<void> {
  if (!dsn) return;
  try {
    // Lazy require so missing the package doesn't break the API.
    const mod = await import("@sentry/node" as string).catch(() => null);
    if (!mod) {
      console.warn("[sentry] SENTRY_DSN set but @sentry/node is not installed; running without error reporting");
      return;
    }
    const candidate = mod as unknown as { default?: SentryLike } & SentryLike;
    const sdk: SentryLike = (candidate.default ?? candidate) as SentryLike;
    sdk.init({
      dsn,
      environment: env,
      release,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
      profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? "0"),
      sendDefaultPii: false,
      maxBreadcrumbs: 50
    });
    sentry = sdk;
    console.log(`[sentry] reporting to ${new URL(dsn).host} (release=${release})`);
  } catch (err) {
    console.warn("[sentry] init failed", err);
  }
}

export function captureException(err: unknown, ctx?: Record<string, unknown>): void {
  if (!sentry) return;
  try {
    sentry.captureException(err, ctx);
  } catch {
    // never let observability break the request
  }
}

export function captureMessage(msg: string, ctx?: Record<string, unknown>): void {
  if (!sentry) return;
  try {
    sentry.captureMessage(msg, ctx);
  } catch {
    // ignore
  }
}

export function expressErrorHandler(): ErrorRequestHandler {
  if (!sentry) {
    return (err, _req, res, _next) => {
      // eslint-disable-next-line no-console
      console.error("[animbook-api] unhandled", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    };
  }
  return sentry.Handlers.errorHandler();
}
