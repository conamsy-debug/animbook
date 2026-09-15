# AnimBook — A book that moves

> Every page of any written work, animated, narrated, cinematic — at the reader's pace.

AnimBook is a new medium: a written manuscript becomes a living, animated,
narrated experience that unfolds as the reader flips. The flip is the product.
When the reader is ready, the page turns with weighted 3D physics, narration
advances, and the picture moves. When they linger, the picture holds.

> _AnimBook was conceived in Africa. It proves itself in Africa first. Not
> because Africa is a test market but because Africa is where the need is
> largest, the creativity is deepest, and the hunger for what AnimBook offers
> is most immediate._

## What AnimBook ships today (Phase 11)

11 build phases shipped end-to-end (11 phases shipped at every major checkpoint). **152/152** contract endpoints green
across 12 smoke suites, 4 services live (api · web · mobile · tv), 12 verticals
defined, 24 API modules, 20+ Prisma models. 30+ AnimBooks seeded.

| # | Phase                                    | Status | Modules                                                                                                  |
|---|------------------------------------------|--------|----------------------------------------------------------------------------------------------------------|
| 1 | Foundation                               | ✅     | schema · auth (Clerk + demo) · Reader 3 modes · Library · Studio 1-4                                      |
| 2 | Growth                                   | ✅     | EDU · KIDS · FAITH · CREATOR · PUBLISHERS · OFFLINE · 10-lang narration · BUSINESS SCORM                  |
| 3 | Next-gen 1-6                             | ✅     | MEMORY · ORACLE · LENS · ECHO · LIVE TRANSLATION · LIVE                                                   |
| 4 | Next-gen 4                               | ✅     | WORLDS (Lagos Nights trilogy) · STAGE · SIGNAL · NETWORK                                                 |
| 5 | Archive + School                         | ✅     | AnimBook ARCHIVE (oral history + sensitivity + consent) · AnimBook SCHOOL (classrooms + assignments)     |
| 6 | DREAM + STUDIO PRO                       | ✅     | WELLNESS auto-profile · companion markers + NFC ids                                                      |
| 7 | Mobile + Apple TV web                    | ✅     | Expo SDK 53 / RN 0.79 (mobile) · Vite + React 18 (TV) · expo-router · animated page-flip                  |
| 8 | Mobile polish                            | ✅     | Haptics · Blur overlays · Notifications · Deep links (Universal + App + native scheme)                    |
| 9 | Apple TV native source                   | ✅     | `@react-native-tvos/config-tv@0.1.6` · tvOS block in app.json · `eas.json` 5 profiles                    |
| 10| Apple TV expansion                       | ✅     | TvReader w/ TTS · multi-shelf focus engine · top-shelf image                                             |
| 11| Production hardening                     | ✅     | docs refresh · error boundaries · loading states · Prisma indexes · Redis cache · rate-limit · DOCS vertical · 20+ new books · pricing tiers · pricing page · ToS · Privacy · Refund · GDPR endpoints · i18n content |

12 verticals supported: EDU · FAITH · KIDS · CONSUMER · BUSINESS · VERSE ·
WELLNESS · TRAVEL · DOCS · LAW · COMICS · ORIGINALS (each with its own color
token; see `packages/domain/src`).

## Architecture

```
animbook/
├── apps/
│   ├── api/                  # Node + Express + Prisma + Bull + SSE
│   │   └── src/
│   │       ├── modules/      # 24 routers — books, library, studio, edu, kids, faith,
│   │       │                 #            creator, publishers, offline, business, memory,
│   │       │                 #            oracle, live, translation, worlds, stage,
│   │       │                 #            signal, network, archive, school, dream,
│   │       │                 #            studio-pro, achievements, subscriptions, health
│   │       ├── services/     # bookBrain, runway, elevenlabs, cloudflare, stripe,
│   │       │                 # pipeline (Bull), checkpointGenerator,
│   │       │                 # difficultyCalibration, misconceptionDatabase,
│   │       │                 # curriculumMapping, kids, memory, oracle,
│   │       │                 # narrationLanguages, dream, studioPro
│   │       ├── studio/       # SSE pub/sub for live pipeline progress
│   │       ├── auth/         # Clerk middleware + JWKS verifier
│   │       └── config/       # env loader + feature flags
│   ├── web/                  # Next.js 14 (pages router) + Framer Motion + Zustand
│   │   └── src/
│   │       ├── pages/        # /, /library, /read/[id], /dream, /companion, /terms, /privacy …
│   │       ├── components/   # Topbar, ReaderStage, ReaderControls, ErrorBoundary
│   │       ├── lib/          # api client, store, cache, speech fallback
│   │       └── styles/       # design system
│   ├── mobile/               # Expo SDK 53 + expo-router (mobile + tvOS native source)
│   └── tv/                   # Apple TV web shell — Vite + React 18
├── packages/domain/          # shared DTOs + vertical colour tokens
├── scripts/
│   ├── smoke-phase{1..10}.mjs # 152 endpoint smokes across 12 suites
│   ├── run-all-smokes.ps1     # powershell runner → smoke-all.log
│   └── watch-shells.mjs       # node supervisor (WIP)
├── PHASE-{1..11}-SCORECARD.md
├── AGENTS.md                 # agent handbook (canonical)
├── README.md                 # this file
├── docker-compose.yml        # Postgres 16 + Redis 7 (Windows ports 6000 + 6001)
└── .env.example
```

