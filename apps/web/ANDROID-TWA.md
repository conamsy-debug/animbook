# AnimBook Android app (Trusted Web Activity)

AnimBook ships as a **Trusted Web Activity** (TWA): the PWA at
`animbook.com` wrapped in a minimal native Android shell so users can
install it from the Play Store like any real app. Zero code rewrite — the
existing Next.js app IS the app.

## How it works
1. `apps/web/public/site.webmanifest` declares the PWA (name, icons, theme).
2. `apps/web/public/.well-known/assetlinks.json` proves to Chrome that
   the Android app is the official owner of `animbook.com` — required
   for full-screen / no-URL-bar mode and Play Store install.
3. `twa-manifest.json` tells Bubblewrap how to build the Android project.
4. `sw.js` caches the shell so the app boots offline.

## One-time setup (~30 min on a Windows host)

### 1. Install prerequisites
```bash
# Node 20+ (you already have it)
node --version

# Java 17 — Android Gradle Plugin needs it
# Download from https://adoptium.net/ and add JAVA_HOME to PATH

# Android SDK — install Android Studio (which bundles the SDK) or
# use the command-line tools:
#   https://developer.android.com/studio#command-line-tools-only

# Set ANDROID_HOME to wherever the SDK lives, e.g.
#   C:\Users\<you>\AppData\Local\Android\Sdk

# Bubblewrap CLI
npm install -g @bubblewrap/cli
```

### 2. Generate the upload keystore
This is the cryptographic key that signs the APK and the Play Store
listing. Keep it safe — losing it means losing the ability to push
updates. Back it up to a password manager.

```bash
# Run from apps/web/
cd apps/web
keytool -genkey -v -keystore android.keystore -alias android \
  -keyalg RSA -keysize 2048 -validity 25000 \
  -storepass <your-store-pass> -keypass <your-key-pass> \
  -dname "CN=AnimBook,O=AnimBook,L=Lagos,ST=LA,C=NG"
```

### 3. Fill in assetlinks.json
Replace `REPLACE_WITH_SHA256_OF_UPLOAD_KEY` with the SHA-256 fingerprint
of the keystore's certificate:

```bash
keytool -list -v -keystore apps/web/android.keystore -alias android | \
  grep "SHA256:"
```

Copy the value (no spaces, no colons) into `assetlinks.json`. This file
is served at `https://animbook.com/.well-known/assetlinks.json` — Chrome
fetches it during install to verify domain ownership.

### 4. Build the APK / AAB
```bash
cd apps/web
bubblewrap build --manifest=twa-manifest.json
bubblewrap sign --manifest=twa-manifest.json
```

`bubblewrap build` produces an unsigned AAB. `bubblewrap sign` signs
it with the keystore. Output: `app-release-signed.apk` and
`app-release-bundle.aab`.

For Play Store submission you want the AAB:
`apps/web/app-release-bundle.aab`.

### 5. Play Console
1. Create the app at https://play.google.com/console
2. **Setup → App signing** — opt in to Play App Signing (recommended).
   Upload the upload keystore's public cert so Google manages the
   final signing key going forward.
3. **Release → Production → Create new release** — upload
   `app-release-bundle.aab`.
4. Fill in store listing: name, description, screenshots, category
   (Books & Reference), content rating, privacy policy URL
   (`https://animbook.com/legal/privacy`).
5. Submit for review. First review takes 1-3 days.

### 6. After publishing
- Every subsequent build: bump `appVersionName` and `appVersionCode` in
  `twa-manifest.json` before running `bubblewrap build`. Play Console
  rejects AABs with the same version code.
- The `assetlinks.json` SHA-256 must match the *upload* key. If you
  switch to a new keystore you must update the file AND publish the
  new hash to Chrome (Play App Signing handles this if you opt in).

## Updating the icon / splash
- `twa-manifest.json.iconUrl` and `splashImageUrl` point at
  `https://animbook.com/icon-512.png` — change those URLs to swap the
  launcher / splash icon without rebuilding.
- For per-device splash sizes, replace `icon-512.png` with a PNG sized
  for the target device (Bubblewrap's `bubblewrap update` doesn't
  generate splash variants; if you need Android TV splash art that's
  a separate concern).

## Domain verification
After publishing, run `bubblewrap validate --manifest=twa-manifest.json`
to confirm Chrome can reach `https://animbook.com/.well-known/assetlinks.json`
and the SHA-256 matches. If validation fails:
- DNS: confirm `animbook.com` resolves to the same host that serves the
  cert. Cloudflare proxy is fine — it forwards the path.
- Cert mismatch: double-check the SHA-256 in `assetlinks.json` against
  `keytool -list -v -keystore android.keystore -alias android`. A common
  trap is using the SHA-256 of the WRONG alias in a multi-key keystore.

## Edge cases
- **Push notifications**: not enabled (`enableNotifications: false`).
  Safari PWA + Android TWA both support Web Push in modern browsers, so
  the web app's existing push setup works once we set this to `true` and
  add a service-worker push handler.
- **Background audio**: TWA honours the standard Web Media Session API
  on Android 12+. The Reader's `<audio>` already uses that, so locking
  the screen while a book is narrating continues to play. (Safari PWA
  doesn't allow this — that's the iOS limitation we accepted.)
- **Single Activity**: `singleActivity: true` is the default — if the
  user is in the TWA and opens a link, it pops a Chrome Custom Tab
  instead of replacing the TWA. Prevents "lost my place" moments.

## Smoke test (no Play Store yet)
```bash
# Install on a USB-attached Android device with developer mode on
adb install apps/web/app-release-signed.apk

# Launch via the launcher icon. Verify:
# - Full-screen (no URL bar) — domain is verified via assetlinks.json
# - Splash on cold start (~1s, gold-on-dark)
# - "Install App" prompt gone — already installed via ADB
# - App icon matches /icon-512.png
# - Status bar uses #080C14
```

If the URL bar is still visible, the SHA-256 in `assetlinks.json`
doesn't match — re-run `keytool -list` and update the file.
