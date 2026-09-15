# Phase 12 — Deploy readiness

> AnimBook is now deployable to a single Render project, a single Railway project, or self-hosted via `docker compose -f docker-compose.prod.yml`. The first cohort is one env-file paste + one `docker compose up` away.

## What shipped

- **Health probes** — `/api/health/live` (process up) and `/api/health/ready` (DB + Redis reachable, returns 503 otherwise). Orchestrators can use these to gate traffic without killing the process.
- **Production env templates** — `apps/api/.env.production.example` and `apps/web/.env.production.example` cover every integration, with comments pointing at the dashboard where each key lives.
- **Production Dockerfiles** — multi-stage, non-root, with HEALTHCHECK directives. API at `apps/api/Dockerfile`, Web at `apps/web/Dockerfile` (Next standalone), Mobile at `apps/mobile/Dockerfile` (nginx), TV at `apps/tv/Dockerfile` (nginx).
- **Compose stack** — `docker-compose.prod.yml` brings up Postgres + Redis + API + Web + Mobile + TV with health checks gating the dependent services.
- **Caddyfile** — front-of-house TLS terminator. Two-line config per host.
- **Pre-flight check** — `scripts/check-deploy-ready.mjs` reads the env file, classifies every key as required vs recommended, and catches the four most common deploy-blocking mistakes:
  - `STRIPE_SECRET_KEY` starts with `sk_test_` while `NODE_ENV=production`
  - `CLERK_SECRET_KEY` starts with `sk_test_` while `NODE_ENV=production`
  - `ALLOW_DEMO_AUTH=true` left on in production
  - `DATABASE_URL` / `REDIS_URL` empty
- **Sentry init** — `apps/api/src/observability/sentry.ts`. Optional via `SENTRY_DSN`. Lazy-imports `@sentry/node` so a missing package doesn't break the API. Captures unhandled errors and stamps the release version on every report.
- **DEPLOY.md** — three-path runbook (Render / Railway / Self-hosted), post-deploy verification, Stripe webhook registration, observability setup, rollback procedure, troubleshooting table.

## Test count

| Suite          | Count | Change |
|----------------|-------|--------|
| Phase 1 — 10   | 152   | (no change) |
| Phase 11       | 28    | +12 (live/ready probes + 10 deploy-artefact existence checks) |
| **Total**      | **180** | 178 smoke + 15 unit + 1 Playwright ready |

178/178 contract endpoints green; 15/15 unit tests green; deploy-ready script returns 0 against `apps/api/.env.production.example`.

## What ships as `apps/api/.env.production.example`

```
NODE_ENV=production
PORT=4000
WEB_ORIGIN=https://animbook.com,https://www.animbook.com

DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/animbook?schema=public
REDIS_URL=rediss://default:PASSWORD@HOST:6379

CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_...
ALLOW_DEMO_AUTH=false

ANTHROPIC_API_KEY=sk-ant-api03-...
ANTHROPIC_BOOK_BRAIN_MODEL=claude-sonnet-4-5
RUNWAY_API_KEY=
ELEVENLABS_API_KEY=
OPENAI_API_KEY=

STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PREMIUM_MONTHLY=
STRIPE_PRICE_PREMIUM_YEARLY=
STRIPE_PRICE_STUDIO_MONTHLY=
STRIPE_PRICE_STUDIO_YEARLY=

CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_BUCKET=animbook-media
CLOUDFLARE_CDN_BASE=https://media.animbook.com

SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1
RELEASE=animbook-api@0.11.0
```

The deploy-ready script flags Stripe and Clerk test keys as a hard-fail when `NODE_ENV=production`.

## Three deployment paths

### Path A — Render (~30 min, recommended for first cohort)
1. Web service (Docker) at `apps/api/Dockerfile`. Health check `/api/health/ready`.
2. Web service (Docker) at `apps/web/Dockerfile`. Build args for public env.
3. Managed Postgres + Key Value (Redis).
4. Custom domain on both services.
5. Run the smoke against the prod URLs.

### Path B — Railway (~30 min)
1. New project from this repo.
2. Add Postgres + Redis from the catalog — Railway auto-sets `DATABASE_URL` + `REDIS_URL`.
3. Two services (API + Web), both Dockerfiles.
4. Custom domain.

