# Phase 11 — Production hardening

> AnimBook ships ready. 30 AnimBooks live, 152+16 contract endpoints green, all 12 verticals surfaced, GDPR endpoints live, ToS / Privacy / Refund / Pricing pages rendered, pricing tiers wired through to Stripe SKUs.

## Themes

This phase isn't a new feature — it's the doorway between shipping and running. Five themes:

1. **Docs refresh** — `AGENTS.md` and `README.md` rewritten to reflect all 11 phases, 12 verticals, 24 API modules, and the new infrastructure (rate-limit, Redis cache, CDN env, GDPR endpoints).
2. **Resilience** — Error boundaries wrap the Reader + Library so one bad page doesn't nuke the shell. `<LoadingState />` and `<EmptyState />` replace inline placeholders across the most-trafficked pages. The Reader falls back to a compact error message and a Try-again button.
3. **Performance** — Redis cache-aside wrapping `GET /api/books` (60s TTL, vary on Accept-Language) and `GET /api/worlds` (120s TTL). Rate-limit middleware applied to `POST /api/studio/projects/:id/analyze` (30 RPM / user). Six hot-path Prisma indexes added. CDN base URL surfaced from `CLOUDFLARE_CDN_BASE`.
4. **Content** — 19 new AnimBooks seeded across under-represented verticals, bringing the library from 11 → **30** titles. DOCS vertical fully implemented (5 procedural AnimBooks). 3 translation packs (en→sw, en→fr, en→es) seeded with pronunciation + example sentences.
5. **Business / legal** — `GET /api/legal/pricing` returns the 3-tier table (Reader / Premium / Studio) with monthly + yearly Stripe price placeholders. ToS, Privacy, Refund pages published. GDPR Art. 17 (erasure) + Art. 20 (portability) endpoints wired with audit row preserved.

## New files

**API**
- `apps/api/src/cache/index.ts` — Redis cache-aside wrapper, shares client with Bull pipeline.
- `apps/api/src/middleware/rateLimit.ts` — In-memory token-bucket middleware.
- `apps/api/src/modules/legal/routes.ts` — `/api/legal/pricing`, `/api/account/export`, `/api/account/delete`.
- `apps/api/prisma/phase11-seed.ts` — 19 AnimBooks + 3 translation packs.
- `apps/api/prisma/migrations/20260726170000_phase11_hot_path_indexes/` — 6 new indexes.

**Web**
- `apps/web/src/components/ErrorBoundary.tsx` — `<ErrorBoundary />` + `<ErrorState />`.
- `apps/web/src/components/States.tsx` — `<LoadingState />` + `<EmptyState />`.
- `apps/web/src/components/LegalPage.tsx` — shared layout for legal/pricing pages.
- `apps/web/src/pages/pricing.tsx` — pricing page.
- `apps/web/src/pages/legal/terms.tsx`, `legal/privacy.tsx`, `legal/refund.tsx`.

**Infra**
- `apps/api/.env` (new, gitignored), `.env.example` (committed) — correct Docker ports `6000` / `6001`.

**Tests**
- `scripts/smoke-phase11.mjs` — 16 new contract checks.

## Updated files

- `AGENTS.md`, `README.md` — full rewrite for 11 phases.
- `apps/api/prisma/schema.prisma` — 6 new composite indexes.
- `apps/api/src/config/env.ts` — adds `CLOUDFLARE_R2_BUCKET`, `CLOUDFLARE_CDN_BASE`; fixes default Docker ports.
- `apps/api/src/services/cloudflare.ts` — `cdnUrl(key)` resolver.
- `apps/api/src/modules/books/routes.ts` — `withCache` on `GET /`.
- `apps/api/src/modules/worlds/routes.ts` — `withCache` on `GET /`.
- `apps/api/src/modules/studio/routes.ts` — `rateLimit` on `POST /projects/:id/analyze`.
- `apps/api/src/modules/worlds/routes.ts` — README consistency.
- `apps/web/src/pages/_app.tsx` — top-level `<ErrorBoundary />`.
- `apps/web/src/pages/index.tsx` — error boundary + loading/empty + 12-vertical blurb refresh.
- `apps/web/src/pages/read/[id].tsx` — error boundary on Reader + loading/empty.
- `apps/web/src/pages/book/[slug].tsx` — error boundary + loading/empty.
- `apps/web/src/pages/profile.tsx` — error boundary + loading/empty + GDPR buttons.
- `apps/web/src/components/Topbar.tsx` — added Pricing link.
- `apps/web/src/styles/globals.css` — added `.legal-page`, `.pricing-page`, `.loading-state`, `.empty-state`, `.error-state` styles.

## Pricing tiers

| Tier    | Monthly | Yearly | Headline feature                                  |
|---------|---------|--------|---------------------------------------------------|
| Reader  | Free    | Free   | Three AnimBooks in your Library, MEMORY adaptive profile, DREAM mode for WELLNESS. |
| Premium | $9      | $90    | Unlimited, offline reading, ARCHIVE tier access, Companion app. |
| Studio  | $49     | $490   | AnimBook Studio pipeline, SCORM 2004 packaging, Studio PRO markers + NFC ids. |

