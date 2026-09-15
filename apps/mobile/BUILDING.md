# Building AnimBook · Mobile (iOS · Android · tvOS)

This app ships three native targets from one Expo source tree:

| Target | Bundle id | Use |
|---|---|---|
| iOS | `app.animbook.mobile` | iPhone + iPad |
| Android | `app.animbook.mobile` | phones + tablets |
| tvOS | `app.animbook.tv` | Apple TV (4K + HD) |

The Expo plugin `@react-native-tvos/config-tv` (in `package.json`) wires
the tvOS target into the iOS Xcode project when `expo prebuild` runs.

The bundled TV route is `app/(tv)/_layout.tsx`. It is the Apple TV
10-foot UI; web falls back to keyboard-driven navigation. On a real
tvOS device the focus engine follows the Apple TV remote.

## Web preview (any platform)

```bash
npm install --workspace=apps/mobile --legacy-peer-deps
cd apps/mobile
EXPO_PUBLIC_API_URL=http://localhost:4000 npx expo export --platform web --output-dir dist
node serve-dist.mjs   # serves :3005, including the /tv route
```

## Mac-only native builds

You need macOS with Xcode 15+ and (for tvOS) Apple TV device support
enabled.

```bash
# Install Expo CLI tools + EAS
npm install -g eas-cli

# Log in (one-time)
eas login

# Generate the native Xcode / Android Studio projects
cd apps/mobile
npx expo prebuild --platform ios --platform android --clean

# iOS → iPhone + iPad (simulator for fast iteration)
npx expo run:ios

# tvOS → Apple TV simulator
# Xcode → Open Developer Tool → Simulator → Apple TV 4K (3rd generation)
npx expo run:ios --target-name "Apple TV 4K (3rd generation)"

# Android
npx expo run:android

# Cloud build (no Mac needed for the build step; signing certs required)
eas build --platform ios --profile production          # App Store
eas build --platform ios --profile production-tvos     # tvOS App Store
eas build --platform android --profile production      # Play Store
```

## Deep links

- Custom scheme: `animbook://read/<slug>`, `animbook://companion/<slug>`, `animbook://dream`, `animbook://memory`
- iOS Universal Links: `https://animbook.com/m/*`
- Android App Links: `https://animbook.com/m/*` (autoVerify)

The Expo prebuild generates the matching URL schemes + associated
domains from the values in `app.json`.

## Smoke checks

```bash
# Already provided — run all suites when starting fresh
ANIMBOOK_API_URL=http://localhost:4000 \
ANIMBOOK_MOBILE_URL=http://localhost:3005 \
ANIMBOOK_TV_URL=http://localhost:3006 \
node scripts/smoke-phase{1..8}.mjs
```

## Notes

- The web preview is what runs on tvOS Safari today; the `apps/tv`
  workspace is the standalone Vite shell that pairs with this Expo
  source for development without an actual Apple TV.
- On native tvOS, `_layout.tsx` uses the Apple TV's hardware focus
  engine through `react-native-tvos` (installed automatically when
  `expo prebuild` runs the `@react-native-tvos/config-tv` plugin).
- Web fallback uses keyboard arrows + Enter; the same source ships
  identical UX whether you open it in Safari, Edge, or the Apple TV
  Simulator.