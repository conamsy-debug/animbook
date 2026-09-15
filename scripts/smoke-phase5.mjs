// Run with: node scripts/smoke-phase5.mjs
// Confirms AnimBook ARCHIVE + AnimBook SCHOOL end-to-end.

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
  console.log(`AnimBook Phase 5 smoke test against ${BASE}\n`);

  // === AnimBook ARCHIVE ===
  const projects = await call("/api/archive/projects");
  log(
    "GET /api/archive/projects",
    projects.status === 200 && projects.body.items?.some((p) => p.slug === "voices-of-the-lagoon"),
    `${projects.body.items?.length ?? 0} projects`
  );

  const detail = await call("/api/archive/projects/voices-of-the-lagoon");
  log(
    "GET /api/archive/projects/:slug",
    detail.status === 200 && detail.body.project?.sensitivityTier === "HIGH" && detail.body.project?.consents?.length === 1 && detail.body.project?.culturalNotes?.length === 2,
    `tier=${detail.body.project?.sensitivityTier}`
  );

  // Try publishing the archive project — should succeed because we have
  // consent + 2 cultural notes (HIGH tier requires ≥1 cultural note).
  const publish = await call("/api/archive/projects/voices-of-the-lagoon/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bookId: "a-poem-for-lagos" })
  });
  log(
    "POST /api/archive/projects/:slug/publish (with consent + notes)",
    publish.status === 200 && publish.body.ok,
    `slug=${publish.body.slug}`
  );

  // Record a fresh consent record to a new project and try publishing without notes → 409.
  const blockerSlug = `phase5-blocker-${Date.now()}`;
  const blocker = await call("/api/archive/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      slug: blockerSlug,
      title: "Blocker test",
      steward: "AnimBook Archive",
      region: "Test",
      sensitivityTier: "HIGH"
    })
  });
  log("POST /api/archive/projects (HIGH tier)", blocker.status === 201);

  const blockerConsent = await call(`/api/archive/projects/${blockerSlug}/consents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subjectName: "Test subject",
      relationship: "Self",
      consentText: "I consent to this AnimBook being published."
    })
  });
  log("POST /api/archive/projects/:slug/consents", blockerConsent.status === 201);

  const blockerPublish = await call(`/api/archive/projects/${blockerSlug}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bookId: "a-poem-for-lagos" })
  });
  log(
    "POST publish without cultural notes (HIGH tier → 409)",
    blockerPublish.status === 409 && blockerPublish.body.error?.includes("Cultural note")
  );

  // === AnimBook SCHOOL ===
  const classrooms = await call("/api/school/classrooms");
  log(
    "GET /api/school/classrooms",
    classrooms.status === 200 && classrooms.body.items?.some((c) => c.slug === "year-9-studio"),
    `${classrooms.body.items?.length ?? 0} classrooms`
  );

  const classroom = await call("/api/school/classrooms/year-9-studio");
  log(
    "GET /api/school/classrooms/:slug",
    classroom.status === 200 && classroom.body.classroom?.members?.length === 3 && classroom.body.role === "TEACHER",
    `${classroom.body.classroom?.members?.length} members`
  );

  const library = await call("/api/school/classrooms/year-9-studio/library");
  log(
    "GET /api/school/classrooms/:slug/library",
    library.status === 200 && library.body.items?.length >= 1,
    `${library.body.items?.length} curated books`
  );

  // Submit an assignment as the demo user (member of the classroom).
  const submit = await call("/api/school/assignments/year-9-assignment-1/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pageCount: 3 })
  });
  log(
    "POST /api/school/assignments/:id/submit",
    submit.status === 201 && submit.body.submission?.pageCount === 3,
    `submission id=${submit.body.submission?.id?.slice(0, 8)}…`
  );

  const me = await call("/api/school/me");
  // Demo user is the teacher (not a student), so /me legitimately returns 0.
  log(
    "GET /api/school/me (teacher returns empty student view)",
    me.status === 200 && Array.isArray(me.body.items) && me.body.items.length === 0,
    `student view items=${me.body.items?.length ?? 0}`
  );

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Phase 5 smoke test crashed:", err);
  process.exit(1);
});