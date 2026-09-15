// Run with: node scripts/smoke-phase6.mjs
// Confirms AnimBook DREAM + AnimBook STUDIO PRO end-to-end.

const BASE = process.env.ANIMBOOK_API_URL ?? "http://localhost:4000";

let pass = 0;
let fail = 0;
const log = (label, ok, detail = "") => {
  const marker = ok ? "PASS" : "FAIL";
  if (ok) pass += 1; else fail += 1;
  console.log(`[${marker}] ${label}${detail ? ` — ${detail}` : ""}`);
};

async function call(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function main() {
  console.log(`AnimBook Phase 6 smoke test against ${BASE}\n`);

  // === AnimBook DREAM ===
  const ambient = await call("/api/dream/ambient");
  log(
    "GET /api/dream/ambient",
    ambient.status === 200 && Array.isArray(ambient.body.tracks) && ambient.body.tracks.length >= 5,
    `${ambient.body.tracks?.length ?? 0} tracks`
  );

  const profile = await call("/api/dream/profile/the-sleeping-coast");
  log(
    "GET /api/dream/profile/:bookId (WELLNESS)",
    profile.status === 200 && profile.body.active === true && profile.body.profile?.palette === "cool" && profile.body.profile?.narrationSpeed === 0.7,
    `ambient=${profile.body.profile?.ambientTrack} flip=${profile.body.profile?.flipDurationMs}ms`
  );

  const profileNightTrain = await call("/api/dream/profile/the-night-train");
  log(
    "GET /api/dream/profile/:bookId (non-WELLNESS → inactive)",
    profileNightTrain.status === 200 && profileNightTrain.body.active === false,
    `active=${profileNightTrain.body.active}`
  );

  const sessionOpen = await call("/api/dream/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bookId: "the-sleeping-coast", ambientTrack: "fireplace" })
  });
  log(
    "POST /api/dream/sessions (WELLNESS open)",
    sessionOpen.status === 201 && sessionOpen.body.session?.ambientTrack === "fireplace",
    `session=${sessionOpen.body.session?.id?.slice(0, 8)}…`
  );
  const sessionId = sessionOpen.body.session?.id;

  const sessionProgress = await call(`/api/dream/sessions/${sessionId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pagesRead: 4 })
  });
  log(
    "PUT /api/dream/sessions/:id (progress)",
    sessionProgress.status === 200 && sessionProgress.body.session?.pagesRead === 4,
    `pages=${sessionProgress.body.session?.pagesRead}`
  );

  const sessionEnd = await call(`/api/dream/sessions/${sessionId}/end`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "reader_fell_asleep", fellAsleep: true })
  });
  log(
    "POST /api/dream/sessions/:id/end (fell asleep)",
    sessionEnd.status === 200 && sessionEnd.body.session?.fellAsleepAt != null && sessionEnd.body.session?.endedAt != null,
    `exit=${sessionEnd.body.session?.exitReason}`
  );

  const sessionBadEnd = await call("/api/dream/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bookId: "the-night-train" })
  });
  log(
    "POST /api/dream/sessions (non-WELLNESS → 409)",
    sessionBadEnd.status === 409 && sessionBadEnd.body.error?.includes("WELLNESS")
  );

  const listing = await call("/api/dream/sessions");
  log(
    "GET /api/dream/sessions",
    listing.status === 200 && Array.isArray(listing.body.items) && listing.body.items.length >= 1,
    `${listing.body.items?.length} sessions`
  );

  // === AnimBook STUDIO PRO ===
  const companion = await call("/api/studio-pro/companion/the-night-train");
  log(
    "GET /api/studio-pro/companion/:bookId (seeded)",
    companion.status === 200 && companion.body.link?.markerHash && companion.body.link?.nfcTagId,
    `marker=${companion.body.link?.markerHash?.slice(0, 12)}… nfc=${companion.body.link?.nfcTagId}`
  );
  const linkId = companion.body.link?.id;

  const pin = await call("/api/studio-pro/companion/the-night-train/page", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ anchorPage: 3 })
  });
  log(
    "POST /api/studio-pro/companion/:bookId/page (anchor=3)",
    pin.status === 200 && pin.body.link?.anchorPage === 3,
    `anchorPage=${pin.body.link?.anchorPage}`
  );

  const session = await call("/api/studio-pro/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ linkId, triggerMode: "AR_OVERLAY", pageReached: 2 })
  });
  log(
    "POST /api/studio-pro/sessions (AR overlay)",
    session.status === 201 && session.body.session?.triggerMode === "AR_OVERLAY",
    `session=${session.body.session?.id?.slice(0, 8)}…`
  );

  const nfcSession = await call("/api/studio-pro/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ linkId, triggerMode: "NFC_ANCHOR", pageReached: 1 })
  });
  log(
    "POST /api/studio-pro/sessions (NFC anchor)",
    nfcSession.status === 201 && nfcSession.body.session?.triggerMode === "NFC_ANCHOR"
  );

  const analytics = await call("/api/studio-pro/companion/the-night-train/analytics");
  log(
    "GET /api/studio-pro/companion/:bookId/analytics",
    analytics.status === 200 && analytics.body.summary?.total >= 3,
    `total=${analytics.body.summary?.total} byTrigger=${analytics.body.summary?.byTrigger?.length ?? 0}`
  );

  // Public scan endpoints (no auth header needed for these).
  const markerHash = companion.body.link?.markerHash;
  const scanMarker = await call(`/api/studio-pro/scan/marker/${markerHash}`);
  log(
    "GET /api/studio-pro/scan/marker/:marker (public)",
    scanMarker.status === 200 && scanMarker.body.link?.markerHash === markerHash,
    `${scanMarker.body.book?.slug}`
  );

  const nfcTagId = companion.body.link?.nfcTagId;
  const scanNfc = await call(`/api/studio-pro/scan/nfc/${encodeURIComponent(nfcTagId)}`);
  log(
    "GET /api/studio-pro/scan/nfc/:tagId (public)",
    scanNfc.status === 200 && scanNfc.body.link?.nfcTagId === nfcTagId,
    `${scanNfc.body.book?.slug}`
  );

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Phase 6 smoke test crashed:", err);
  process.exit(1);
});
