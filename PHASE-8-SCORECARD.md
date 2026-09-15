# AnimBook · Phase 8 Scorecard

**Date:** 2026-07-25
**Scope:** Mobile polish — haptics, blur overlays, notifications, deep linking. No API keys required.

---

## What shipped

### Haptics · `apps/mobile/src/haptics.ts`

Five feedback primitives around `expo-haptics`, every call short-circuits on web so the bundle stays clean:

| Helper | Used by | Fallback |
|---|---|---|
| `hapticFlip()` | `app/read/[slug].tsx` — every page flip | `Medium` impact |
| `hapticLight()` | Library + Profile buttons | `Light` impact |
| `hapticSelection()` | Tab bar switch | `Selection` |
| `hapticSuccess()` | Daily reminder scheduled | `NotificationFeedbackType.Success` |
| `hapticDream()` | DREAM session opens | `Soft` impact |

### Blur overlays · `expo-blur`

| Surface | Effect |
|---|---|
| Tab bar background | `BlurView` intensity 80, tint dark — glassmorphism under the icons |
| Library brand pill | `BlurView` intensity 50 — "11 books" pill floats on the dark surface |
| Reader DREAM banner | `BlurView` intensity 60 — the drift banner feels like wet glass |
| Fallback | On web, swaps to a translucent dark surface so the design holds |

### Notifications · `apps/mobile/src/notifications.ts`

Lazy-loads `expo-notifications` so the web bundle stays free of native code. Exposes:

- `ensureNotificationPermission()` — graceful prompt
- `registerNotificationHandler()` — module-level
- `scheduleLocal({ title, body, data, triggerSeconds, identifier })` — generic
- `scheduleDailyReadingReminder()` — "Your AnimBook is waiting" — 24h, repeating
- `scheduleDreamDriftLog(bookTitle)` — fires 5s after a DREAM session opens
- `cancelAll()` / `cancelScheduled(id)` / `listScheduled()`

`app.json` gains `UIBackgroundModes: ["audio", "remote-notification"]` and Android `POST_NOTIFICATIONS` + `SCHEDULE_EXACT_ALARM` permissions.

The Profile tab now hosts a Notifications card with `Daily reminder` + `Cancel all` buttons that touch the API and live-count the scheduled notifications.

### Deep linking · `apps/mobile/app/+native-intent.tsx`

- Scheme array: `["animbook", "exp+animbook-mobile"]`
- iOS Universal Links: `applinks:animbook.com`, `applinks:www.animbook.com`
- Android intent filters: `https://animbook.com/m/*` with `autoVerify: true`
- Companion deep links: `animbook://read/<slug>`, `animbook://companion/<slug>`, `animbook://dream`, `animbook://memory`
- `useDeepLink()` hook parses via `expo-linking` and logs the URL in dev
- Cold-start handler via `Linking.getInitialURL()` — opens the right screen on first launch

### Tab bar

`app/(tabs)/_layout.tsx` — `tabBarBackground` returns a `BlurView` (or a translucent dark fill on web), and `tabBarStyle` is `absolute + transparent` so the blur shows through. Every tab press fires `hapticSelection()`.

### Library

`app/(tabs)/index.tsx` — animated brand row with a glassmorphic count pill; book-row press fires `hapticLight()` before navigating.

### Reader

`app/read/[slug].tsx` — every page flip fires `hapticFlip()`. When a DREAM session is opened, `hapticDream()` confirms the ambient track kicked in and a local "DREAM drift · logged" notification is scheduled 5 seconds later.

### Profile

`app/(tabs)/profile.tsx` — adds a Notifications card (permission status, scheduled count, schedule/cancel buttons) and a Deep links card listing the supported URIs.

---

## Verification

### 10-suite smoke — 124 / 124 ✅

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
| **Total** | **124** | **124/124 ✅** |

`smoke-phase8.mjs` confirms the new bundle (`entry-f51bd89ba95c6512e4de5a60ad7389fd.js`) ships the haptics, blur, notifications, and deep-link symbols; that the API surface the polish touches still works; and that the TV shell survives the rebuild.

### Live services

| Port | Service | Status |
|---|---|---|
| `4000` | API | **200 ✅** |
| `3000` | Web (Next.js) | **200 ✅** |
| `3005` | Mobile shell (Expo + polish) | **200 ✅** |
| `3006` | Apple TV shell | **200 ✅** |

### Build sizes

| App | Bundle | Notes |
|---|---|---|
| `apps/mobile` (Expo web export) | 2.04 MB JS | +150 KB from Phase 7 (haptics + blur + notifications) |
| `apps/tv` (Vite) | 160 KB JS | unchanged |
| `apps/web` (Next.js) | 84 KB shared | unchanged |

### TypeScript

`apps/mobile` typecheck is clean. Gotcha hit: `expo-notifications` and `haptics` types use `exactOptionalPropertyTypes: true`, so we wrap the optional `data` and `identifier` fields in `if (foo) args.foo = foo` instead of `args.foo = foo ?? undefined`.

---

## Runtime behaviour

- **Cold start (iOS / Android)** — Expo serves the Reader as the home route. Tapping a tab fires a haptic. Opening a WELLNESS AnimBook pulls the DREAM profile, opens a session, fires `hapticDream()`, and schedules a DREAM drift notification.
- **Deep link** — `animbook://read/the-night-train` from Safari / Mail / a sister app opens the Reader on that book. From a Universal Link like `https://animbook.com/m/read/the-night-train` Android routes the same way.
- **Daily reminder** — Profile > Notifications > Daily reminder schedules a `timeInterval` notification for 24h. Cancel resets the count.
- **Web preview** — served at `:3005`. Haptics no-op. Blur falls back to translucent dark. Notifications module short-circuits. The rest of the shell behaves identically.

---

## Next moves (your call)

1. **Real API keys** — wire `RUNWAY_API_KEY` / `ELEVENLABS_API_KEY` / `STRIPE_SECRET_KEY` / `CLOUDFLARE_*` / `ANTHROPIC_API_KEY` / `CLERK_*` and exercise the live paths.
2. **Apple TV native** — `react-native-tvos` for a real tvOS binary (source compiles; needs a Mac).
3. **iOS / Android submission** — `eas build --platform ios|android` once the bundle IDs and signing certs are set; deep-link `applinks:animbook.com` already wired.
4. **Production hardening** — rate limiting, observability, Sentry, real auth on the TV shell.
5. **Polish pass on the 12 verticals** — the catalogue is shipped; the per-vertical colour tokens are mirrored in the mobile theme; the remaining work is content density and category-specific screens.