### Path C — Self-hosted (`docker compose -f docker-compose.prod.yml`)
1. Fill `apps/api/.env.production` + `apps/web/.env.production`.
2. `docker compose -f docker-compose.prod.yml --env-file apps/api/.env.production up -d --build`
3. `caddy run --config Caddyfile` for TLS.

## Post-deploy verification

```bash
ANIMBOOK_API_URL=https://api.animbook.com \
ANIMBOOK_WEB_URL=https://animbook.com \
node scripts/run-all-smokes.ps1
# → 178 passed, 0 failed

# Stripe live?
curl -X POST https://api.animbook.com/api/subscriptions/checkout \
  -H "Content-Type: application/json" \
  -d '{"plan":"PREMIUM","successUrl":"https://animbook.com/?demo=1","cancelUrl":"https://animbook.com/pricing"}'
# Returns a stripe.com URL (not demo_checkout=1).

# Anthropic live? Watch the SSE for "claude-sonnet-4-5" mention, not the stub fallback.
```

## Operational fixes in this phase

- **API now reports its release** — every startup logs `[animbook-api] release: animbook-api@0.11.0`. Sentry reports inherit the same release id.
- **Health endpoint split** — `/api/health` keeps the smoke-friendly shape (with integration flags); `/api/health/live` is the cheap liveness probe; `/api/health/ready` checks DB + Redis and returns 503 when any dependency is down. Load balancers should hit `ready` and `live` separately.
- **Cache wrapper exports `ensureConnected`** — used by the readiness probe to lazily open the Redis socket.

## What's deferred (intentionally)

- **CI/CD pipeline** — Render and Railway both auto-deploy from the connected GitHub repo on `main` push. That's the simplest possible CI. A proper GitHub Actions pipeline with separate staging/production promotion is Phase 13.
- **Cloudflare WAF / DDoS protection** — the Caddyfile is a TLS terminator; for real DDoS use Cloudflare's free tier in front of the domain.
- **Signed CDN URLs** — the cloudflare.ts `cdnUrl()` returns public URLs. For premium-tier videos, signed URLs are Phase 13.
- **Backup automation** — `pg_dump` nightly + S3 is in DEPLOY.md's "Rollback" section but not automated yet.
- **Multi-region** — single region for the first cohort. Multi-region read replicas are Phase 13.

## Quick-start for the first cohort

1. **Provision** (Render): web service for API + Web, managed Postgres + Redis.
2. **Keys**: paste `apps/api/.env.production.example` → fill real Stripe live + Anthropic + Clerk live → keep the optional ones (Runway, ElevenLabs, Cloudflare, Sentry) blank until the cohort actually needs them.
3. **Verify**: `node scripts/check-deploy-ready.mjs apps/api/.env.production` → expect `0 hard-fail`.
4. **Deploy**: push to `main` (auto-deploy) or `render deploy`.
5. **Smoke**: `ANIMBOOK_API_URL=https://api.animbook.com node scripts/run-all-smokes.ps1` → 178 passed.
6. **Stripe webhook**: dashboard → add endpoint → `https://api.animbook.com/api/subscriptions/webhook` → events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` → paste signing secret into `STRIPE_WEBHOOK_SECRET`.
7. **First reader**: hand the URL to a real person. Watch Sentry + uptime.

## Files added

- `apps/api/Dockerfile`
- `apps/web/Dockerfile`
- `apps/mobile/Dockerfile`
- `apps/tv/Dockerfile`
- `apps/api/.env.production.example`
- `apps/web/.env.production.example`
- `apps/api/src/observability/sentry.ts`
- `docker-compose.prod.yml`
- `Caddyfile`
- `DEPLOY.md`
- `scripts/check-deploy-ready.mjs`
- `PHASE-12-SCORECARD.md` (this file)

## Files modified

- `apps/api/src/config/env.ts` — adds `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`, `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `RELEASE`.
- `apps/api/src/modules/health/routes.ts` — adds `/live` + `/ready` probes.
- `apps/api/src/cache/index.ts` — exports `ensureConnected` for the readiness probe.
- `apps/api/src/index.ts` — calls `initSentry()`, captures exceptions on the error middleware, logs release on startup. Disables CSP via helmet (Next handles its own).
- `apps/web/next.config.mjs` — adds `output: "standalone"`.
- `scripts/smoke-phase11.mjs` — adds 12 health + deploy-artefact checks.
