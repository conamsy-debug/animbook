# AnimBook — Deploy Runbook

> One-page deployment guide for getting AnimBook from this repo into a
> production environment. Three paths: **Railway** (recommended — best DX
> for monorepos), **Render** (alternative), **Docker + Caddy**
> (self-hosted, full control).

For the full step-by-step Railway walkthrough see **[docs/RAILWAY-DEPLOY.md](docs/RAILWAY-DEPLOY.md)**.

## 0. Pre-flight

```powershell
# Confirm the env file you'll ship is ready.
node scripts/check-deploy-ready.mjs apps/api/.env.production

# The script returns:
#   0 hard-fail · 11 recommended.  ← ship-able; integrations will run in stub mode
#   0 hard-fail · 0 recommended.   ← full live (Anthropic + Stripe + Runway + Sentry)
```

The script catches the four most common deploy-blocking mistakes:
- `STRIPE_SECRET_KEY` starting with `sk_test_` while `NODE_ENV=production`
- `CLERK_SECRET_KEY` starting with `sk_test_` while `NODE_ENV=production`
- `ALLOW_DEMO_AUTH=true` left on in production
- Missing `DATABASE_URL` / `REDIS_URL`

## 1. Where to deploy

| Option       | Time to live | Cost (small)   | Best for                              |
|--------------|--------------|----------------|----------------------------------------|
| **Railway**  | ~30 min      | ~$5/mo (Hobby) | Monorepos, Nixpacks auto-detect.       |
| Render       | ~30 min      | ~$15/mo        | Simpler UI; pricier for small loads.   |
| Fly.io       | ~45 min      | ~$5/mo         | Multi-region.                          |
| Self-hosted  | ~2 hrs       | server cost    | Maximum control. Caddyfile in repo.    |

**Recommendation: Railway.** Two services (`animbook-api` + `animbook-web`)
from one repo, both pointing at the same Neon Postgres + Upstash Redis
that are already provisioned. Full step-by-step in
**[docs/RAILWAY-DEPLOY.md](docs/RAILWAY-DEPLOY.md)**.

## 2. Path A — Railway (recommended)

Quick path:

1. **Project**: https://railway.app → Login with GitHub → **New Project**
   → **Empty Project** → name it `animbook`.

2. **API service**:
   - **+ New** → **GitHub Repo** → `Echad-Group/animbook`.
   - **Settings → Build → Custom Build Command:** `npm install --legacy-peer-deps && npm run build:api`
   - **Custom Start Command:** `npm run start:api`
   - **Variables** → paste the contents of `apps/api/.env.production`.
   - **Healthcheck Path:** `/api/health/ready`
   - **Generate Domain** to get a free `*.up.railway.app` URL.

3. **Web service**:
   - **+ New** → **GitHub Repo** → `Echad-Group/animbook` again.
   - **Build Command:** `npm install --legacy-peer-deps && npm run build:web`
   - **Start Command:** `npm run start:web`
   - **Variables** → paste `apps/web/.env.production`.
   - **Healthcheck Path:** `/`
   - **Generate Domain**.

4. **DNS** (Cloudflare):
   - `www.animbook.com` → CNAME → `<web>.up.railway.app`
   - `api.animbook.com` → CNAME → `<api>.up.railway.app`
   - Apex (`animbook.com`): Cloudflare free can't flatten apex CNAMEs. Two options:
     - Redirect apex → `www` via Cloudflare Rules (works on free plan)
     - Or set A record to Cloudflare's published IPs + enable proxy (they proxy A records)
   - Railway auto-issues Let's Encrypt once you add the custom domain in the service settings.

5. **Smoke after deploy**:
   ```bash
   export ANIMBOOK_API_URL=https://api.animbook.com
   export ANIMBOOK_WEB_URL=https://animbook.com
   node scripts/smoke-phase{1..11}.mjs
   ```

## 3. Path B — Render

1. **API service** (Web Service, Docker):
   - Root directory: `apps/api`
   - Dockerfile path: `apps/api/Dockerfile`
   - Plan: Starter
   - Env group: paste the contents of `apps/api/.env.production` (or set
     each var individually).
   - Health check path: `/api/health/ready`
   - Auto-deploy: off until first green

2. **Web service** (Web Service, Docker):
   - Root directory: `apps/web`
   - Dockerfile path: `apps/web/Dockerfile`
   - Build args: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
     `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_RELEASE`
   - Health check path: `/`

