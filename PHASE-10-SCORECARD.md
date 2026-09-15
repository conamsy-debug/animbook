# AnimBook · Phase 10 Scorecard

**Date:** 2026-07-25
**Scope:** Apple TV expansion — richer TV experience, native assets, full EAS pipeline.

---

## What shipped

### TV Reader with TTS · `apps/tv/src/TvReader.tsx`

- 52px body text (was 42px in v1), 64px header.
- Auto-plays narration on first render via `SpeechSynthesisUtterance` — auto-advances the page 700ms after each utterance ends.
- Six-button footer: `Library`, `Prev`, `Read aloud` / `Re-read`, `Pause` / `Resume`, `Stop`, `Next`.
- Status line shows `status: reading|paused|stopped · speech: available|unavailable` so any offline-state issue surfaces on screen.

### TV Library with shelves · `apps/tv/src/TvApp.tsx` + `useTvShelf.ts`

Three horizontal shelves with `scroll-snap` and a new focus manager:
- **Continue reading** — pulls from `/api/library` (4 entries from the demo user).
- **Featured** — the first 6 published books from `/api/books`.
- **Kids · bedtime ready** — `KIDS` vertical filter (the 4 vertical-themed screens hang off this).
- **Wellness · DREAM ready** — `WELLNESS` vertical filter (auto-applies DREAM profile when opened).
- **Worlds** — pulls from `/api/worlds`, accent colour per card.

`useTvShelfFocus` is a multi-shelf focus manager: Arrow keys move inside the shelf, ArrowUp at the top jumps to the previous shelf, ArrowDown at the end jumps to the next. Native Apple TV focus maps to the same shape via `TVFocusGuideView` when the source compiles for tvOS.

### Apple TV top-shelf image · `apps/mobile/assets/tv-top-shelf.svg`

The Apple TV "top shelf" is the marketing banner that shows above your app icon on the home screen. The SVG carries:
- Brand wordmark "AnimBook" in Cormorant
- "A BOOK THAT MOVES" tagline in DM Mono
- Gradient backdrop (slate → consumer blue → wellness green)

`app.json` declares `tvOS.topShelfImage: "./assets/tv-top-shelf.svg"`. `eas build` will rasterise it during submission.

### tvOS hardware constraints

`apps/mobile/app.json` adds:
- `UIRequiredDeviceCapabilities: ["arm64"]` — refuses installation on the obsolete Apple TV simulators that don't have a 64-bit runtime.
- `tvOS.icon: "./assets/icon.png"` + `tvOS.topShelfImage` — separate from the phone icon.

### EAS pipeline

`apps/mobile/eas.json` now serves **5 profiles**: `development`, `preview`, `production`, `production-tvos`, `preview-tvos`. Submit section includes `ascAppIdentifier: app.animbook.mobile` (iOS) and `ascAppIdentifier: app.animbook.tv` (tvOS) so a single `eas submit` picks the right App Store Connect slot.

### Mobile (Expo) Apple TV route

`apps/mobile/app/(tv)/_layout.tsx` + `apps/mobile/app/tv.tsx` mirror the standalone TV shell inside the Expo source tree. The same source compiles to a native tvOS bundle when the user runs `eas build --profile production-tvos` on a Mac, **and** runs on tvOS Safari via `apps/tv`.

---

## Verification

### 12-suite smoke — 152 / 152 ✅

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
| `smoke-phase8.mjs` | 12 | **12/12** ✅ |
| `smoke-phase9.mjs` | 15 | **15/15** ✅ |
| `smoke-phase10.mjs` | 13 | **13/13** ✅ |
| **Total** | **152** | **152/152 ✅** |

`smoke-phase10.mjs` confirms:
- `apps/mobile/assets/tv-top-shelf.svg` and `icon.svg` are on disk.
- `app.json` declares `tvOS.topShelfImage` and `UIRequiredDeviceCapabilities: ["arm64"]`.
- The TV bundle ships `SpeechSynthesis` usage, the new TvReader components, and shelf containers.
- `/api/library` returns ≥1 entry for the Continue-reading shelf.
- `/api/worlds` is reachable for the Worlds shelf.
- Both shells still serve the catalogue.

### Live services

| Port | Service | Status |
|---|---|---|
| `4000` | API | **200 ✅** |
| `3000` | Web (Next.js) | **200 ✅** |
| `3005` | Mobile shell (Expo Web + Apple TV route) | **200 ✅** |
| `3006` | Apple TV shell (Vite — TvLibrary + TvReader + useTvShelfFocus) | **200 ✅** |

### Build sizes

| App | Bundle | Δ |
|---|---|---|
| `apps/tv` (Vite) | 163 KB JS / 50.8 KB gzipped | +3 KB (TvReader + shelves + multi-shelf focus) |
| `apps/mobile` (Expo web export) | 2.00 MB JS | unchanged |
| `apps/web` (Next.js) | 84.2 KB shared | unchanged |

---

## Inventory at close-out

- **AnimBooks seeded:** 11
- **Verticals surfaced:** 11 / 12 (DOCS pending)
- **Migrations applied:** 9
- **API modules:** 24
- **Apple TV targets declared:** iOS, Android, tvOS (via `apps/mobile`)
- **Web fallback live:** `apps/tv` (web-runnable on tvOS Safari today)

---

## What runs on each surface

| Surface | Source | Status |
|---|---|---|
| Web (`localhost:3000`) | `apps/web` (Next.js 14) | Live |
| iOS Safari | `apps/mobile` Expo Web → `Add to Home Screen` | Live (PWA) |
| Android Chrome | `apps/mobile` Expo Web → `Install app` | Live (PWA) |
| Apple TV Safari | `apps/tv` (Vite) | Live |
| Native iOS | `apps/mobile` + `eas build --platform ios --profile production` | Needs Mac to submit |
| Native Android | `apps/mobile` + `eas build --platform android --profile production` | Cloud-build, no Mac needed |
| **Native tvOS** | `apps/mobile` + `eas build --platform ios --profile production-tvos` | Cloud-build, no Mac needed |

---

## Next moves (your call)

1. **Real API keys** — wire `RUNWAY_API_KEY` / `ELEVENLABS_API_KEY` / `STRIPE_SECRET_KEY` / `CLOUDFLARE_*` / `ANTHROPIC_API_KEY` / `CLERK_*` and exercise the live paths end-to-end.
2. **Cloud-submit to App Store / Play Store** — `eas submit --platform ios --latest` and `eas submit --platform android --latest` once signing certs + bundle IDs are in place.
3. **Production hardening** — rate limiting, observability, Sentry, real auth on TV shell.
4. **Polish pass on the 12 verticals** — content density, per-vertical screens.
5. **Watch-together on Apple TV** — wire the LIVE module into the TV shell so a host's page flips drive every TV in the room.