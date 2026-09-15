# AnimBook — Agent Notes

This is the canonical entry point for any agent picking up the AnimBook monorepo.
Read this before touching the codebase.

## What AnimBook is

A new medium: every page of any written work becomes a living, animated, narrated
cinematic experience controlled at the reader's pace. The reader flips when
ready — that flip is the product.

> _AnimBook was conceived in Africa. It proves itself in Africa first. Not because
> Africa is a test market but because Africa is where the need is largest, the
> creativity is deepest, and the hunger for what AnimBook offers is most immediate._

## Build progress

11 phases shipped end-to-end on a fresh database, 152/152 smoke endpoints green,
4 services (api · web · mobile · tv) live. See `PHASE-*-SCORECARD.md` for each
phase; the latest is `PHASE-10-SCORECARD.md` (Apple TV expansion).

| Phase | Theme                                                                  | Status |
|-------|------------------------------------------------------------------------|--------|
| 1     | Foundation — schema, auth, Reader 3 modes, Library, Studio 1-4         | ✅     |
| 2     | Growth — EDU · KIDS · FAITH · CREATOR · PUBLISHERS · OFFLINE · 10-lang · BUSINESS SCORM | ✅ |
| 3     | Next-gen 1-6/14 — MEMORY · ORACLE · LENS · ECHO · LIVE TRANSLATION · LIVE | ✅ |
| 4     | Next-gen 4/14 — WORLDS · STAGE · SIGNAL · NETWORK                      | ✅     |
| 5     | ARCHIVE (oral history + sensitivity + consent) + SCHOOL (classrooms)   | ✅     |
| 6     | Last 2 next-gen — DREAM (WELLNESS profile) + STUDIO PRO (companions)   | ✅     |
| 7     | Mobile (Expo SDK 53 / RN 0.79) + Apple TV web shell (Vite + React 18)  | ✅     |
| 8     | Mobile polish — Haptics · Blur · Notifications · Deep links            | ✅     |
| 9     | Apple TV native build source — tvOS config + eas.json profiles         | ✅     |
| 10    | Apple TV expansion — TTS Reader · multi-shelf focus engine · top shelf  | ✅     |
| 11    | Production hardening — docs, error boundaries, indexes, cache, ToS/Privacy, pricing, GDPR, i18n content | ✅ (this phase) |

12 verticals supported by the schema (11 implemented, DOCS pending in Phase 11).

## Repository layout

```
animbook/
├── apps/
│   ├── api/                         # Node + Express + Prisma + Bull + SSE
│   │   ├── prisma/
│   │   │   ├── schema.prisma        # 20+ models (incl. Dream, Companion, Archive, School)
│   │   │   ├── seed.ts              # CONSUMER (3 books)
│   │   │   ├── edu-seed.ts          # EDU (mitosis)
│   │   │   ├── kids-seed.ts         # KIDS (Peter Rabbit)
│   │   │   ├── phase2-seed.ts       # FAITH + EDU 2 + 10-language + BUSINESS
│   │   │   ├── phase3-seed.ts       # MEMORY · ORACLE · ECHO · LIVE …
│   │   │   ├── phase4-seed.ts       # WORLDS · STAGE · SIGNAL · NETWORK
│   │   │   ├── phase5-seed.ts       # Voices of the Lagoon · Year 9 Studio
│   │   │   ├── phase5-promote.ts    # demo user → archive_steward + teacher
│   │   │   └── phase6-seed.ts       # DREAM · STUDIO PRO
│   │   └── src/
│   │       ├── modules/             # 24 routers
│   │       │   ├── books · library · studio · subscriptions · health
│   │       │   ├── edu · kids · faith · creator · publishers · offline · business
│   │       │   ├── memory · oracle · live · translation · worlds · stage · signal · network
│   │       │   ├── archive · school · dream · studio-pro · achievements
│   │       └── services/            # bookBrain · runway · elevenlabs · cloudflare · stripe
│   │                                 # pipeline · checkpointGenerator · difficultyCalibration
│   │                                 # misconceptionDatabase · curriculumMapping · kids
│   │                                 # memory · oracle · narrationLanguages · dream · studioPro
│   ├── web/                         # Next.js 14 (pages router) + Framer Motion + Zustand
│   │   └── src/
│   │       ├── pages/               # /, /library, /read/[id], /dream, /companion …
│   │       ├── components/          # Topbar · ReaderStage · ReaderControls · ErrorBoundary
│   │       ├── lib/                 # api client, store, speech fallback, cache
│   │       └── styles/              # design system (--consumer, --edu, --faith, …)
│   ├── mobile/                      # Expo SDK 53 + RN 0.79 + expo-router (mobile + tvOS source)
│   │   ├── app/                     # expo-router files (tabs: library/worlds/memory/dream/companion/profile)
│   │   ├── app/(tv)/                # tvOS routes (focus-friendly)
│   │   ├── app.json                 # expo config + tvOS block (top shelf, capabilities)
│   │   ├── eas.json                 # 5 build profiles (dev · preview · production · production-tvos · preview-tvos)
│   │   ├── BUILDING.md              # Mac-only Apple TV native build instructions
│   │   └── src/                     # api.ts · haptics.ts · notifications.ts · theme.ts
│   └── tv/                          # Apple TV web shell — live preview today, source-of-truth for web
│       └── src/                     # TvApp · TvReader · TvLibrary · useFocus · useTvShelf
├── packages/domain/                 # shared types: verticals, worlds, AnimBook DTOs, color tokens
├── scripts/
│   ├── smoke-phase{1..10}.mjs       # 152 endpoint contract smokes (12 suites)
│   ├── run-all-smokes.ps1           # powershell runner → smoke-all.log
│   └── watch-shells.mjs             # node supervisor (WIP — watch every 30-min)
├── PHASE-{1..11}-SCORECARD.md       # one per phase
├── AGENTS.md                        # this file
├── README.md                        # human-facing pitch + quick start
├── docker-compose.yml               # Postgres 16 + Redis 7 (Windows ports 6000/6001)
└── .env.example
```

