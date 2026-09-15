// Run with: node scripts/smoke-phase9.mjs
// Confirms the Apple TV native build source is in place:
//   - Expo config has the @react-native-tvos/config-tv plugin
//   - app.json declares a tvOS bundle id
//   - EAS config has production-tvos + preview-tvos profiles
//   - The mobile web export serves /tv with the focus-driven view
//   - The standalone tv shell still works
//   - The mobile bundle ships the TV route code

import { readFile } from "node:fs/promises";
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
  return { status: res.status, text };
}

async function main() {
  console.log(`AnimBook Phase 9 smoke · Apple TV native build source\n`);

  // === Expo config declares the Apple TV target ===
  const appJson = JSON.parse(await readFile(path.join(MOBILE, "app.json"), "utf8"));
  const plugins = (appJson.expo?.plugins ?? []).map((p) => String(p));
  log(
    "Expo plugins include @react-native-tvos/config-tv",
    plugins.includes("@react-native-tvos/config-tv"),
    `${plugins.length} plugins`
  );

  const tvosBundle = appJson.expo?.tvOS?.bundleIdentifier;
  log(
    "app.json declares tvOS bundle id",
    typeof tvosBundle === "string" && tvosBundle.includes("animbook.tv"),
    `bundleIdentifier=${tvosBundle}`
  );

  const iosBundle = appJson.expo?.ios?.bundleIdentifier;
  log(
    "app.json declares iOS bundle id",
    typeof iosBundle === "string" && iosBundle.includes("animbook.mobile")
  );

  const androidPackage = appJson.expo?.android?.package;
  log(
    "app.json declares Android package",
    typeof androidPackage === "string" && androidPackage.includes("animbook.mobile")
  );

  // === EAS config has tvOS profiles ===
  const easJson = JSON.parse(await readFile(path.join(MOBILE, "eas.json"), "utf8"));
  const profileNames = Object.keys(easJson.build ?? {});
  log(
    "EAS build profiles include production-tvos",
    profileNames.includes("production-tvos"),
    `${profileNames.length} profiles`
  );
  log(
    "EAS build profiles include preview-tvos",
    profileNames.includes("preview-tvos")
  );

  // === BUILDING.md documents the Mac flow ===
  try {
    const buildDoc = await readFile(path.join(MOBILE, "BUILDING.md"), "utf8");
    const hasMac = buildDoc.includes("macOS") && buildDoc.includes("Xcode");
    const hasIos = buildDoc.includes("expo run:ios") && buildDoc.includes("Apple TV");
    const hasEas = buildDoc.includes("eas build");
    log("BUILDING.md mentions macOS + Xcode", hasMac);
    log("BUILDING.md has run:ios + Apple TV target", hasIos);
    log("BUILDING.md references eas build", hasEas);
  } catch {
    log("BUILDING.md exists", false, "file not found");
  }

  // === Mobile web export /tv route ===
  const mobileTv = await call(`${MOBILE_WEB}/tv`);
  log(
    "GET mobile shell /tv (Apple TV focus view)",
    mobileTv.status === 200 && mobileTv.text.includes("AnimBook Mobile"),
    `${mobileTv.text.length} bytes`
  );

  // Mobile bundle ships the TV route code.
  const mobileRoot = await call(MOBILE_WEB);
  const jsMatch = /_expo\/static\/js\/web\/entry-([a-f0-9]+)\.js/.exec(mobileRoot.text);
  if (jsMatch) {
    const bundle = await call(`${MOBILE_WEB}/_expo/static/js/web/entry-${jsMatch[1]}.js`);
    const hasTvBundle = bundle.text.includes("AnimBook · tv") || bundle.text.includes("Apple TV") || bundle.text.includes("tv") && bundle.text.includes("focusable");
    log(
      "Mobile bundle ships Apple TV focus route code",
      hasTvBundle,
      `${(bundle.text.length / 1024).toFixed(0)} KB`
    );
  } else {
    log("Locate mobile shell bundle", false);
  }

  // === Standalone TV web shell still works ===
  const tvRoot = await call(TV_WEB);
  log(
    "GET TV shell index.html",
    tvRoot.status === 200 && tvRoot.text.includes("AnimBook TV"),
    `${tvRoot.text.length} bytes`
  );

  // === The TV view exercises real API ===
  const tvWorlds = await call(`${API}/api/worlds`);
  log("GET /api/worlds (TV worlds)", tvWorlds.status === 200);

  const tvBook = await call(`${API}/api/books/the-night-train`);
  log("GET /api/books/the-night-train (TV reader)", tvBook.status === 200);

  // === TV workspace still has its web fallback Vite config ===
  try {
    const tvPackage = JSON.parse(await readFile(path.join(TV, "package.json"), "utf8"));
    log(
      "TV workspace still Vite-based (web fallback for tvOS Safari)",
      typeof tvPackage.scripts?.build === "string" && tvPackage.name === "@animbook/tv"
    );
  } catch {
    log("apps/tv/package.json readable", false);
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Phase 9 smoke test crashed:", err);
  process.exit(1);
});