3. **Postgres**: Render managed Postgres, copy the connection string into
   the API service's `DATABASE_URL`. Move off `:6000` in production —
   Render uses its own port.

4. **Redis**: Render Key Value (Redis 7), copy the URL into
   `REDIS_URL` (with `rediss://` for TLS).

5. **Custom domain** on the Web service (e.g. `animbook.com`) + on the
   API (`api.animbook.com`).

## 4. Path C — Self-hosted (Docker Compose)

```bash
# 1. Fill env files.
cp apps/api/.env.production.example apps/api/.env.production
$EDITOR apps/api/.env.production
cp apps/web/.env.production.example apps/web/.env.production
$EDITOR apps/web/.env.production

# 2. Pre-flight.
node scripts/check-deploy-ready.mjs apps/api/.env.production

# 3. Bring up.
docker compose -f docker-compose.prod.yml --env-file apps/api/.env.production up -d --build

# 4. Confirm health.
curl https://api.animbook.com/api/health/ready
# {"status":"ready","checks":{"db":"ok","redis":"ok"},"integrations":{...}}

# 5. Front it with Caddy (already configured in Caddyfile).
caddy run --config Caddyfile
```

## 5. Post-deploy verification

```bash
# 5.1 — Smoke every suite (12 suites × 14 endpoints).
ANIMBOOK_API_URL=https://api.animbook.com \
ANIMBOOK_WEB_URL=https://animbook.com \
node scripts/run-all-smokes.ps1

# 5.2 — Confirm Stripe live.
curl -X POST https://api.animbook.com/api/subscriptions/checkout \
  -H "Content-Type: application/json" \
  -d '{"plan":"PREMIUM","successUrl":"https://animbook.com/?demo=1","cancelUrl":"https://animbook.com/pricing"}'
# Returns a stripe.com checkout URL (not demo_checkout=1).

# 5.3 — Confirm Anthropic live (POST a tiny manuscript to /api/studio/.../analyze
# and watch the SSE — the message should mention "claude-sonnet-4-5" not the
# stub fallback).

# 5.4 — Watch the readiness probe.
watch -n 2 'curl -s https://api.animbook.com/api/health/ready | jq .'
```

## 6. Observability

- **Sentry** (optional, free tier): create a project at
  https://sentry.io → Node / Express. Copy the DSN into
  `SENTRY_DSN`. AnimBook reports errors, performance, and release
  metadata.
- **Uptime monitoring**: BetterUptime or UptimeRobot free tier pointing
  at `https://api.animbook.com/api/health/ready`. Set the check to
  alert when the response code is not 200 for two consecutive
  checks (30s apart). Don't alert on `/api/health/live` — that's
  the process liveness, not the dependencies.
- **Logs**: pipe stdout to a service (Render captures this by default;
  on self-hosted use Promtail + Loki, or just `docker logs -f`).

## 7. Stripe webhooks

After the API is live, register the webhook:

1. https://dashboard.stripe.com → Webhooks → Add endpoint
2. Endpoint URL: `https://api.animbook.com/api/subscriptions/webhook`
3. Events: `checkout.session.completed`,
   `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

AnimBook's webhook handler is at
`apps/api/src/modules/subscriptions/routes.ts` and verifies the
signature with `STRIPE_WEBHOOK_SECRET`.

## 8. Rollback

- **Render / Railway**: revert the deploy.
- **Self-hosted**: `docker compose -f docker-compose.prod.yml down &&
  git checkout <previous-tag> && docker compose … up -d --build`.
- **Database**: `pg_dump -Fc animbook > animbook-$(date +%Y%m%d).dump`
  nightly. Keep the last 14 days.

## 9. Where to look when it breaks

| Symptom                          | Look at                                              |
|----------------------------------|------------------------------------------------------|
| 503 on /api/health/ready         | DB or Redis down — check `docker compose ps`.        |
| 401 from /api/subscriptions/checkout | `STRIPE_SECRET_KEY` not set or wrong env.       |
| Book Brain returns stub          | `ANTHROPIC_API_KEY` missing or quota exhausted.      |
| Videos 404                       | `CLOUDFLARE_CDN_BASE` not set, R2 not public.        |
| Webhook returns 400              | `STRIPE_WEBHOOK_SECRET` doesn't match the dashboard.|
| Reader loads but no narration    | `ELEVENLABS_API_KEY` missing — fallback is browser TTS. |
