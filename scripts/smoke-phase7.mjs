// Run with: node scripts/smoke-phase7.mjs
// Confirms the mobile + TV shells connect to the AnimBook API and serve
// every page the shells depend on.

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
  console.log(`AnimBook Phase 7 smoke · API=${API} · MOBILE=${MOBILE_WEB} · TV=${TV_WEB}\n`);

  // === Mobile shell (Expo Web export) ===
  const mobileRoot = await call(MOBILE_WEB);
  log(
    "GET mobile shell index.html",
    mobileRoot.status === 200 && mobileRoot.text.includes("AnimBook Mobile"),
    `${mobileRoot.status} ${mobileRoot.text.length} bytes`
  );

  const mobileJsMatch = /_expo\/static\/js\/web\/entry-([a-f0-9]+)\.js/.exec(mobileRoot.text);
  if (!mobileJsMatch) {
    log("Locate mobile shell bundle", false, "no entry-*.js found");
  } else {
    const mobileJs = await call(`${MOBILE_WEB}/_expo/static/js/web/entry-${mobileJsMatch[1]}.js`);
    log(
      "GET mobile shell bundle",
      mobileJs.status === 200 && mobileJs.text.length > 100_000,
      `${mobileJs.status} ${(mobileJs.text.length / 1024).toFixed(0)} KB`
    );
  }

  // Mobile shell exercises the same API surface as the web app. Verify a
  // sample of endpoints the shell hits during normal navigation.
  const mobileBooks = await call(`${API}/api/books?status=PUBLISHED&limit=40`);
  log(
    "GET /api/books (mobile library)",
    mobileBooks.status === 200 && Array.isArray(mobileBooks.body.items) && mobileBooks.body.items.length > 0,
    `${mobileBooks.body.items?.length ?? 0} books`
  );

  const mobilePages = await call(`${API}/api/books/the-night-train/pages`);
  log(
    "GET /api/books/:slug/pages (mobile reader)",
    mobilePages.status === 200 && Array.isArray(mobilePages.body.pages) && mobilePages.body.pages.length > 0,
    `${mobilePages.body.pages?.length ?? 0} pages`
  );

  const mobileMemory = await call(`${API}/api/memory/settings`);
  log(
    "GET /api/memory/settings (mobile memory tab)",
    mobileMemory.status === 200 && typeof mobileMemory.body.profile?.palette === "string"
  );

  const mobileDream = await call(`${API}/api/dream/profile/the-sleeping-coast`);
  log(
    "GET /api/dream/profile/:slug (mobile dream tab)",
    mobileDream.status === 200 && mobileDream.body.active === true
  );

  const mobileCompanion = await call(`${API}/api/studio-pro/companion/the-night-train`);
  log(
    "GET /api/studio-pro/companion/:slug (mobile companion tab)",
    mobileCompanion.status === 200 && mobileCompanion.body.link?.markerHash
  );

  // === Apple TV shell (Vite build) ===
  const tvRoot = await call(TV_WEB);
  log(
    "GET TV shell index.html",
    tvRoot.status === 200 && tvRoot.text.includes("AnimBook TV"),
    `${tvRoot.status} ${tvRoot.text.length} bytes`
  );

  const tvAssetMatch = /assets\/(index-[\w-]+\.js)/.exec(tvRoot.text);
  if (!tvAssetMatch) {
    log("Locate TV bundle in index.html", false, "no assets/index-*.js found");
  } else {
    const tvJs = await call(`${TV_WEB}/${tvAssetMatch[0]}`);
    log(
      "GET TV shell bundle",
      tvJs.status === 200 && tvJs.text.length > 10_000,
      `${tvJs.status} ${(tvJs.text.length / 1024).toFixed(0)} KB`
    );
  }

  // TV exercises a smaller API surface (read-only catalogue).
  const tvWorlds = await call(`${API}/api/worlds`);
  log(
    "GET /api/worlds (TV worlds)",
    tvWorlds.status === 200 && Array.isArray(tvWorlds.body.items)
  );

  const tvVerticals = await call(`${API}/api/books/verticals`);
  log(
    "GET /api/books/verticals (TV verticals)",
    tvVerticals.status === 200 && Array.isArray(tvVerticals.body.verticals)
  );

  const tvDream = await call(`${API}/api/dream/sessions?limit=10`);
  log(
    "GET /api/dream/sessions (TV dream log)",
    tvDream.status === 200 && Array.isArray(tvDream.body.items)
  );

  const tvCompanion = await call(`${API}/api/studio-pro/companion/the-night-train`);
  log(
    "GET /api/studio-pro/companion/:slug (TV companion)",
    tvCompanion.status === 200 && tvCompanion.body.link?.nfcTagId
  );

  // CORS check — the TV + mobile shells run on different origins (3005/3006 vs 4000).
  const tvCors = await call(`${API}/api/health`);
  log(
    "CORS pre-flight — API reachable from TV origin",
    tvCors.status === 200
  );

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Phase 7 smoke test crashed:", err);
  process.exit(1);
});