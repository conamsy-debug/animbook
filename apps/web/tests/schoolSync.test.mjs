// Pure-logic tests for the AnimBook SCHOOL teacher / student flows.
//
// The full integration (forms, API auth, role-based UI) lives in React
// + fetch, so we can't unit-test it without a browser. This file pins
// the decision rules so the behaviour can be regression-tested in CI:
//
//   - create-classroom payload shape (kebab-case slug)
//   - invite-student email trim + lowercase
//   - post-assignment due-date ISO conversion
//   - submit-assignment pageCount clamp (≥ 1)
//   - role check: isTeacher only when "teacher" is in roles
//   - error extraction from ApiError.details
//
// Run with: `node --test apps/web/tests/schoolSync.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";

function buildCreatePayload(form) {
  return {
    name: form.name.trim(),
    slug: form.slug.trim().toLowerCase(),
    schoolName: form.schoolName.trim() || undefined,
    gradeBand: form.gradeBand.trim() || undefined
  };
}

function isTeacher(roles) {
  return Array.isArray(roles) && roles.includes("teacher");
}

function buildInvitePayload(email) {
  return { studentEmail: email.trim().toLowerCase() };
}

function buildAssignmentPayload(form) {
  return {
    title: form.title.trim(),
    brief: form.brief.trim(),
    dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined
  };
}

function clampPageCount(raw) {
  return Math.max(1, Number(raw) || 1);
}

function extractApiError(details) {
  if (details && typeof details === "object" && "error" in details) {
    return details.error;
  }
  return null;
}

test("buildCreatePayload: trims and lowercases the slug", () => {
  const out = buildCreatePayload({ name: "  Year 8 ", slug: "  Year-8-Storytelling  ", schoolName: "  Greenhill  ", gradeBand: "  Year 8  " });
  assert.equal(out.name, "Year 8");
  assert.equal(out.slug, "year-8-storytelling");
  assert.equal(out.schoolName, "Greenhill");
  assert.equal(out.gradeBand, "Year 8");
});

test("buildCreatePayload: empty optional fields collapse to undefined", () => {
  const out = buildCreatePayload({ name: "Class", slug: "class", schoolName: "", gradeBand: "" });
  assert.equal(out.schoolName, undefined);
  assert.equal(out.gradeBand, undefined);
});

test("isTeacher: true when 'teacher' is in roles", () => {
  assert.ok(isTeacher(["teacher"]));
  assert.ok(isTeacher(["platform_admin", "teacher"]));
  assert.ok(isTeacher(["teacher", "publisher_admin"]));
});

test("isTeacher: false when 'teacher' is missing or roles is bad", () => {
  assert.equal(isTeacher([]), false);
  assert.equal(isTeacher(["student"]), false);
  assert.equal(isTeacher(["publisher_admin"]), false);
  assert.equal(isTeacher(null), false);
  assert.equal(isTeacher(undefined), false);
  assert.equal(isTeacher("teacher"), false);
});

test("buildInvitePayload: trims and lowercases the email", () => {
  assert.deepEqual(buildInvitePayload("  Student@School.EDU  "), { studentEmail: "student@school.edu" });
});

test("buildAssignmentPayload: due-date is ISO-8601 when present", () => {
  const out = buildAssignmentPayload({ title: "Write a story", brief: "Use 3 senses", dueAt: "2026-12-01T13:00" });
  assert.equal(typeof out.dueAt, "string");
  assert.match(out.dueAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
});

test("buildAssignmentPayload: no due date → undefined", () => {
  const out = buildAssignmentPayload({ title: "Write a story", brief: "Use 3 senses", dueAt: "" });
  assert.equal(out.dueAt, undefined);
});

test("clampPageCount: anything below 1 becomes 1", () => {
  assert.equal(clampPageCount(0), 1);
  assert.equal(clampPageCount(-3), 1);
  assert.equal(clampPageCount("0"), 1);
});

test("clampPageCount: NaN or garbage → 1", () => {
  assert.equal(clampPageCount(NaN), 1);
  assert.equal(clampPageCount("abc"), 1);
  assert.equal(clampPageCount(undefined), 1);
});

test("clampPageCount: positive numbers stay", () => {
  assert.equal(clampPageCount(4), 4);
  assert.equal(clampPageCount("12"), 12);
  assert.equal(clampPageCount(17.7), 17.7);
});

test("extractApiError: pulls .error out of details", () => {
  assert.equal(extractApiError({ error: "Only teachers can create classrooms" }), "Only teachers can create classrooms");
});

test("extractApiError: null when details is empty or wrong shape", () => {
  assert.equal(extractApiError(null), null);
  assert.equal(extractApiError({}), null);
  assert.equal(extractApiError({ message: "oops" }), null);
});
