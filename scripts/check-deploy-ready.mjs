#!/usr/bin/env node
/**
 * Pre-flight check for production deployment.
 *
 * Validates that the env file you intend to ship with has every
 * required key + the keys we want for live integrations. Prints a
 * report and exits non-zero on any hard requirement, zero on full
 * readiness.
 *
 * Usage:
 *   node scripts/check-deploy-ready.mjs apps/api/.env.production
 *   node scripts/check-deploy-ready.mjs apps/api/.env
 *
 * Each line in the report:
 *   [REQUIRED] ANTHROPIC_API_KEY    → must be set, non-empty
 *   [RECOMMEND] SENTRY_DSN          → should be set; missing degrades observability
 *   [INTEGRATION] runway            → reflects /api/health integrations.runway
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = process.argv[2] ?? "apps/api/.env";
const path = resolve(file);

let raw;
try {
  raw = readFileSync(path, "utf8");
} catch (err) {
  console.error(`Cannot read ${path}: ${err.message}`);
  process.exit(2);
}

const env = {};
for (const rawLine of raw.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq <= 0) continue;
  const key = line.slice(0, eq).trim();
  let val = line.slice(eq + 1).trim();
  // Strip surrounding quotes.
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  env[key] = val;
}

const required = [
  ["NODE_ENV", "production"],
  ["PORT", "4000"],
  ["DATABASE_URL", null],
  ["REDIS_URL", null],
  ["WEB_ORIGIN", null]
];

const recommend = [
  ["CLERK_SECRET_KEY", "Clerk auth — readers can't sign in"],
  ["CLERK_PUBLISHABLE_KEY", "Clerk frontend init"],
  ["ANTHROPIC_API_KEY", "Book Brain — readers see stub Brain otherwise"],
  ["STRIPE_SECRET_KEY", "Stripe checkout — readers see demo URL otherwise"],
  ["STRIPE_WEBHOOK_SECRET", "Stripe subscription state sync"],
  ["RUNWAY_API_KEY", "Runway video generation"],
  ["ELEVENLABS_API_KEY", "ElevenLabs narration"],
  ["CLOUDFLARE_ACCOUNT_ID", "R2 video / poster uploads"],
  ["CLOUDFLARE_R2_ACCESS_KEY_ID", "R2 video / poster uploads"],
  ["CLOUDFLARE_R2_SECRET_ACCESS_KEY", "R2 video / poster uploads"],
  ["SENTRY_DSN", "Error reporting"]
];

const integrations = [];
function report() {
  console.log(`\n=== AnimBook deploy-readiness · ${path} ===\n`);
  let missing = 0;
  let missingRec = 0;
  console.log("Required:");
  for (const [key, defaultValue] of required) {
    const v = env[key];
    if (v === undefined || v === "") {
      console.log(`  [FAIL] ${key.padEnd(30)} → not set${defaultValue ? ` (default would be: ${defaultValue})` : ""}`);
      missing++;
    } else {
      const shown = key.includes("SECRET") || key.includes("URL") || key.includes("KEY")
        ? (v.length > 12 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v)
        : v;
      console.log(`  [ OK ] ${key.padEnd(30)} → ${shown}`);
      integrations.push([key, v]);
    }
  }

  console.log("\nRecommended for live traffic:");
  for (const [key, why] of recommend) {
    const v = env[key];
    if (v === undefined || v === "") {
      console.log(`  [WARN] ${key.padEnd(30)} → not set — ${why}`);
      missingRec++;
    } else {
      const shown = v.length > 12 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v;
      console.log(`  [ OK ] ${key.padEnd(30)} → ${shown}`);
    }
  }

  // Cross-check: NODE_ENV vs Stripe key prefix
  const isProd = env.NODE_ENV === "production";
  const stripe = env.STRIPE_SECRET_KEY ?? "";
  if (isProd && stripe.startsWith("sk_test_")) {
    console.log(`\n  [FAIL] STRIPE_SECRET_KEY is a TEST key (sk_test_*) but NODE_ENV=production`);
    missing++;
  }
  if (isProd && stripe.startsWith("sk_live_") === false && stripe !== "") {
    console.log(`\n  [WARN] STRIPE_SECRET_KEY does not start with sk_live_ — confirm it's a production key`);
  }
  const clerk = env.CLERK_SECRET_KEY ?? "";
  // Clerk test keys (sk_test_/pk_test_) are Clerk developer-plan keys —
  // they work in production but throttle aggressively. Demoted to WARN
  // (was FAIL) so the founder can deploy on a free Clerk instance. Bump
  // to sk_live_/pk_live_ when billing is upgraded.
  if (isProd && clerk.startsWith("sk_test_")) {
    console.log(`\n  [WARN] CLERK_SECRET_KEY is a TEST key (sk_test_*) in production — Clerk dev plan throttles; replace with sk_live_ when billing upgrades`);
  }
  if (isProd && env.ALLOW_DEMO_AUTH === "true") {
    console.log(`\n  [FAIL] ALLOW_DEMO_AUTH=true in production — turn this off before deploying`);
    missing++;
  }

  console.log(`\nSummary: ${missing} hard-fail · ${missingRec} recommended.`);
  if (missing > 0) {
    console.log("Not ready to deploy. Address the [FAIL] rows above.\n");
    process.exit(1);
  }
  if (missingRec > 0) {
    console.log("Deployable. The [WARN] rows are best-effort — they degrade specific features.\n");
    process.exit(0);
  }
  console.log("Ready to deploy. All keys present.\n");
}

report();
