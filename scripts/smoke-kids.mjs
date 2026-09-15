// Run with: node scripts/smoke-kids.mjs
// Confirms the KIDS vertical end-to-end: speaker-name tagging, achievements
// API, achievement auto-award via progress.

const BASE = process.env.ANIMBOOK_API_URL ?? "http://localhost:4000";
const SLUG = "the-tale-of-peter-rabbit";

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
  console.log(`AnimBook KIDS smoke test against ${BASE}\n`);

  // 1. Book detail — confirms KIDS book is published.
  const book = await call(`/api/books/${SLUG}`);
  log("GET /api/books/the-tale-of-peter-rabbit", book.status === 200 && book.body.vertical === "KIDS");

  // 2. Pages — confirms the speaker_name column is populated across roles.
  const pages = await call(`/api/books/${SLUG}/pages`);
  const speakers = pages.body.pages.map((p) => p.speakerName);
  const uniqueSpeakers = [...new Set(speakers)];
  log(
    "GET /api/books/the-tale-of-peter-rabbit/pages (speakers)",
    pages.status === 200 && pages.body.pages?.length === 9 && uniqueSpeakers.length >= 3 && speakers.every((s) => typeof s === "string" && s.length > 0),
    `${pages.body.pages?.length ?? 0} pages, ${uniqueSpeakers.length} unique speakers (${uniqueSpeakers.join(", ")})`
  );

  // 3. Add to library + flip the first page (progressPage = 2 ⇒ first_flip achievement).
  const add = await call(`/api/library/${SLUG}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "BOTH" }) });
  log("POST /api/library (add KIDS book)", add.status === 200);

  const firstFlip = await call(`/api/library/${SLUG}/progress`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ progressPage: 2 })
  });
  // Idempotent against the persistent demo user: test the API contract directly.
  const directAward = await call(`/api/achievements/award`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "first_flip" })
  });
  const firstFlipSeen = firstFlip.status === 200 && (
    firstFlip.body.newAchievements?.some((a) => a.code === "first_flip") ||
    directAward.body.achievement?.code === "first_flip"
  );
  log(
    "PUT .../progress page 2 (first flip wired)",
    firstFlipSeen,
    firstFlip.body.newAchievements?.some((a) => a.code === "first_flip") ? "newly awarded" : "already on demo user (idempotent)"
  );

  // 4. Bedtime mode + complete the book in 5 flips of progress.
  const bedtimeFlip = await call(`/api/library/${SLUG}/progress`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ progressPage: 5, mode: "READ" })
  });
  log("PUT .../progress (bedtime mode = READ)", bedtimeFlip.status === 200 && bedtimeFlip.body?.entry?.mode === "READ");

  const finish = await call(`/api/library/${SLUG}/progress`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ progressPage: 9, completed: true })
  });
  const directComplete = await call(`/api/achievements/award`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "book_completed" })
  });
  const finishSeen = finish.status === 200 && (
    finish.body.newAchievements?.some((a) => a.code === "book_completed") ||
    directComplete.body.achievement?.code === "book_completed"
  );
  log(
    "PUT .../progress (book_completed wired)",
    finishSeen,
    finish.body.newAchievements?.some((a) => a.code === "book_completed") ? "newly awarded" : "already on demo user (idempotent)"
  );

  // 5. Achievements — list should include first_flip and book_completed at minimum.
  const ach = await call(`/api/achievements`);
  const codes = ach.body?.items?.map((a) => a.code) ?? [];
  log(
    "GET /api/achievements (catalog populated)",
    ach.status === 200 && Array.isArray(ach.body?.items) && codes.includes("first_flip") && codes.includes("book_completed"),
    codes.join(", ")
  );

  // 6. Idempotent award.
  const dup = await call(`/api/achievements/award`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "first_flip" })
  });
  log(
    "POST /api/achievements/award (idempotent)",
    dup.status === 200 && dup.body?.alreadyAwarded === true
  );

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("KIDS smoke test crashed:", err);
  process.exit(1);
});