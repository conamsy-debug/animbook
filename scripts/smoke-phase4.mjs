// Run with: node scripts/smoke-phase4.mjs
// Confirms the 4 Phase 4 next-gen features: WORLDS, STAGE, SIGNAL, NETWORK.

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
  console.log(`AnimBook Phase 4 smoke test against ${BASE}\n`);

  // === AnimBook WORLDS ===
  const worlds = await call("/api/worlds");
  log(
    "GET /api/worlds",
    worlds.status === 200 && worlds.body.items?.some((w) => w.slug === "lagos-nights"),
    `${worlds.body.items?.length ?? 0} worlds`
  );

  const world = await call("/api/worlds/lagos-nights");
  log(
    "GET /api/worlds/:slug",
    world.status === 200 && world.body.world?.members?.length === 3,
    `${world.body.world?.members?.length ?? 0} member books`
  );

  // === AnimBook STAGE ===
  // Need a project owned by demo. Create one first.
  const project = await call("/api/studio/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Stage test",
      vertical: "VERSE",
      title: `Stage Title ${Date.now()}`,
      author: "AnimBook Stage",
      synopsis: "Collaborative AnimBook test",
      language: "en"
    })
  });
  const projectId = project.body?.project?.id;
  log("POST /api/studio/projects (for STAGE)", project.status === 201 && Boolean(projectId));

  const openRound = await call(`/api/stage/${projectId}/rounds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ordinal: 1, brief: "Write the opening night" })
  });
  const roundId = openRound.body?.round?.id;
  log("POST /api/stage/:projectId/rounds (open)", openRound.status === 201 && Boolean(roundId));

  const contribute = await call(`/api/stage/rounds/${roundId}/contribute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pageNum: 1, textExcerpt: "The night opened like a book no one was reading.", voice: "narrator" })
  });
  const contributionId = contribute.body?.contribution?.id;
  log("POST /api/stage/rounds/:id/contribute", contribute.status === 201 && Boolean(contributionId));

  const decide = await call(`/api/stage/rounds/${roundId}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contributionId, approved: true })
  });
  log("POST /api/stage/rounds/:id/decide (approved)", decide.status === 200 && decide.body.ok);

  const stageState = await call(`/api/stage/${projectId}`);
  log(
    "GET /api/stage/:projectId",
    stageState.status === 200 && stageState.body.items?.length >= 1,
    `${stageState.body.items?.length ?? 0} rounds`
  );

  // === AnimBook SIGNAL ===
  const signalPost = await call("/api/signal/page", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bookId: "the-sleeping-coast",
      pageNum: 1,
      vertical: "WELLNESS",
      dwellMs: 18000,
      scrolledBack: false,
      abandoned: false
    })
  });
  log("POST /api/signal/page", signalPost.status === 201);

  const signalDash = await call("/api/signal/teacher?bookSlug=the-sleeping-coast");
  log(
    "GET /api/signal/teacher",
    signalDash.status === 200 && signalDash.body.book?.slug === "the-sleeping-coast",
    `${signalDash.body.pageSignals?.length ?? 0} page signals`
  );

  // === AnimBook NETWORK ===
  const newKey = await call("/api/network/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Smoke test key", scopes: ["books:read", "library:write"], rateLimitRpm: 30 })
  });
  const apiKeyId = newKey.body?.id;
  const apiKeySecret = newKey.body?.secret;
  log(
    "POST /api/network/keys (issue)",
    newKey.status === 201 && Boolean(apiKeySecret) && newKey.body.warning?.includes("not be shown again")
  );

  const keyList = await call("/api/network/keys");
  log(
    "GET /api/network/keys",
    keyList.status === 200 && keyList.body.items?.some((k) => k.id === apiKeyId)
  );

  // Use the key against /whoami as a smoke check that the bearer works.
  const prefix = newKey.body.prefix;
  const authed = await fetch(`${BASE}/api/whoami`, {
    headers: { Authorization: `Bearer ${prefix}.${apiKeySecret}` }
  });
  log(
    "Bearer API key against /api/whoami",
    authed.status === 200,
    `prefix=${(await authed.json()).key?.prefix ?? "?"}`
  );

  const revoke = await call(`/api/network/keys/${apiKeyId}/revoke`, { method: "POST" });
  log("POST /api/network/keys/:id/revoke", revoke.status === 200 && revoke.body.ok);

  const revokedAuth = await fetch(`${BASE}/api/whoami`, {
    headers: { Authorization: `Bearer ${prefix}.${apiKeySecret}` }
  });
  log("Revoked key rejected (401)", revokedAuth.status === 401);

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Phase 4 smoke test crashed:", err);
  process.exit(1);
});