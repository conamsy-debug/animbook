// Smoke checks for PWA + TWA assets. Verifies the static files exist in
// public/ (so Next.js will serve them at runtime) and that the
// manifest + assetlinks.json are structurally valid JSON. Catches
// regressions like a missing icon, a renamed manifest, or a broken
// assetlinks.json that TWA Chrome would silently reject.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, "..", "public");

function mustExist(relativePath, minBytes = 1) {
  const abs = join(PUBLIC_DIR, relativePath);
  assert.ok(existsSync(abs), `expected ${relativePath} to exist in public/`);
  const size = statSync(abs).size;
  assert.ok(size >= minBytes, `expected ${relativePath} to be ≥${minBytes} bytes, got ${size}`);
}

test("PWA: site.webmanifest exists and parses", () => {
  mustExist("site.webmanifest");
  const json = JSON.parse(readFileSync(join(PUBLIC_DIR, "site.webmanifest"), "utf8"));
  assert.equal(json.name, "AnimBook");
  assert.equal(json.short_name, "AnimBook");
  assert.equal(json.start_url, "/");
  assert.equal(json.display, "standalone");
  assert.ok(Array.isArray(json.icons) && json.icons.length >= 2, "expected ≥2 icons");
  // At least one icon must be maskable for Android adaptive launcher icons.
  assert.ok(
    json.icons.some((i) => i.purpose === "maskable"),
    "expected at least one maskable icon for Android adaptive icons"
  );
});

test("PWA: required icons exist in public/", () => {
  // Bubblewrap requires 192 + 512 (or larger). Maskable 512 is needed
  // for adaptive launcher icons.
  mustExist("icon-192.png", 100);
  mustExist("icon-512.png", 1000);
  mustExist("icon-maskable-512.png", 1000);
  mustExist("apple-touch-icon.png", 100);
  mustExist("favicon.ico", 100);
  mustExist("favicon.svg", 50);
});

test("PWA: service worker exists and references CACHE_VERSION", () => {
  mustExist("sw.js");
  const sw = readFileSync(join(PUBLIC_DIR, "sw.js"), "utf8");
  // The SW must use versioned cache names so deploys invalidate the
  // old shell cleanly. Either the literal resolved name (animbook-
  // shell-v2) or the template source (animbook-shell-${CACHE_VERSION}).
  assert.match(
    sw,
    /animbook-(?:shell|runtime)-(?:v\d+|\$\{CACHE_VERSION\})/,
    "expected versioned cache names in sw.js"
  );
  // The SW must precache the critical shell so the app boots offline.
  assert.match(sw, /PRECACHE_URLS/, "expected PRECACHE_URLS list in sw.js");
  // The SW must skip cross-origin requests — caching them breaks
  // auth / video range / API responses.
  assert.match(sw, /url\.origin !== self\.location\.origin/, "expected cross-origin bypass");
});

test("TWA: assetlinks.json exists and parses", () => {
  mustExist(".well-known/assetlinks.json");
  const json = JSON.parse(readFileSync(join(PUBLIC_DIR, ".well-known", "assetlinks.json"), "utf8"));
  assert.ok(Array.isArray(json) && json.length >= 1, "expected an array of relations");
  const entry = json[0];
  assert.deepEqual(entry.relation, ["delegate_permission/common.handle_all_urls"]);
  assert.equal(entry.target.namespace, "android_app");
  assert.equal(entry.target.package_name, "com.animbook.app");
  assert.ok(Array.isArray(entry.target.sha256_cert_fingerprints) && entry.target.sha256_cert_fingerprints.length >= 1);
  // The fingerprint is a placeholder until the user generates the
  // upload keystore — pin that the placeholder is still obvious so
  // an accidental commit with the real fingerprint doesn't ship.
  const fp = entry.target.sha256_cert_fingerprints[0];
  assert.ok(fp.startsWith("REPLACE_"), `expected placeholder fingerprint, got "${fp}"`);
});

test("TWA: twa-manifest.json exists, parses, and matches public domain", () => {
  const twaPath = join(here, "..", "twa-manifest.json");
  assert.ok(existsSync(twaPath), "expected apps/web/twa-manifest.json");
  const json = JSON.parse(readFileSync(twaPath, "utf8"));
  assert.equal(json.packageId, "com.animbook.app");
  assert.equal(json.host, "animbook.com");
  assert.equal(json.name, "AnimBook");
  assert.equal(json.startUrl, "/");
  assert.equal(json.display, "standalone");
  // Domain verification only works with HTTPS hosts.
  assert.ok(!json.host.startsWith("http"), "host should be bare domain, not a URL");
  // Splash + theme must match site.webmanifest's theme colour for a
  // seamless cold-start experience.
  const webManifest = JSON.parse(readFileSync(join(PUBLIC_DIR, "site.webmanifest"), "utf8"));
  assert.equal(json.themeColor, webManifest.theme_color, "TWA theme should match PWA theme");
});
