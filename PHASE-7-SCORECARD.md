# AnimBook · Phase 7 Scorecard

**Date:** 2026-07-25
**Scope:** Ship mobile (Expo iOS + Android) and Apple TV shells. No API keys required — every stub is wired.

---

## What shipped

### AnimBook Mobile — `apps/mobile`

**Stack:** Expo SDK 53 + React Native 0.79 + TypeScript + expo-router + react-native-web. Web-runnable preview; ready for `expo run:ios` / `expo run:android` on a Mac with Xcode.

| Tab | Surface | Endpoint surface |
|---|---|---|
| **Library** | Curated book rows, vertical filter pills, mobile-first 375px | `GET /api/books` |
| **Reader** | Page-flip (Animated 3D rotateY), poster + body text, prev/next | `GET /api/books/:slug`, `GET /api/books/:slug/pages` |
| **Memory** | Profile stat grid + 5 presets + Lens/Echo toggles | `GET/PUT /api/memory/settings` |
| **Dream** | Drift log + stat cards, ambient info, CTA to open session | `GET /api/dream/sessions`, `GET /api/dream/profile/:slug`, `POST /api/dream/sessions` |
| **Companion** | Book picker, AR marker tile, NFC tag display, anchor pin, session logger | `GET/POST /api/studio-pro/companion/:slug`, `POST /api/studio-pro/sessions` |
| **Worlds** | World cards with accent-coloured borders | `GET /api/worlds` |
| **Profile** | API base, health check, 14-of-14 next-gen summary | `GET /api/health` |

**Animations:** 3D page flip using `Animated.timing` (perspective 1800, rotateY ±180, flipDuration 540–880ms). DREAM banner with pulsing well colour. Mirrors the web Reader's spring.

**File layout:** `apps/mobile/app/(tabs)/*.tsx` (expo-router file-based tabs) + `apps/mobile/app/read/[slug].tsx` (deep reader) + `apps/mobile/src/{api,theme}.ts`.

**Build:** `expo export --platform web` → 1.85 MB JS bundle, 1.18 KB HTML. Servable from `apps/mobile/dist/`. PWA-installable on iOS Safari and Android Chrome.

### AnimBook TV — `apps/tv`

**Stack:** Vite + React 18 + TypeScript. Pure web app designed for tvOS Safari / AirPlay; runs in any 1920×1080 browser.

| View | Purpose | Controls |
|---|---|---|
| **Library** | 4-col grid of large book tiles, jump-to cards | D-pad + Enter |
| **Reader** | Side-by-side poster + 42px body text, "Read aloud" via `SpeechSynthesis` | D-pad + Enter |
| **Worlds** | World cards with accent borders | D-pad + Enter |
| **Dream** | Drift log overview | D-pad + Enter |
| **Companion** | Per-book NFC tag id + marker hash + anchor page | D-pad + Enter |
| **Profile** | API base + health + 14-of-14 summary | D-pad + Enter |

**Focus manager** (`src/useFocus.ts`): single roving tabindex, Arrow keys move the focus ring with a 6% scale + gold border glow, Enter (or Space) clicks. Top-level `Escape` returns to Library.

**Deep linking:** `?book=<slug>`, `?marker=<hash>`, `?nfc=<tagId>` — TV reader auto-resolves via `/api/studio-pro/scan/{marker,nfc}/...` and jumps straight to the anchor page.

**Build:** `vite build` → 1.58 KB HTML + 160 KB JS (50 KB gzipped). Servable from `apps/tv/dist/`.

---

## Verification

### 9-suite smoke — 112 / 112 ✅

| Suite | Endpoints | Result |
|---|---|---|
| `smoke-phase1.mjs` | 16 | **16/16** ✅ |
| `smoke-edu.mjs` | 9 | **9/9** ✅ |
| `smoke-kids.mjs` | 8 | **8/8** ✅ |
| `smoke-phase2.mjs` | 13 | **13/13** ✅ |
| `smoke-phase3.mjs` | 12 | **12/12** ✅ |
| `smoke-phase4.mjs` | 14 | **14/14** ✅ |
| `smoke-phase5.mjs` | 11 | **11/11** ✅ |
| `smoke-phase6.mjs` | 15 | **15/15** ✅ |
| `smoke-phase7.mjs` | 14 | **14/14** ✅ |
| **Total** | **112** | **112/112 ✅** |

### Live services

| Port | Service | Status |
|---|---|---|
| `4000` | API (Node + Express + Prisma + Bull) | **200 ✅** |
| `3000` | Web (Next.js 14) | **200 ✅** |
| `3005` | Mobile shell (Expo web export) | **200 ✅** |
| `3006` | Apple TV shell (Vite build) | **200 ✅** |

---

## Workspace inventory

```
animbook/
├── apps/
│   ├── api/          # 24 modules — Phase 6 still the high-water mark
│   ├── web/          # 23 pages — same surface, mobile/TV ready
│   ├── mobile/       # NEW — Expo SDK 53 + RN 0.79 + TS + expo-router
│   └── tv/           # NEW — Vite + React + TS, 10-foot UI
├── packages/
│   └── domain/       # shared vertical colour tokens
├── scripts/
│   ├── smoke-phase{1..7}.mjs
│   └── edu/kids seeds
├── AGENTS.md         # operating contract (read before touching)
├── PHASE-6-SCORECARD.md
└── PHASE-7-SCORECARD.md  # this file
```

---

## What this enables

- **iOS shell** — `cd apps/mobile && npx expo run:ios` on a Mac opens the app on a simulator or device. The same source ships via `eas build` for TestFlight / App Store.
- **Android shell** — `cd apps/mobile && npx expo run:android` opens on an emulator or device.
- **Apple TV** — open `http://<host>:3006/` in tvOS Safari (or AirPlay from iPhone), use the Apple TV remote for D-pad navigation.
- **PWA** — open `http://<host>:3005/` on iPhone Safari, "Add to Home Screen" — installs as a full-screen app icon.
- **Demo loop** — every screen on every shell reaches the live AnimBook API, so the demo is consistent across web, mobile, TV.

---

## Next moves (your call)

1. **Real API keys** — wire `RUNWAY_API_KEY`, `ELEVENLABS_API_KEY`, `STRIPE_SECRET_KEY`, `CLOUDFLARE_*`, `ANTHROPIC_API_KEY`, `CLERK_*`. The smoke tests will exercise the live paths.
2. **Mobile / TV polish** — gesture-based flips on mobile (swipe), haptics via `expo-haptics`, blur overlays via `expo-blur`, push notifications, deep-link `animbook://read/<slug>`.
3. **Production hardening** — rate limiting, observability, Sentry, real auth on the TV shell.
4. **Apple TV native build** — `react-native-tvos` would give a real tvOS binary. Source compiles; needs a Mac.
5. **iOS/Android submission** — `eas build --platform ios --platform android` from the `apps/mobile` workspace once the bundle IDs and signing certs are set.