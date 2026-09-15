// Run with: node scripts/smoke-phase3.mjs
// Confirms the 6 Phase 3 next-gen features end-to-end.

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
  console.log(`AnimBook Phase 3 smoke test against ${BASE}\n`);

  // === AnimBook MEMORY ===
  const mem = await call("/api/memory/settings");
  log("GET /api/memory/settings", mem.status === 200 && mem.body.profile?.palette);

  const updateMem = await call("/api/memory/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ palette: "cool", pacing: "leisurely", narrationSpeed: 0.9, motionLevel: 0.8 })
  });
  log(
    "PUT /api/memory/settings",
    updateMem.status === 200 && updateMem.body.profile?.palette === "cool",
    `narr=${updateMem.body.profile?.narrationSpeed}`
  );

  const adapt = await call("/api/memory/adapt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      signal: [
        { vertical: "EDU", emotionalRegister: "tense", timePerPageMs: 32000 },
        { vertical: "EDU", emotionalRegister: "calm", timePerPageMs: 28000 },
        { vertical: "EDU", emotionalRegister: "reflective", timePerPageMs: 40000 }
      ]
    })
  });
  log(
    "POST /api/memory/adapt",
    adapt.status === 200 && adapt.body.profile?.pacing === "leisurely",
    `pacing=${adapt.body.profile?.pacing}`
  );

  // === AnimBook ORACLE ===
  const decision = await call("/api/oracle/the-night-train/decision/1");
  log("GET /api/oracle/:slug/decision/:page", decision.status === 200 && decision.body.choices?.length === 3, `${decision.body.choices?.length} choices`);
  const firstChoice = decision.body.choices?.[0]?.nodeId;
  const choose = await call("/api/oracle/the-night-train/choose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentNodeId: firstChoice, pageNum: 6 })
  });
  log(
    "POST /api/oracle/:slug/choose",
    choose.status === 200 && typeof choose.body.continuation?.generatedText === "string",
    `text chars=${choose.body.continuation?.generatedText?.length ?? 0}`
  );

  // === AnimBook LIVE TRANSLATION ===
  const lookup = await call("/api/translation/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ word: "harbour", sourceLang: "en", targetLang: "sw", bookId: "the-night-train" })
  });
  log(
    "POST /api/translation/lookup",
    lookup.status === 200 && typeof lookup.body.source?.translation === "string",
    `${lookup.body.source?.sourceLang}→${lookup.body.source?.targetLang}: ${lookup.body.source?.translation?.slice(0, 40)}`
  );

  const cachedLookup = await call("/api/translation/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ word: "harbour", sourceLang: "en", targetLang: "sw", bookId: "the-night-train" })
  });
  log(
    "POST /api/translation/lookup (cache hit)",
    cachedLookup.status === 200 && cachedLookup.body.source?.translation === lookup.body.source?.translation
  );

  // === AnimBook LIVE ===
  const session = await call("/api/live/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bookId: "the-night-train", title: "Live reading — welcome" })
  });
  log("POST /api/live/sessions", session.status === 201 && session.body.session?.id);
  const sessionId = session.body.session?.id;
  const flip = await call(`/api/live/sessions/${sessionId}/append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "page.flipped", payload: { pageNum: 2 } })
  });
  log("POST /api/live/sessions/:id/append (page.flipped)", flip.status === 200 && flip.body.event?.type === "page.flipped");

  const liveList = await call("/api/live/sessions");
  log("GET /api/live/sessions", liveList.status === 200 && liveList.body.items?.some((s) => s.id === sessionId));

  const end = await call(`/api/live/sessions/${sessionId}/end`, { method: "POST" });
  log("POST /api/live/sessions/:id/end", end.status === 200 && end.body.ok);

  // === WELLNESS vertical ===
  const wellness = await call("/api/books/the-sleeping-coast");
  log("GET /api/books/the-sleeping-coast", wellness.status === 200 && wellness.body.vertical === "WELLNESS", `${wellness.body.totalPages} pages`);

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Phase 3 smoke test crashed:", err);
  process.exit(1);
});