## Operating invariants

1. **The page flip is sacred.** Web uses Framer Motion spring physics
   (`cubic-bezier(0.34, 1.56, 0.64, 1)`). Mobile uses `Animated.timing` with
   perspective 1800, rotateY ±180, flipDuration 540-880ms. TV drives the same
   flip via `useFocusGroup` keyboard arrows. Keyboard nav: ←, →, Space, Enter.

2. **Text is never changed.** Every page renders the manuscript text verbatim
   on the left side. The AI only fills `animationPrompt`, `videoUrl`,
   `audioUrl`, `vttUrl`, `posterUrl`.

3. **EDU and FAITH require expert review.** `Book.requiresExpertReview` +
   `Book.expertReviewStatus` are enforced at the publish endpoint (HTTP 409
   unless `APPROVED`).

4. **All API keys in env vars.** Centralised in `apps/api/src/config/env.ts`.
   Each integration has `isFeatureEnabled()` and the live HTTP call falls back
   to a documented stub when the key is missing.

5. **Graceful fallbacks everywhere.** Runway stub = placeholder video URL,
   quality score 0.6. ElevenLabs stub = `data:audio/wav` + `data:text/vtt`.
   Anthropic stub = deterministic Book Brain. Clerk missing = demo user.

6. **Mobile-first, 375px.** Every screen stacks to 1 column under 720px.

7. **Bull queue + SSE for pipeline.** The Studio runs the 5-stage pipeline as
   Bull jobs on Redis. Frontend subscribes via Server-Sent Events at
   `/api/studio/projects/:id/events`. Never block API routes on long jobs.

8. **Every EDU checkpoint must record the response** with timestamp +
   correctness — these feed the teacher dashboard and the learning engine.

9. **Archive HIGH/SACRED requires consents + cultural notes.** ARCHIVE publish
   gate returns 409 unless there's at least one consent record and one
   cultural-sensitivity note per published piece.

10. **DREAM profile is a pure function.** No AI / DB. `dreamProfileForBook(
    {vertical, moodTags, genreTags, title})` returns a deterministic palette +
    pacing + narration speed + motion level. WELLNESS vertical triggers it
    automatically on Reader unmount via `navigator.sendBeacon`.

11. **STUDIO PRO companion IDs are deterministic.** Marker id =
    `sha256("animbook.studio.pro.v1:" + bookId)`. NFC id =
    `sha256("animbook-nfc-v1:" + bookId).slice(0,14)`. Re-running seeds
    produces identical IDs.

12. **API runs from `dist/src/index.js`.** No auto-reload on file change —
    bg tasks + manual restart handle the cycle. This bypasses the Windows
    esbuild host/binary version mismatch.

## Vertical colour tokens (per Constraint #2)

| Vertical   | Token          |
|------------|----------------|
| EDU        | `#1A6B3C`      |
| FAITH      | `#6B2D8B`      |
| KIDS       | `#D9872A`      |
| CONSUMER   | `#1B6B8A`      |
| BUSINESS   | `#B58B27`      |
| VERSE      | `#9D4C73`      |
| WELLNESS   | `#3F8172`      |
| TRAVEL     | `#14818E`      |
| DOCS       | `#56738A`      |
| LAW        | `#7A6650`      |
| COMICS     | `#C94B32`      |
| ORIGINALS  | `#C49A1C`      |