## AnimBooks seeded (30+ titles)

- **CONSUMER** — _The Night Train_ · _The Coast of Mombasa_ · _The Last Train_ (Lagos Nights 1) · plus 4 more
- **KIDS** — _The Tale of Peter Rabbit_ + 3 bedtime originals
- **EDU** — _Mitosis: A Living Cell Divides_ + 2 curriculum-tied titles
- **FAITH** — _The Lord's Prayer · Illuminated_ + 2 cross-tradition pieces
- **WELLNESS** — _The Sleeping Coast_ + DREAM-tuned originals
- **TRAVEL** — _The Coast of Mombasa_ + 2 city guides
- **VERSE** — _A Poem for Lagos_ + Lagos Nights 2 & 3
- **BUSINESS** — _The First 90 Days at Your New Job_ + 2 L&D titles
- **ARCHIVE** — _Voices of the Lagoon_ (HIGH-tier, with consents + cultural notes)
- **DOCS** — added in Phase 11 — see `prisma/phase7-seed.ts` extension

All AnimBooks render with public-domain or AnimBook Originals text; the AI
fills animation, narration, and posters. **Text is never changed.**

## The Studio pipeline

Every AnimBook Studio project is a state machine:

```
SETUP → UPLOAD → BOOK_BRAIN → STYLE → VIDEO_GENERATION → AUDIO → READY_TO_PUBLISH → PUBLISHED
```

- **Book Brain** calls Claude (`claude-sonnet-4-5` when `ANTHROPIC_API_KEY` is
  set). Returns characters, settings, page manifest, style recommendation. When
  the key is missing, a deterministic stub produces a plausible Book Brain.
- **Video generation** calls Runway Gen-3 per page. When the key is missing or
  the request fails, every page gets a stub URL.
- **Audio production** calls ElevenLabs v2 per page. When the key is missing,
  the Reader's browser `SpeechSynthesis` plays the page text.

The Studio frontend subscribes via Server-Sent Events
(`/api/studio/projects/:id/events`); Bull runs each stage as a job on Redis.

## Live-when-keys, fallback-otherwise

Every AI / payments integration is gated by a feature flag in
`apps/api/src/config/env.ts`. The integration clients return documented stubs
when their respective env vars are absent:

| Feature           | Live env var                                            | Fallback behaviour |
|-------------------|---------------------------------------------------------|--------------------|
| Book Brain        | `ANTHROPIC_API_KEY`                                     | Deterministic local Brain |
| Runway video      | `RUNWAY_API_KEY`                                        | Placeholder video URL + amber quality score |
| ElevenLabs        | `ELEVENLABS_API_KEY`                                    | Stub audio + `SpeechSynthesis` in the Reader |
| Cloudflare R2     | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_R2_ACCESS_KEY_ID` | `data:` URL stub (now also serves via `CLOUDFLARE_CDN_BASE` when set) |
| Stripe Checkout   | `STRIPE_SECRET_KEY`                                     | Demo checkout URL with `demo_checkout=1` |
| Clerk auth        | `CLERK_SECRET_KEY`                                      | Demo user `demo@animbook.com` for local dev |

The Reader never breaks silently.

## Page flip is sacred

| Surface | Engine | Notes |
|---------|--------|-------|
| Web     | Framer Motion spring `cubic-bezier(0.34, 1.56, 0.64, 1)` | 3D perspective 1800px |
| Mobile  | `Animated.timing` w/ rotateY ±180 | perspective 1800, 540-880ms |
| Apple TV| `useFocusGroup` (D-pad) + `TvReader` w/ SpeechSynthesis | Same UX as remote |

Keyboard nav: ←, →, Space, Enter. Touch: swipe horizontally.

## Mobile-first, 375px first

Every screen is designed for 375px width and expands to tablet / desktop with
CSS Grid. Top bar collapses to the brand mark. The Reader's text and animation
stack vertically on phones and sit side-by-side on tablet / desktop.

Apple TV inverts the constraint — 1920×1080 minimum, focus scales 1.06× on
focus, animated backgrounds for the focused tile.

## Quick start (Windows / PowerShell)

```powershell
# 1. Start infra (Postgres :6000, Redis :6001)
docker compose up -d

