/**
 * Centralised environment loader.
 *
 * - Reads `.env` if present.
 * - Surfaces typed helpers for the rest of the API.
 * - Treats optional integrations as flags: every AI / payments helper MUST
 *   route through `isFeatureEnabled()` so the reader never silently breaks.
 */
import "dotenv/config";

type Feature = "CLERK" | "BOOK_BRAIN" | "RUNWAY" | "ELEVENLABS" | "OPENAI" | "STRIPE" | "CLOUDFLARE";

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
      return Boolean(appEnv.CLOUDFLARE_ACCOUNT_ID && appEnv.CLOUDFLARE_R2_ACCESS_KEY_ID);
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
  cloudflare: isFeatureEnabled("CLOUDFLARE")
} as const;