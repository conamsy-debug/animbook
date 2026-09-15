// Run with: node scripts/smoke-phase1.mjs
// Confirms every Phase 1 contract surface responds correctly.

const BASE = process.env.ANIMBOOK_API_URL ?? "http://localhost:4000";
const SLUG = "the-night-train";

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
  console.log(`AnimBook Phase 1 smoke test against ${BASE}\n`);

  // 1. Health check — confirms Express + Prisma + ioredis are wired.
  const health = await call("/api/health");
  log("GET /api/health", health.status === 200 && health.body.status === "ok", `status=${health.status}`);

  // 2. Catalogue — confirms seeded AnimBooks are visible.
  const catalogue = await call("/api/books?status=PUBLISHED");
  log(
    "GET /api/books?status=PUBLISHED",
    catalogue.status === 200 && Array.isArray(catalogue.body.items) && catalogue.body.items.length >= 3,
    `${catalogue.body.items?.length ?? 0} items`
  );

  // 3. Book detail by slug.
  const detail = await call(`/api/books/${SLUG}`);
  log("GET /api/books/:slug", detail.status === 200 && detail.body.slug === SLUG);

  // 4. Book pages — confirms the reader data path.
  const pages = await call(`/api/books/${SLUG}/pages`);
  log(
    "GET /api/books/:slug/pages",
    pages.status === 200 && pages.body.pages?.length === 5,
    `${pages.body.pages?.length ?? 0} pages`
  );

  // 5. Single page.
  const page1 = await call(`/api/books/${SLUG}/pages/1`);
  log("GET /api/books/:slug/pages/1", page1.status === 200 && page1.body.page?.pageNum === 1);

  // 6. Verticals catalogue.
  const verticals = await call("/api/books/verticals");
  log(
    "GET /api/books/verticals",
    verticals.status === 200 && verticals.body.verticals?.length === 12,
    `${verticals.body.verticals?.length ?? 0} verticals`
  );

  // 7. Library: add, progress, get, list.
  const add = await call(`/api/library/${SLUG}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "BOTH" }) });
  log("POST /api/library/:slug", add.status === 200, `entry=${add.body?.id ?? "?"}`);

  const progPut = await call(`/api/library/${SLUG}/progress`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ progressPage: 2 }) });
  log(
    "PUT /api/library/:slug/progress",
    progPut.status === 200 && progPut.body.entry?.progressPage === 2,
    `newAchievements=${progPut.body.newAchievements?.length ?? 0}`
  );

  const progGet = await call(`/api/library/${SLUG}/progress`);
  log("GET /api/library/:slug/progress", progGet.status === 200 && progGet.body.progressPage === 2);

  const libList = await call(`/api/library`);
  log("GET /api/library", libList.status === 200 && libList.body.items?.length >= 1, `${libList.body.items?.length ?? 0} entries`);

  // 8. Studio pipeline: create project, upload, analyze.
  const proj = await call(`/api/studio/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `Smoke ${Date.now()}`,
      vertical: "CONSUMER",
      title: `Smoke ${Date.now()}`,
      author: "AnimBook Phase 1",
      synopsis: "Smoke test AnimBook",
      language: "en"
    })
  });
  log("POST /api/studio/projects", proj.status === 201 && proj.body.project?.id);

  const projId = proj.body.project.id;
  const upload = await call(`/api/studio/projects/${projId}/upload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceFilename: "smoke.txt",
      sha256: "deadbeefcafe",
      pages: [
        { pageNum: 1, chapter: "Chapter 1", text: "The platform was warm with rain and diesel." },
        { pageNum: 2, chapter: "Chapter 1", text: "She found her berth already occupied." }
      ]
    })
  });
  log("POST /api/studio/projects/:id/upload", upload.status === 200 && upload.body.pages === 2);

  const analyze = await call(`/api/studio/projects/${projId}/analyze`, { method: "POST" });
  log("POST /api/studio/projects/:id/analyze", analyze.status === 200 && analyze.body.jobId);

  // Wait for pipeline worker to process the queued job.
  await new Promise((r) => setTimeout(r, 7000));
  const projectDetail = await call(`/api/studio/projects/${projId}`);
  const pageList = await call(`/api/studio/projects/${projId}/pages`);
  log(
    "Pipeline processed pages",
    pageList.body.pages?.length === 2 && pageList.body.pages.every((p) => p.animationPrompt && p.videoUrl && p.audioUrl),
    `pages=${pageList.body.pages?.length ?? 0}`
  );

  // 9. Stripe stub (live=false in this run).
  const sub = await call(`/api/subscriptions/status`);
  log("GET /api/subscriptions/status", sub.status === 200 && typeof sub.body.stripe?.live === "boolean");

  const checkout = await call(`/api/subscriptions/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan: "PREMIUM", successUrl: "http://localhost:3000/profile?demo=1", cancelUrl: "http://localhost:3000/profile?demo=cancelled" })
  });
  log("POST /api/subscriptions/checkout (stub)", checkout.status === 200 && checkout.body.source === "stub");

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});