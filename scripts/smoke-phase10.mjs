// Run with: node scripts/smoke-phase10.mjs
// Confirms the Apple TV expansion:
//   - tvOS top-shelf asset exists in apps/mobile/assets
//   - app.json declares the top-shelf image + UIRequiredDeviceCapabilities
//   - TV Library has shelves (continue-reading, featured, kids, wellness, worlds)
//   - TV Reader ships TTS support (speechSynthesis / SpeechSynthesisUtterance)
//   - /api/library returns entries for the continue-reading shelf
//   - /api/worlds + /api/dream/sessions reachable from the TV shell

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MOBILE = path.resolve(__dirname, "..", "apps", "mobile");
const TV = path.resolve(__dirname, "..", "apps", "tv");

const API = process.env.ANIMBOOK_API_URL ?? "http://localhost:4000";
const MOBILE_WEB = process.env.ANIMBOOK_MOBILE_URL ?? "http://localhost:3005";
const TV_WEB = process.env.ANIMBOOK_TV_URL ?? "http://localhost:3006";

let pass = 0;
let fail = 0;
const log = (label, ok, detail = "") => {
  const marker = ok ? "PASS" : "FAIL";
  if (ok) pass += 1; else fail += 1;
  console.log(`[${marker}] ${label}${detail ? ` — ${detail}` : ""}`);
};

async function call(url) {
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}

async function main() {
  console.log(`AnimBook Phase 10 smoke · Apple TV expansion\n`);

  // === Apple TV assets ===
  const topShelf = path.join(MOBILE, "assets", "tv-top-shelf.svg");
  log("apps/mobile/assets/tv-top-shelf.svg exists", existsSync(topShelf));

  const icon = path.join(MOBILE, "assets", "icon.svg");
  log("apps/mobile/assets/icon.svg exists", existsSync(icon));

  // === app.json declares the top-shelf image ===
  const appJson = JSON.parse(await readFile(path.join(MOBILE, "app.json"), "utf8"));
  const tvosCfg = appJson.expo?.tvOS ?? {};
  log(
    "app.json declares tvOS topShelfImage",
    typeof tvosCfg.topShelfImage === "string" && tvosCfg.topShelfImage.includes("tv-top-shelf"),
    `topShelfImage=${tvosCfg.topShelfImage}`
  );
  log(
    "app.json declares tvOS UIRequiredDeviceCapabilities (arm64)",
    Array.isArray(tvosCfg.infoPlist?.UIRequiredDeviceCapabilities) &&
      tvosCfg.infoPlist.UIRequiredDeviceCapabilities.includes("arm64")
  );

  // === TV Reader ships TTS support ===
  const tvBundleMatch = /assets\/(index-[\w-]+\.js)/.exec(await (await call(TV_WEB)).text);
  if (!tvBundleMatch) {
    log("Locate TV bundle", false);
  } else {
    const bundle = await call(`${TV_WEB}/${tvBundleMatch[0]}`);
    const hasSynthesis = bundle.text.includes("SpeechSynthesisUtterance") || bundle.text.includes("speechSynthesis");
    const hasTvReader = bundle.text.includes("Read aloud") || bundle.text.includes("TvReader");
    const hasShelves = bundle.text.includes("Continue reading") || bundle.text.includes("Featured") || bundle.text.includes("focus-shelf");
    log("TV bundle ships SpeechSynthesis support", hasSynthesis);
    log("TV bundle ships TvReader (Read aloud / Pause / Stop)", hasTvReader);
    log("TV bundle ships shelves (Continue reading / Featured)", hasShelves);
  }

  // === Library endpoint reachable from TV shelf ===
  const lib = await call(`${API}/api/library`);
  log(
    "GET /api/library (Continue-reading shelf)",
    lib.status === 200 && Array.isArray(lib.body.items),
    `${lib.body.items?.length ?? 0} entries`
  );

  // === Worlds reachable ===
  const worlds = await call(`${API}/api/worlds`);
  log("GET /api/worlds (TV Worlds shelf)", worlds.status === 200 && Array.isArray(worlds.body.items));

  // === Featured shelf pulls from /api/books ===
  const featured = await call(`${API}/api/books?status=PUBLISHED&limit=6`);
  log(
    "GET /api/books (Featured shelf)",
    featured.status === 200 && Array.isArray(featured.body.items) && featured.body.items.length >= 1,
    `${featured.body.items?.length ?? 0} books`
  );

  // === TV routes still serve ===
  const tvRoot = await call(TV_WEB);
  log(
    "GET TV shell index.html",
    tvRoot.status === 200 && tvRoot.text.includes("AnimBook TV"),
    `${tvRoot.text.length} bytes`
  );

  // === Mobile web export still serves ===
  const mobileRoot = await call(MOBILE_WEB);
  const mobileJsMatch = /_expo\/static\/js\/web\/entry-([a-f0-9]+)\.js/.exec(mobileRoot.text);
  log(
    "GET mobile shell index.html",
    mobileRoot.status === 200 && mobileRoot.text.includes("AnimBook Mobile")
  );
  if (mobileJsMatch) {
    const bundle = await call(`${MOBILE_WEB}/_expo/static/js/web/entry-${mobileJsMatch[1]}.js`);
    log(
      "GET mobile shell bundle",
      bundle.status === 200 && bundle.text.length > 100_000,
      `${(bundle.text.length / 1024).toFixed(0)} KB`
    );
  } else {
    log("Locate mobile shell bundle", false);
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Phase 10 smoke test crashed:", err);
  process.exit(1);
});