The full palette lives in `packages/domain/src/index.ts` and is mirrored into
`apps/web/src/styles/globals.css` under `--consumer`, `--kids`, `--edu`,
`--faith`, `--docs`, `--law`, `--comics`, `--originals`, etc.

## How to run things

```powershell
# 1. Infrastructure (Windows ports 6000 + 6001; 55433 / 56380 are reserved)
docker compose up -d

# 2. Install
npm install --legacy-peer-deps --prefer-offline

# 3. DB — generated + migrated
$env:DATABASE_URL = 'postgresql://animbook:animbook_local@localhost:6000/animbook?schema=public'
npm run db:generate
npm run db:migrate

# 4. All seeds (consumers, edu, kids, faith, languages, business, memory, worlds,
#    archive, school, dream, studio-pro, etc.)
npm run db:seed
npx tsx prisma/edu-seed.ts
npx tsx prisma/kids-seed.ts
npx tsx prisma/phase2-seed.ts
npx tsx prisma/phase3-seed.ts
npx tsx prisma/phase4-seed.ts
npx tsx prisma/phase5-seed.ts
npx tsx prisma/phase5-promote.ts
npx tsx prisma/phase6-seed.ts

# 5. Start services (4)
npm run dev:api          # :4000  (also: node dist/src/index.js)
npm run dev:web          # :3000
node apps/mobile/serve-dist.mjs 3005   # Expo web export
node apps/tv/serve-dist.mjs 3006       # Vite build

# 6. Verify everything
node scripts/smoke-phase{1..10}.mjs    # 152 passed, 0 failed
```

## Domain gotchas

- The npm registry is flaky on this Windows box (ECONNRESETs). Always install
  with `--legacy-peer-deps --prefer-offline`, never `--offline`. Pin Next to
  14.2.33 (the 14.2.35 SWC binary isn't published for win32-x64-msvc).
- PowerShell 5.1's `ConvertFrom-Json` rejects JSON with `//` comments.
  Either use `node` to parse JSON, or strip `//` lines first.
- Prisma's `query_engine-windows.dll` is file-locked while the API server
  runs. **Stop the API before running `prisma generate`** (or use the migrate
  helper).
- When you change the Prisma schema, run `prisma migrate dev --name <n>
  --create-only` to authorise the migration, then `prisma migrate deploy` to
  apply.
- The Reader is a CSR-first experience; SSR returns the loading shell. Don't
  expect to see book text on a curl of `/read/<slug>` — verify with the API
  smoke tests instead.
- Background shell tasks have a 30-minute ceiling. Restart cycle required.
  Long-term fix: `scripts/watch-shells.mjs` (Node supervisor — WIP).
- `apps/api/.env` must exist with the actual Docker ports (6000 / 6001).
  The seed-time defaults in `env.ts` are 55433 / 56380 — Windows reserves
  them. **Copy `.env.example` to `apps/api/.env` first.**
- The workspace has a space in the path (`C:\Users\msi 22\…`). Vite needs
  `root: __dirname` via `fileURLToPath` to avoid absolute-looking chunk paths.

## Style rules

- API code: NodeNext ESM, `import { ... } from "../x.js"` even for TS files.
- Web code: bundler ESM, `@/*` alias maps to `./src/*`.
- Strict TypeScript by default; loosen `exactOptionalPropertyTypes` only where
  the framework bindings demand it. Wrap optional fields with
  `if (foo) args.foo = foo` not `args.foo = foo ?? undefined`.
- No `await` in components without a guard. Hooks that return promises need
  cleanup `cancelled` flags.
- Mobile polish layers (`haptics`, `BlurView`, `notifications`) are all
  web-no-op — keeps the web bundle clean.
- Apple TV focus = web keyboard hooks (Arrow + Enter). Same UX surface as
  Apple TV remote, works on tvOS Safari today. Native uses `useFocusGroup`
  from `@react-native-tvos/config-tv`.

## Smoke coverage

12 suites · 152 endpoints · all green on a fresh DB:

```
phase1 (16)   · edu (9)   · kids (8)   · phase2 (13)
phase3 (12)   · phase4 (14) · phase5 (11) · phase6 (15)
phase7 (14)   · phase8 (12) · phase9 (15) · phase10 (13)
```

Run everything: `powershell -NoProfile -ExecutionPolicy Bypass -File
scripts/run-all-smokes.ps1` → `smoke-all.log`.
