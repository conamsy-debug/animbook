# Phase 13 — Operational maturity + CI

> AnimBook now has a single-command local supervisor, a full CI pipeline that gates `main`, and an auto-generated API catalogue. The 30-min background-task ceiling is no longer an interactive blocker.

## What shipped

- **Robust shell supervisor** — `scripts/watch-shells.mjs` rewritten:
  - Status endpoint on `:4099` (`GET /api/supervisor/status`) — JSON snapshot of every child (pid, uptime, restart count, last healthy, last exit code)
  - Healthcheck-driven restart — port stays up but unhealthy for 6 consecutive checks (~30s) → kill + restart, regardless of exit code
  - Crash-loop guard — exponential backoff (1s, 2s, 4s, 8s, 15s) when a service dies in <3s
  - Uses compiled API (`node dist/src/index.js`) instead of `tsx` — boots in 200ms instead of 3s
  - Reads from `apps/api/.env` so port / key settings stay in one place

- **Docker ports fixed** — `docker-compose.yml` was using the Windows-reserved `55433` / `56380` even though the API expected `6000` / `6001`. Now aligned. Whoever provisions the local stack can run `docker compose up -d` without surprise port collisions.

- **GitHub Actions CI** — `.github/workflows/ci.yml`:
  - `lint-and-typecheck` — `tsc --noEmit` on api + web
  - `unit-tests` — `node --test apps/api/tests/*.test.mjs` after a fresh build
  - `contract-smoke` — boots Postgres + Redis as service containers, runs the supervisor, waits for all 4 ports, executes the 180-test smoke
  - `deploy-ready` — runs `scripts/check-deploy-ready.mjs apps/api/.env.production.example` to keep the deploy contract honest
  - `deploy-staging` — fires Render deploy hook on `main` push (gated on the 3 jobs above)

- **Public API catalogue**
  - `apps/api/src/appRoutes.ts` — single source of truth for every route (26 modules, 61 endpoints)
  - `GET /api/docs` — JSON catalogue (consumed by `/docs` page + tooling)
  - `/docs` — search + filter (HTTP method), grouped by module, with auth requirement badges
  - Replaces the need for integrators to grep the source

- **Playwright config migrated** — `apps/web/playwright.config.ts` → `apps/web/playwright.config.mjs` so Next.js typecheck + webpack don't try to import `@playwright/test` (not installed in this Windows sandbox).

## Test count

| Suite          | Count |
|----------------|-------|
| Phase 1 — 10   | 152   |
| Phase 11       | 28    |
| **Phase 13**   | 178 (no new suite — supervisor verified, smoke verified) |
| **Total smoke**| **180** |

180/180 contract endpoints green · 15/15 unit tests green.

## Files added

- `scripts/watch-shells.mjs` (rewritten)
- `apps/api/src/appRoutes.ts` (single source of truth for routes)
- `apps/api/src/modules/docs/routes.ts` (`/api/docs` + `/api/docs.json`)
- `apps/web/src/pages/docs.tsx` (catalogue UI)
- `apps/web/playwright.config.mjs` (moved out of the typecheck path)
- `.github/workflows/ci.yml` (CI pipeline + Render deploy hook)

## Files modified

- `apps/api/src/index.ts` — mounts `/api/docs` router
- `apps/web/src/styles/globals.css` — adds `.docs-page`, `.docs-table`, `.method-tag`, `.auth-tag`
- `docker-compose.yml` — `55433/56380` → `6000/6001` to match `apps/api/.env`

## Supervisor contract

```http
GET  http://localhost:4099/api/supervisor/status
POST http://localhost:4099/api/supervisor/quit
```

Sample response:
```json
{
  "supervisor": "animbook-watch-shells",
  "services": [
    {
      "id": "api", "running": true, "pid": 27620, "uptimeSeconds": 51,
      "restartCount": 1, "consecutiveFailCount": 0, "lastHealthyAt": 1787006169438,
      "lastExitCode": null
    },
    { "id": "web", ... },
    { "id": "mobile", ... },
    { "id": "tv", ... }
  ]
}
```

This means the smoke suite can now `wait-for-supervisor` instead of `wait-for-port` per service — one endpoint, machine-readable status.

## CI integration

```yaml
# `.github/workflows/ci.yml`
contract-smoke:
  services:
    postgres: { image: postgres:16-alpine, ports: [6000:5432] }
    redis:    { image: redis:7-alpine,   ports: [6001:6379] }
  steps:
    - npm ci --legacy-peer-deps --prefer-offline
    - npx prisma migrate deploy -w @animbook/api
    - npm run build -w @animbook/api
    - npm run build -w @animbook/web
    - node scripts/watch-shells.mjs &  # 1 process, 4 services
    - powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-all-smokes.ps1
```

When `RENDER_DEPLOY_HOOK` is set as a GitHub repo secret, a successful `main` push goes straight to staging.

## Operational notes

1. **Docker ports finally align** — was a phantom bug. Phase 12 opened Postgres on `55433` (the Windows-reserved default), but `.env` pointed at `6000`. New containers inherit `docker-compose.yml`, so a fresh `docker compose up -d` now matches the app's expectation. Anyone reading the repo gets what they see.
2. **Supervisor pattern** — the 30-min sandbox ceiling still applies to *the supervisor itself*, not its children. So every ~30 min the supervisor dies; the next time you run it, it brings the 4 children back inside ~3s. Single shell command instead of four.
3. **Auto-generated catalogue** — when adding a new endpoint, add a row to `appRoutes.ts` next to the existing module. The `/docs` page picks it up on next build; the smoke suite (`scripts/smoke-phase11.mjs`) keeps the deploy artefacts honest regardless.
4. **CI runs on Windows runners** — the `run-all-smokes.ps1` is PowerShell, the supervisor is Node, the smoke is Node + PowerShell. Same as local; no surprises.

## What still needs work

- **GitHub repo + secrets** — the workflow file is in place but isn't running until you push this repo to GitHub + add `RENDER_DEPLOY_HOOK` as a secret.
- **Supervisor as Windows service** — `nssm install animbook-supervisor "C:\Program Files\nodejs\node.exe" "C:\path\to\scripts\watch-shells.mjs"` would let the supervisor survive the sandbox ceiling altogether. That's the real fix; we just need a permanent Linux VM (Render / Fly / Hetzner) for production anyway.
- **Vitest + Playwright actual installs** — configs are written; install on a Mac or Linux CI runner to light them up.
- **Cache TTL tuning** — 60s for `/api/books` is fine for now. With real traffic + live Stripe keys, we'd want per-endpoint TTLs on `/api/legal/pricing` (cache 5 min — those change rarely) and `/api/subscriptions/status` (cache 0 — must reflect the live subscription).
- **Anonymous GitHub README badge** — once the repo is public, add `[![CI](https://github.com/animbook/animbook/actions/workflows/ci.yml/badge.svg)](…)` to surface the green bar in the marketing surface.

## Quick start (next session)

```powershell
# 1. Boot the supervisor.
node scripts/watch-shells.mjs

# 2. Confirm everything is healthy.
curl http://localhost:4099/api/supervisor/status | jq

# 3. Hit the docs.
start http://localhost:3000/docs
curl http://localhost:4000/api/docs | jq '.totalRoutes'
# → 61

# 4. Run the full smoke.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-all-smokes.ps1
# → 180 passed, 0 failed
```

If you kill the sandbox, restart everything with that first command. Done.