# 2. Install (allows legacy peer deps for Next 14 + Apollo v4)
npm install --legacy-peer-deps --prefer-offline

# 3. Generate Prisma client + apply all migrations
$env:DATABASE_URL = 'postgresql://animbook:animbook_local@localhost:6000/animbook?schema=public'
$env:REDIS_URL = 'redis://localhost:6001'
Copy-Item .env.example apps/api/.env
npm run db:generate
npm run db:migrate

# 4. Run all seed scripts (consumers, edu, kids, faith, business, memory,
#    worlds, archive, school, dream, studio-pro)
npm run db:seed
npx tsx prisma/edu-seed.ts
npx tsx prisma/kids-seed.ts
npx tsx prisma/phase2-seed.ts
npx tsx prisma/phase3-seed.ts
npx tsx prisma/phase4-seed.ts
npx tsx prisma/phase5-seed.ts
npx tsx prisma/phase5-promote.ts
npx tsx prisma/phase6-seed.ts

# 5. Start the 4 services
npm run dev:api                                              # :4000
npm run dev:web                                              # :3000
node apps/mobile/serve-dist.mjs 3005                         # Expo web export
node apps/tv/serve-dist.mjs 3006                             # Vite build

# 6. Verify everything
node scripts/smoke-phase1.mjs    # 16/16
node scripts/smoke-edu.mjs       # 9/9
node scripts/smoke-kids.mjs      # 8/8
node scripts/smoke-phase2.mjs    # 13/13
# … through phase10
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-all-smokes.ps1
# smoke-all.log → "152 passed, 0 failed"
```

Open <http://localhost:3000> for the web shell, `:3005` for the Expo mobile
preview, `:3006` for the Apple TV web shell.

## Verifying Phase 11 (production hardening)

```powershell
node scripts/smoke-phase11.mjs    # 24/24 — Redis cache, rate-limit, GDPR, pricing, ToS
```

Suites in this phase:

- **Performance** — Redis-cached `/api/books` returns `X-Cache: HIT` within TTL,
  rate-limit middleware 429s after 30 RPM on `/api/studio/analyze`, Prisma hot
  paths query-EXPLAIN with the new indexes.
- **Content** — DOCS vertical visible in `/api/books/verticals`, 30+ AnimBooks
  total, 3 translated language packs shipped.
- **Legal** — `/terms`, `/privacy`, `/pricing`, `/refund` render at HTTP 200 and
  carry the right H1; `/api/legal/pricing` returns 3 SKUs; `/api/account/export`
  and `/api/account/delete` return the right JSON.
- **Resilience** — `<ErrorBoundary>` wraps `/read/[id]` + `/library`, the
  `/explode` route renders the error state, the loading shell + empty-state
  component are present in 6 critical pages.

## Native build (Apple TV — Mac only)

```bash
cd apps/mobile
npm install -g eas-cli
eas login
eas build --platform ios --profile production-tvos   # native tvOS bundle
```

`apps/mobile/BUILDING.md` has the full Mac checklist.

## Where to go next

- **Wire keys + ship** — set `ANTHROPIC_API_KEY` + `STRIPE_SECRET_KEY`, push
  to Railway/Render, fire up the first paying cohort.
- **App Store** — Apple Developer account + TestFlight beta → submit;
  Android via internal track.
- **Authoring at scale** — `AnimBook Studio` (`/studio`) is the
  self-service authoring tool; partners use it to publish without an engineer.
- **Verticals next** — `LAW` + `COMICS` schemas are ready; content still
  needs an editorial partner.
- **Compliance** — COPPA / FERPA review for KIDS / SCHOOL before schools
  enroll; GDPR export + deletion are live in Phase 11 — ready for EU traffic.

See [AGENTS.md](./AGENTS.md) for the developer handbook.
