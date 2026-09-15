// Run with: node scripts/smoke-edu.mjs
// Confirms the EDU module end-to-end: checkpoint generation, response, teacher
// dashboard, and curriculum map.

const BASE = process.env.ANIMBOOK_API_URL ?? "http://localhost:4000";
const SLUG = "mitosis-a-living-cell-divides";

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
  console.log(`AnimBook EDU smoke test against ${BASE}\n`);

  // 1. Book detail — confirms EDU book is published.
  const book = await call(`/api/books/${SLUG}`);
  log("GET /api/books/mitosis", book.status === 200 && book.body.vertical === "EDU");

  // 2. Pages — confirms the EDU AnimBook has 5 pages.
  const pages = await call(`/api/books/${SLUG}/pages`);
  log("GET /api/books/mitosis/pages", pages.status === 200 && pages.body.pages?.length === 5, `${pages.body.pages?.length ?? 0} pages`);

  // 3. Curriculum map — Kenya CBC.
  const heatmap = await call(`/api/edu/curriculum/map/${SLUG}?framework=KENYA_CBC`);
  log(
    "GET /api/edu/curriculum/map/:bookId?framework=KENYA_CBC",
    heatmap.status === 200 && heatmap.body.mapping?.length >= 1,
    `${heatmap.body.mapping?.length ?? 0} standards, ${heatmap.body.gaps?.length ?? 0} gaps`
  );

  // 4. Checkpoint generation — page 1.
  const pageId = pages.body.pages[0].id;
  const ck = await call(`/api/edu/checkpoints/${pageId}`);
  log(
    "GET /api/edu/checkpoints/:pageId (mitosis page 1)",
    ck.status === 200 && ck.body.checkpoint?.question,
    `type=${ck.body.checkpoint?.questionType}, difficulty=${ck.body.difficulty?.conceptual_density?.toFixed?.(2) ?? "?"}`
  );

  // 5. Submit a response.
  const checkpointId = ck.body.checkpoint.id;
  const submit = await call(`/api/edu/checkpoints/${checkpointId}/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      selectedIndex: ck.body.checkpoint.correctIndex,
      timeTakenSeconds: 12
    })
  });
  log("POST /api/edu/checkpoints/:id/respond (correct)", submit.status === 200 && submit.body.isCorrect === true);

  // 6. Submit a wrong response to create a flagged page later.
  const page2Id = pages.body.pages[1].id;
  const ck2 = await call(`/api/edu/checkpoints/${page2Id}`);
  const wrong = await call(`/api/edu/checkpoints/${ck2.body.checkpoint.id}/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      selectedIndex: (ck2.body.checkpoint.correctIndex ?? 0) === 0 ? 1 : 0,
      timeTakenSeconds: 18
    })
  });
  log("POST .../respond (incorrect)", wrong.status === 200 && wrong.body.isCorrect === false);

  // 7. Teacher dashboard.
  const dash = await call(`/api/edu/teacher/dashboard`);
  log(
    "GET /api/edu/teacher/dashboard",
    dash.status === 200 && dash.body.summary?.bookSlug === SLUG && Array.isArray(dash.body.summary?.recentResponses) && dash.body.summary.recentResponses.length >= 2,
    `${dash.body.summary?.recentResponses?.length ?? 0} recent responses`
  );

  // 8. Teacher roster.
  const roster = await call(`/api/edu/teacher/students`);
  log("GET /api/edu/teacher/students", roster.status === 200 && Array.isArray(roster.body.students));

  // 9. Classroom projection start (requires admin — demo user isn't an institution admin so we expect 403).
  const proj = await call(`/api/edu/classroom/projection`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bookSlug: SLUG, pageNum: 1, sessionToken: "classroom-test-1" })
  });
  log("POST /api/edu/classroom/projection (gated)", proj.status === 403, `status=${proj.status}`);

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("EDU smoke test crashed:", err);
  process.exit(1);
});