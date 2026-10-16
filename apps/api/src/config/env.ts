/**
 * Centralised environment loader.
 *
 * - Reads `.env` if present.
 * - Surfaces typed helpers for the rest of the API.
 * - Treats optional integrations as flags: every AI / payments helper MUST
 *   route through `isFeatureEnabled()` so the reader never silently breaks.
 */
import "dotenv/config";

type Feature =
  | "CLERK"
  | "BOOK_BRAIN"
  | "RUNWAY"
  | "ELEVENLABS"
  | "OPENAI"
  | "STRIPE"
  | "CLOUDFLARE"
  | "LANGUAGES"
  | "MINIMAX_VIDEO"
  | "MINIMAX_TTS";

const env = process.env;

function required(name: string, fallback?: string): string {
  const value = env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = env[name];
  if (value === undefined || value === "") return undefined;
  return value;
}

export interface AppEnv {
  NODE_ENV: "development" | "production" | "test";
  PORT: number;
  WEB_ORIGIN: string;
  WEB_ORIGIN_LIST: string[];
  ALLOW_RAILWAY_PREVIEW: boolean;
  DATABASE_URL: string;
  REDIS_URL: string;
  CLERK_SECRET_KEY: string | undefined;
  CLERK_PUBLISHABLE_KEY: string | undefined;
  ALLOW_DEMO_AUTH: boolean;
  ANTHROPIC_API_KEY: string | undefined;
  ANTHROPIC_BOOK_BRAIN_MODEL: string;
  RUNWAY_API_KEY: string | undefined;
  /** MiniMax (Hailuo) video + image API. Apply at https://platform.minimax.io.
   *  Treat this key like a payment credential — never log, print, or commit it. */
  MINIMAX_API_KEY: string | undefined;
  /** Routing key for the active video provider. Defaults to "minimax" when
   *  unset. See apps/api/src/services/videoProvider.ts. */
  VIDEO_PROVIDER: "minimax" | "runway";
  /** Per-call concurrency cap for MiniMax requests. Conservative default
   *  to stay under any plausible per-account RPM ceiling. */
  MINIMAX_VIDEO_CONCURRENCY: number;
  /** Comma-separated allow-list of MiniMax video models the API is allowed
   *  to pass to the worker; the runtime model is `MINIMAX_VIDEO_MODEL`. */
  MINIMAX_VIDEO_MODEL: string;
  /** Image model used for the per-page still. `image-01` is the documented
   *  default at platform.minimax.io/docs. */
  MINIMAX_IMAGE_MODEL: string;
  /** Routing key for the active TTS provider. Defaults to "minimax" when
   *  unset. See apps/api/src/services/ttsProvider.ts. The author voice-clone
   *  flow is excluded from this router and stays on ElevenLabs until MiniMax
   *  parity lands. */
  TTS_PROVIDER: "minimax" | "elevenlabs";
  /** MiniMax TTS model id. Default `speech-2.8-hd` (premium); `speech-2.8-turbo`
   *  is the cheaper option per the docs. */
  MINIMAX_TTS_MODEL: string;
  /** Per-call concurrency cap for MiniMax TTS requests. Matches the video
   *  default and stays under plausible per-account RPM ceilings. */
  MINIMAX_TTS_CONCURRENCY: number;
  /** When set to "true", narrationLanguages.ts renders the language-specific
   *  TTS preview even when TTS_PROVIDER=elevenlabs. Mirrors the existing
   *  TTS route seam. */
  ELEVENLABS_API_KEY: string | undefined;
  OPENAI_API_KEY: string | undefined;
  STRIPE_SECRET_KEY: string | undefined;
  STRIPE_WEBHOOK_SECRET: string | undefined;
  STRIPE_PRICE_PREMIUM_MONTHLY: string | undefined;
  STRIPE_PRICE_PREMIUM_YEARLY: string | undefined;
  STRIPE_PRICE_STUDIO_MONTHLY: string | undefined;
  STRIPE_PRICE_STUDIO_YEARLY: string | undefined;
  CLOUDFLARE_ACCOUNT_ID: string | undefined;
  CLOUDFLARE_R2_ACCESS_KEY_ID: string | undefined;
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: string | undefined;
  CLOUDFLARE_R2_BUCKET: string;
  CLOUDFLARE_CDN_BASE: string | undefined;
  SENTRY_DSN: string | undefined;
  SENTRY_TRACES_SAMPLE_RATE: number;
  LANGUAGES_ENABLED: boolean;
  RELEASE: string;
}

function parseCsvOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const appEnv: AppEnv = {
  NODE_ENV: (env.NODE_ENV ?? "development") as AppEnv["NODE_ENV"],
  PORT: Number(env.PORT ?? 4000),
  WEB_ORIGIN: env.WEB_ORIGIN ?? "http://localhost:3000",
  WEB_ORIGIN_LIST: parseCsvOrigins(env.WEB_ORIGIN),
  ALLOW_RAILWAY_PREVIEW: (env.ALLOW_RAILWAY_PREVIEW ?? "false").toLowerCase() === "true",
  DATABASE_URL: required("DATABASE_URL", "postgresql://animbook:animbook_local@localhost:6000/animbook?schema=public"),
  REDIS_URL: required("REDIS_URL", "redis://localhost:6001"),
  CLERK_SECRET_KEY: optional("CLERK_SECRET_KEY"),
  CLERK_PUBLISHABLE_KEY: optional("CLERK_PUBLISHABLE_KEY"),
  ALLOW_DEMO_AUTH: (env.ALLOW_DEMO_AUTH ?? "true").toLowerCase() === "true",
  ANTHROPIC_API_KEY: optional("ANTHROPIC_API_KEY"),
  ANTHROPIC_BOOK_BRAIN_MODEL: env.ANTHROPIC_BOOK_BRAIN_MODEL ?? "claude-sonnet-4-5",
  RUNWAY_API_KEY: optional("RUNWAY_API_KEY"),
  MINIMAX_API_KEY: optional("MINIMAX_API_KEY"),
  VIDEO_PROVIDER: ((env.VIDEO_PROVIDER ?? "minimax").toLowerCase().trim() === "runway" ? "runway" : "minimax") as
    | "minimax"
    | "runway",
  MINIMAX_VIDEO_CONCURRENCY: Math.max(1, Number.parseInt(env.MINIMAX_VIDEO_CONCURRENCY ?? "2", 10) || 2),
  MINIMAX_VIDEO_MODEL: env.MINIMAX_VIDEO_MODEL?.trim() || "MiniMax-Hailuo-2.3",
  MINIMAX_IMAGE_MODEL: env.MINIMAX_IMAGE_MODEL?.trim() || "image-01",
  TTS_PROVIDER: ((env.TTS_PROVIDER ?? "minimax").toLowerCase().trim() === "elevenlabs" ? "elevenlabs" : "minimax") as
    | "minimax"
    | "elevenlabs",
  MINIMAX_TTS_MODEL: env.MINIMAX_TTS_MODEL?.trim() || "speech-2.8-hd",
  MINIMAX_TTS_CONCURRENCY: Math.max(1, Number.parseInt(env.MINIMAX_TTS_CONCURRENCY ?? "2", 10) || 2),
  ELEVENLABS_API_KEY: optional("ELEVENLABS_API_KEY"),
  OPENAI_API_KEY: optional("OPENAI_API_KEY"),
  STRIPE_SECRET_KEY: optional("STRIPE_SECRET_KEY"),
  STRIPE_WEBHOOK_SECRET: optional("STRIPE_WEBHOOK_SECRET"),
  STRIPE_PRICE_PREMIUM_MONTHLY: optional("STRIPE_PRICE_PREMIUM_MONTHLY"),
  STRIPE_PRICE_PREMIUM_YEARLY: optional("STRIPE_PRICE_PREMIUM_YEARLY"),
  STRIPE_PRICE_STUDIO_MONTHLY: optional("STRIPE_PRICE_STUDIO_MONTHLY"),
  STRIPE_PRICE_STUDIO_YEARLY: optional("STRIPE_PRICE_STUDIO_YEARLY"),
  CLOUDFLARE_ACCOUNT_ID: optional("CLOUDFLARE_ACCOUNT_ID"),
  CLOUDFLARE_R2_ACCESS_KEY_ID: optional("CLOUDFLARE_R2_ACCESS_KEY_ID"),
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: optional("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
  CLOUDFLARE_R2_BUCKET: env.CLOUDFLARE_R2_BUCKET ?? "animbook-media",
  CLOUDFLARE_CDN_BASE: optional("CLOUDFLARE_CDN_BASE"),
  SENTRY_DSN: optional("SENTRY_DSN"),
  SENTRY_TRACES_SAMPLE_RATE: Number(env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
  // AnimBook Languages (Phase 1). Phase 1 default off so the scaffold ships
  // dark until we flip the flag and ship the rest of the patches.
  LANGUAGES_ENABLED: (env.LANGUAGES_ENABLED ?? "false").toLowerCase() === "true",
  RELEASE: env.RELEASE ?? "animbook-api@0.11.0-local"
};

export function isFeatureEnabled(feature: Feature): boolean {
  switch (feature) {
    case "CLERK":
      return Boolean(appEnv.CLERK_SECRET_KEY);
    case "BOOK_BRAIN":
      return Boolean(appEnv.ANTHROPIC_API_KEY);
    case "RUNWAY":
      return Boolean(appEnv.RUNWAY_API_KEY);
    case "ELEVENLABS":
      return Boolean(appEnv.ELEVENLABS_API_KEY);
    case "OPENAI":
      return Boolean(appEnv.OPENAI_API_KEY);
    case "STRIPE":
      return Boolean(appEnv.STRIPE_SECRET_KEY);
    case "CLOUDFLARE":
      return Boolean(
        appEnv.CLOUDFLARE_ACCOUNT_ID && appEnv.CLOUDFLARE_R2_ACCESS_KEY_ID && appEnv.CLOUDFLARE_R2_SECRET_ACCESS_KEY
      );
    case "LANGUAGES":
      return appEnv.LANGUAGES_ENABLED;
    case "MINIMAX_VIDEO":
      return Boolean(appEnv.MINIMAX_API_KEY);
    case "MINIMAX_TTS":
      // The TTS path shares the MiniMax account; presence of the key is enough.
      return Boolean(appEnv.MINIMAX_API_KEY);
    default:
      return false;
  }
}

export const featureStatus = {
  clerk: isFeatureEnabled("CLERK"),
  bookBrain: isFeatureEnabled("BOOK_BRAIN"),
  runway: isFeatureEnabled("RUNWAY"),
  elevenlabs: isFeatureEnabled("ELEVENLABS"),
  openai: isFeatureEnabled("OPENAI"),
  stripe: isFeatureEnabled("STRIPE"),
  cloudflare: isFeatureEnabled("CLOUDFLARE"),
  languages: isFeatureEnabled("LANGUAGES"),
  minimaxVideo: isFeatureEnabled("MINIMAX_VIDEO"),
  minimaxTts: isFeatureEnabled("MINIMAX_TTS")
} as const;