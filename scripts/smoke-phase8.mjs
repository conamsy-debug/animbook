// Run with: node scripts/smoke-phase8.mjs
// Confirms the mobile polish — haptics, blur, notifications, deep links —
// is wired correctly and the shell builds.

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
  console.log(`AnimBook Phase 8 smoke · API=${API} · MOBILE=${MOBILE_WEB} · TV=${TV_WEB}\n`);

  // === Mobile shell rebuilt with polish ===
  const mobileRoot = await call(MOBILE_WEB);
  log(
    "GET mobile shell index.html",
    mobileRoot.status === 200 && mobileRoot.text.includes("AnimBook Mobile"),
    `${mobileRoot.text.length} bytes`
  );

  // Find the latest bundle hash — proves the rebuild landed.
  const jsMatch = /_expo\/static\/js\/web\/entry-([a-f0-9]+)\.js/.exec(mobileRoot.text);
  if (!jsMatch) {
    log("Locate mobile shell bundle", false, "no entry-*.js found");
  } else {
    const bundleName = `entry-${jsMatch[1]}.js`;
    const bundle = await call(`${MOBILE_WEB}/_expo/static/js/web/${bundleName}`);
    log(
      `GET mobile shell bundle (${bundleName})`,
      bundle.status === 200 && bundle.text.length > 100_000,
      `${(bundle.text.length / 1024).toFixed(0)} KB`
    );

    // Check the bundle ships the mobile-polish symbols.
    const hasHaptics = bundle.text.includes("expo-haptics") || bundle.text.includes("Haptics") || bundle.text.includes("hapticFlip");
    const hasBlur = bundle.text.includes("BlurView") || bundle.text.includes("expo-blur");
    const hasNotifications = bundle.text.includes("expo-notifications") || bundle.text.includes("scheduleNotificationAsync") || bundle.text.includes("Notifications");
    const hasDeepLink = bundle.text.includes("animbook://") || bundle.text.includes("parseAnimLink") || bundle.text.includes("native-intent");

    log("Mobile bundle wires haptics (Haptics/expo-haptics)", hasHaptics);
    log("Mobile bundle wires blur (BlurView/expo-blur)", hasBlur);
    log("Mobile bundle wires notifications (scheduleNotificationAsync)", hasNotifications);
    log("Mobile bundle wires deep-link handler (animbook://)", hasDeepLink);
  }

  // === API surface reachable (the polish layers hit the same endpoints) ===
  const memory = await call(`${API}/api/memory/settings`);
  log(
    "GET /api/memory/settings (mobile memory card)",
    memory.status === 200 && typeof memory.body.profile?.palette === "string"
  );

  const dream = await call(`${API}/api/dream/profile/the-sleeping-coast`);
  log(
    "GET /api/dream/profile/:slug (drift log source)",
    dream.status === 200 && dream.body.active === true
  );

  const companion = await call(`${API}/api/studio-pro/companion/the-night-train`);
  log(
    "GET /api/studio-pro/companion/:slug (companion card)",
    companion.status === 200 && companion.body.link?.markerHash
  );

  // === TV shell still works ===
  const tvRoot = await call(TV_WEB);
  log(
    "GET TV shell index.html",
    tvRoot.status === 200 && tvRoot.text.includes("AnimBook TV"),
    `${tvRoot.text.length} bytes`
  );

  const tvAssetMatch = /assets\/(index-[\w-]+\.js)/.exec(tvRoot.text);
  if (tvAssetMatch) {
    const tvJs = await call(`${TV_WEB}/${tvAssetMatch[0]}`);
    log(
      "GET TV shell bundle",
      tvJs.status === 200 && tvJs.text.length > 10_000,
      `${(tvJs.text.length / 1024).toFixed(0)} KB`
    );
  } else {
    log("Locate TV bundle", false, "no assets/index-*.js found");
  }

  // === Deep-link scenario: ?book= flag on the mobile shell ===
  const deepLink = await call(`${MOBILE_WEB}/read/the-night-train`);
  log(
    "GET mobile shell /read/the-night-train (deep link route)",
    deepLink.status === 200 && deepLink.text.includes("AnimBook Mobile"),
    `${deepLink.text.length} bytes`
  );

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Phase 8 smoke test crashed:", err);
  process.exit(1);
});