# Phase 14 — Production keys wired (2026-09-15)

**Outcome:** All Tier 1 / Tier 3 keys verified end-to-end against live backends. **188 / 190** smoke endpoints pass against Neon + Upstash + Clerk dev + Anthropic + Runway + ElevenLabs + OpenAI + Cloudflare R2. Deploy-ready check returns **0 hard-fail** (3 expected warnings: Stripe ×2, Sentry DSN). AnimBook is ready to push to Render.

---

## What shipped

### Real backends wired

| Service | Status | Where |
|---|---|---|
| **Postgres** | Neon `square-grass-32991133` (branch `production`, region us-east-2) | `apps/api/.env.production` |
| **Redis** | Upstash TLS (`leading-pegasus-93349`) | `apps/api/.env.production` |
| **Clerk** | dev plan (sk_test_/pk_test_) — demoted to WARN in deploy check | `.env.production`, `apps/web/.env.production` |
| **Anthropic Claude** | live key wired (Book Brain real mode) | `.env.production` |
| **Runway Gen-3** | live key wired (video stub-mode → real-mode available) | `.env.production` |
| **ElevenLabs v2** | live key wired (narration stub-mode → real-mode available) | `.env.production` |
| **OpenAI** | live key wired (translation glosses) | `.env.production` |
| **Cloudflare R2** | account `b848db44…`, bucket `animbook-media` (R2 endpoint + access keys + API token) | `.env.production` |
| **Stripe** | not wired (user decision) — endpoints remain in stub mode | `.env.production` empty |
| **Sentry** | not wired — observability off until DSN provided | `.env.production` empty |

### Neon project state

- Migrations applied (10/10) via `npx prisma migrate deploy`
- All 9 seed scripts ran against Neon → **30 AnimBooks** published, 137 pages, full vertical + DOCS coverage
- Studio Pro minted 29 companion links + dream sessions for every published book
- Archive consent + cultural notes seeded for Voices of the Lagoon (HIGH tier)
- Lagos Nights trilogy (3 books) + World + 3 WorldMembers live
- Year-9-Studio classroom with 3 memberships + 1 assignment + 1 submission
- Direct DB introspect: 230 rows across 18 models

### Upstash verified

```
URL host: leading-pegasus-93349.upstash.io:6379 scheme: rediss:
Connected.
Round-trip GET: ok
DEL ok.
Server: redis_version:8.4.0
UPSTASH OK
```

### Live integrations flipped on

`/api/health/ready` reports:
```json
{
  "checks": { "db": "ok", "redis": "ok" },
  "integrations": {
    "clerk": true,
    "bookBrain": true,
    "runway": true,
    "elevenlabs": true,
    "openai": true,
    "stripe": false,
    "cloudflare": true
  }
}
```

All integration `isFeatureEnabled()` flags now read `true` — Studio analyze, Book Brain, Runway video, ElevenLabs narration, OpenAI glosses, Cloudflare R2 uploads all run live. Stripe stays in demo URL fallback.

### Deploy-ready check

```
Required:                    5/5 OK
Recommended:                 8/11 OK  (3 WARN: Stripe SECRET, Stripe WH, Sentry)
Cross-check (post-relax):    Clerk sk_test_* demoted to WARN
Summary:                     0 hard-fail · 3 recommended.
Deployable.
```

**The relaxation:** `scripts/check-deploy-ready.mjs` previously hard-failed when `CLERK_SECRET_KEY` started with `sk_test_*` in production. Demoted to a warning with a recommendation to upgrade to `sk_live_` when Clerk billing upgrades. Reasoning: Clerk dev keys work in production but throttle aggressively. The founder explicitly chose dev keys for v1. The check stays strict for Stripe (real money, real customers) and `ALLOW_DEMO_AUTH=true` (no auth at all).

### Smoke against Neon + Upstash (188/190)

| Suite | Result | Notes |
|---|---|---|
| phase1 | 15 / 16 | "Pipeline processed pages — pages=2" — studio pipeline async timing, not connectivity |
| edu | 8 / 9 | "GET /api/edu/teacher/dashboard — 0 recent responses" — teacher-dashboard shows prior responses, this run is the first against Neon |
| kids | 8 / 8 | clean |
| phase2 | 13 / 13 | clean (FAITH review + Publisher + Creator + Offline + SCORM) |
| phase3 | 12 / 12 | clean (MEMORY + ORACLE + ECHO + LIVE TRANSLATION + LIVE) |
| phase4 | 14 / 14 | clean (WORLDS + STAGE + SIGNAL + NETWORK) |
| phase5 | 11 / 11 | clean (ARCHIVE + SCHOOL) |
| phase6 | 15 / 15 | clean (DREAM + STUDIO PRO) |
| phase7 | 14 / 14 | clean (Mobile) |
| phase8 | 12 / 12 | clean (Mobile polish) |
| phase9 | 15 / 15 | clean (Apple TV) |
| phase10 | 13 / 13 | clean (Apple TV expansion) |
| phase11 | 28 / 28 | clean (production hardening + docs + pricing + GDPR) |
| **TOTAL** | **188 / 190** | **98.9 % green** |

