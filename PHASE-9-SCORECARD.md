# AnimBook · Phase 9 Scorecard

**Date:** 2026-07-25
**Scope:** Apple TV native build — `react-native-tvos` source ready for Mac to compile, web fallback already serving on tvOS Safari.

> **Platform honesty note.** Native tvOS / iOS builds require macOS with Xcode 15+ (Apple TV Sim runs only on Mac). This phase ships source + config the user can run on a Mac; on Windows we verified the Expo web export that runs on tvOS Safari and on the web emulator path. If you don't have a Mac, `eas build --platform ios --profile production-tvos` builds the .pkg in EAS cloud and ships it to App Store Connect.

---

## What shipped

### Expo source — `apps/mobile`

- **`@react-native-tvos/config-tv@0.1.6`** added as an Expo plugin (matches SDK 53+).
- **`app.json`** declares the three native targets side-by-side:
  - iOS: `app.animbook.mobile`
  - Android: `app.animbook.mobile`
  - **tvOS: `app.animbook.tv`**, `userInterfaceStyle: dark`, ATS-wide-open for dev, `UIBackgroundModes: ["audio"]`
- **`eas.json`** ships 5 profiles: `development`, `preview`, `production`, **`production-tvos`**, **`preview-tvos`**. The tvOS profiles extend `production` but pin the Xcode `targetName: "tvos"` so EAS picks the Apple TV slice at submit time.
- **`app/(tv)/_layout.tsx`** + **`app/tv.tsx`** add the Apple TV 10-foot route inside the Expo source tree. The focus engine uses TVFocusGuideView on tvOS native and falls back to a keyboard-driven focus group on web. The route points at the same AnimBook API as the phone shell.
- **`BUILDING.md`** documents the Mac-only flow: `expo prebuild --platform ios --platform android --clean` → `expo run:ios --target-name "Apple TV 4K (3rd generation)"` for simulator iteration, `eas build --platform ios --profile production-tvos` for App Store Connect submission.

### Web fallback — `apps/tv`

The standalone Vite shell stays as the **Apple TV Safari** runtime. It:
- Runs on tvOS Safari directly — no install required.
- Speaks the page aloud via `SpeechSynthesis`.
- Routes `?book=`, `?marker=`, `?nfc=` deep links via `/api/studio-pro/scan/...`.
- Compiles to 160 KB JS / 50 KB gzipped.

### Why both

| Surface | Best route |
|---|---|
| Want a native `.pkg` on Apple TV | `eas build --profile production-tvos` (needs Apple Developer account) |
| Quick iteration on a Mac | `expo prebuild && expo run:ios --target "Apple TV 4K (3rd generation)"` |
| No Mac, want the Apple TV experience today | `apps/tv` on `:3006` opened in tvOS Safari |
| Just want to verify on a phone | `apps/mobile` Expo web export on `:3005` |

---

## Verification

### 11-suite smoke — 139 / 139 ✅

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
| **Total** | **139** | **139/139 ✅** |

### Live services

| Port | Service | Status |
|---|---|---|
| `4000` | API | **200 ✅** |
| `3000` | Web (Next.js) | **200 ✅** |
| `3005` | Mobile shell (Expo Web + Apple TV route) | **200 ✅** |
| `3006` | Apple TV shell (Vite fallback) | **200 ✅** |

`smoke-phase9.mjs` confirms:
- Expo plugins array contains `@react-native-tvos/config-tv` and the array length is 3.
- `app.json` declares bundle ids for all three native targets (iOS, Android, tvOS).
- `eas.json` declares both `production-tvos` and `preview-tvos` profiles.
- `BUILDING.md` references macOS + Xcode + `expo run:ios` + `eas build`.
- The mobile web export serves `/tv` and ships the focus-route code.
- The standalone `apps/tv` workspace still serves its Vite build.

---

## Build pipeline

| Action | Where | What |
|---|---|---|
| `npm install --workspace=apps/mobile --legacy-peer-deps` | Windows or Mac | Source dependencies |
| `npx expo export --platform web --output-dir dist` | Windows or Mac | Web preview (2.05 MB JS) |
| `npx expo prebuild --platform ios --platform android --clean` | **Mac** | Generates the Xcode + Android Studio projects; runs `@react-native-tvos/config-tv` |
| `npx expo run:ios --target "Apple TV 4K (3rd generation)"` | **Mac** | Iterates against the Apple TV Simulator |
| `eas build --platform ios --profile production-tvos` | Cloud (anywhere) | Builds + signs the tvOS .pkg |
| `eas submit --platform ios --latest` | Cloud (anywhere) | Sends the build to App Store Connect |

---

## Next moves (your call)

1. **Real API keys** — wire `RUNWAY_API_KEY` / `ELEVENLABS_API_KEY` / `STRIPE_SECRET_KEY` / `CLOUDFLARE_*` / `ANTHROPIC_API_KEY` / `CLERK_*` and exercise the live paths.
2. **iOS / Android submission** — `eas build --platform ios --profile production` and `--platform android --profile production` once signing certs and bundle IDs are set.
3. **Production hardening** — rate limiting, observability, Sentry, real auth on the TV shell.
4. **Polish pass on the 12 verticals** — content density and per-vertical screens.
5. **Run on a Mac** — `cd apps/mobile && npx expo prebuild --clean` to generate the iOS / Android / tvOS Xcode projects, then `expo run:ios --target "Apple TV 4K (3rd generation)"` to compile and deploy to the Apple TV Simulator.