Stripe price id placeholders surfaced:
- `price_premium_monthly_animbook`
- `price_premium_yearly_animbook`
- `price_studio_monthly_animbook`
- `price_studio_yearly_animbook`

When `STRIPE_SECRET_KEY` is set the live price ids come from env vars (`STRIPE_PRICE_PREMIUM_MONTHLY` etc.) — wired in `modules/subscriptions/routes.ts`. Until then the demo checkout URL is returned with `demo_checkout=1`.

## GDPR endpoints

| Method | Path                    | Article | Behaviour                                                    |
|--------|-------------------------|---------|--------------------------------------------------------------|
| GET    | `/api/account/export`   | Art. 20 | Streams a JSON attachment with user + library + memory + telemetry + dream sessions. |
| POST   | `/api/account/delete`   | Art. 17 | Soft-deletes library, achievements, memory, signals, dream, API keys, subs. Anonymises email + clerkId + stripeCustomerId. Keeps audit row. |

Both endpoints are gated behind `authMiddleware`. Demo auth is enabled in `apps/api/.env` so the smoke can exercise them.

## Test count

| Suite               | Count | Notes                                            |
|---------------------|-------|--------------------------------------------------|
| Phase 1             | 16    |                                                  |
| edu                 | 9     |                                                  |
| kids                | 8     |                                                  |
| Phase 2             | 13    |                                                  |
| Phase 3             | 12    |                                                  |
| Phase 4             | 14    |                                                  |
| Phase 5             | 11    |                                                  |
| Phase 6             | 15    |                                                  |
| Phase 7             | 14    |                                                  |
| Phase 8             | 12    |                                                  |
| Phase 9             | 15    |                                                  |
| Phase 10            | 13    |                                                  |
| **Phase 11 (new)**  | **16**| Cache X-Cache headers, pricing, GDPR, DOCS, 30 books, legal pages, scorecard, README/AGENTS refresh |
| **Total**           | **168** | All green on fresh DB. |

## Operational fixes

1. **`.env` was missing** — `apps/api/.env` didn't exist, so the API was reading a `dotenv/config` loaded nothing and Prisma was blowing up at startup with "DATABASE_URL not found" because the JS loader fallback never reached Prisma. Created `.env` at `apps/api/` (gitignored) with the correct ports `6000` / `6001`. Also fixed `required()` defaults in `apps/api/src/config/env.ts` which were still pointing at the Windows-reserved `55433` / `56380`.

2. **`@types/ioredis` was a stub pointing at types that don't exist in ioredis@5.11** — rewrote `apps/api/src/types/ioredis.d.ts` to provide first-party types covering the surface we use (Redis, status enum, scanStream, lazyConnect).

3. **`tsconfig.types: ["node"]`** was blocking auto-load of other `@types/*` packages — kept as-is since ioredis is in the local d.ts.

4. **Demo data getting stale** — cache TTL of 60s on `/api/books` means a fresh seed takes 60s to surface in the Library. Acceptable for production; for tests, smokes re-query after a warm-up pass.

## What ships in Phase 11

- ✓ 30 AnimBooks (was 11)
- ✓ All 12 verticals surfaced (DOCS implemented)
- ✓ Error boundaries across shell + Reader
- ✓ Loading + empty states across 6 critical pages
- ✓ Redis cache HIT/MISS stamped through middleware
- ✓ Rate-limit middleware (30 RPM on AI endpoints)
- ✓ 6 hot-path indexes
- ✓ CDN env wired
- ✓ ToS / Privacy / Refund / Pricing pages
- ✓ 3-tier pricing in API
- ✓ GDPR export + delete
- ✓ 3 translation packs

## What we explicitly deferred

- **Character licensing beyond Peter Rabbit** — real Beatrix Potter estate licence would be a legal/business deal, not engineering. The schema supports per-publisher revenue share (`Publisher.revenueSharePct` + `RoyaltyEntry`).
- **50+ AnimBooks target** — got to 30; need a real editorial partner to triple that without recycling verticals.
- **Vitest unit tests + Playwright E2E** — scheduled for Phase 12 (or pick this up here if your "now" includes them).
- **TypeScript `any` audit + remove** — TS strict is on; loose `any`s are localised to interface boundaries (e.g. `req.user`). Cleaning this up locks down the API surface but is not blocking.
- **Mongo→Postgres hot-path indexes** — partial indexes via Prisma raw migration are also possible for `(userId, bookId, completed)` style queries; Phase 12.
- **CDN URL signing** — `cdnUrl()` resolves to public URLs; signed URLs are Phase 12.

## Quick start (recap)

```powershell
# Cache HIT example
curl -I http://localhost:4000/api/books?status=PUBLISHED
# -> X-Cache: MISS (first call)
curl -I http://localhost:4000/api/books?status=PUBLISHED
# -> X-Cache: HIT (60s TTL)

# Pricing
curl http://localhost:4000/api/legal/pricing
curl http://localhost:3000/pricing

# GDPR
curl http://localhost:4000/api/account/export -o my-data.json
curl -X POST http://localhost:4000/api/account/delete -H "Content-Type: application/json" -d '{"confirm":true}'
```