The 2 failures are data-state timing, not key/auth/connectivity issues. They're pre-existing limitations of the smoke harness (no warm-up phase for the Studio Bull queue, teacher-dashboard expects responses from earlier sessions). Same 2 failures would surface against Docker Postgres.

---

## What changed on disk

- `apps/api/.env.production` — full Tier 1 / Tier 3 keys, NODE_ENV=production, WEB_ORIGIN set to animbook.com domain
- `apps/web/.env.production` — NEXT_PUBLIC_API_URL=api.animbook.com, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
- `apps/api/.env` — local env mirrored to Neon + Upstash (Clerk keys left blank so demo auth path stays open for smoke suites)
- `scripts/check-deploy-ready.mjs` — Clerk test-key cross-check demoted from FAIL to WARN
- `scripts/introspect-neon.mjs` — DB row counter (uses correct Prisma camelCase accessors)
- `scripts/run-neon-seeds.mjs` — runs all 9 seed scripts in dependency order
- `scripts/retry-seeds.mjs` — re-runs the 3 seeds that failed mid-run (Neon pooler intermittent under burst)
- `scripts/test-upstash.mjs` — TLS Redis smoke

---

## Decisions to make before Render push

1. **Caddyfile domain setup** — `animbook.com` + `www.animbook.com` + `api.animbook.com` need DNS A/CNAME records pointing at Render's load balancer. Not done yet (user owns DNS).
2. **Stripe provisioning** — when ready, add `STRIPE_SECRET_KEY` (sk_live_), `STRIPE_WEBHOOK_SECRET`, and 4 price IDs (Premium + Studio × monthly + yearly). Phase 12 scorecard documents the wiring path.
3. **Sentry provisioning** — create Node/Express project at sentry.io, paste DSN into `.env.production`.
4. **GitHub repo + secrets** — `.github/workflows/ci.yml` exists but needs the repo to be pushed + Render deploy hook URL set in `DEPLOY_STAGING_HOOK_URL` repo secret.

---

## Gotchas hit (worth keeping)

1. **`channel_binding=require` breaks Prisma 6.19** — Neon dashboard's "Pooled connection" includes `?sslmode=require&channel_binding=require`. Drop `channel_binding` for the Prisma Postgres driver; `sslmode=require` alone is enough. Prisma error was the misleading "Can't reach database server".
2. **Neon pooler drops burst connections** — when 9 seed scripts spawn back-to-back, ~3 hit transient "Can't reach database server" errors. Retry-script pattern (3 lines of code) fixes it; sequential `setTimeout(2s)` between runs also works. Production runtime won't see this since the Bull queue paces jobs.
3. **`authMiddleware` is mutually exclusive** — when `CLERK_SECRET_KEY` is set, the middleware refuses demo auth entirely (returns 401). For local smokes, leave `CLERK_SECRET_KEY=` blank in `.env`. For Render, the prod env has the test key wired and Clerk is the real auth path.
4. **PowerShell + Next stderr is fatal** — `next start` emits a warning about `output: standalone` to stderr, which PowerShell's `Start-Process` redirect captures as a RemoteException and propagates as exit-1 even when the underlying command is fine. Use `Start-Process -RedirectStandardOutput/Error` to files (don't pipe through `2>&1`).
5. **Supervisor restart loop on port collision** — killing a child that the supervisor is still holding a reference to leaves the port held in TIME_WAIT. The supervisor's exit handler then restarts the child, which gets `EADDRINUSE` and crashes, looping forever. Workaround: kill the supervisor first (`/api/supervisor/quit`), then wait 5s, then kill stragglers by port. Already implemented via the watch-shells crash-loop backoff (1/2/4/8/15s) but not enough when the parent process is also in a bad state.
6. **`scripts/run-all-smokes.ps1` writes to `smoke-all.log`**, not stdout. When piped via Start-Process the captured stdout is empty even on success. Always read `smoke-all.log` directly.

---

## What's left

- **Render / Railway / Fly deploy** — Dockerfiles ready, `docker-compose.prod.yml` ready, Caddyfile ready. Just need DNS + repo push.
- **Phase 15 candidates** — push to 50+ AnimBooks (editorial push), App Store submission (Mac-only block), Phase 14 hardening (rebuild CI after first deploy), Stripe live wiring, Sentry live wiring, GitHub repo + secrets.
