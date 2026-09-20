// Pure-logic tests for the AnimBook INSTITUTIONS seat math.
//
// The institution module is mostly thin Express wiring around Prisma.
// The seat math (read JSON column, dedupe, capacity check) is the part
// worth pinning so we don't regress on "can't seat the same student
// twice" or "negative remaining" bugs.
//
// Run with: `node --test apps/api/tests/institutions.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";

/** Mirror the readSeats helper in routes.ts. */
function readSeats(json) {
  if (json && typeof json === "object" && "studentIds" in json && Array.isArray(json.studentIds)) {
    return json.studentIds.filter((id) => typeof id === "string");
  }
  return [];
}

/** Adds a student to the seat list, returning the new list. Handles
 *  already-seated and capacity. */
function addSeat(json, studentId, seatCount) {
  const seats = readSeats(json);
  if (seats.includes(studentId)) return { json: { studentIds: seats }, changed: false, reason: "already" };
  if (seats.length >= seatCount) return { json: { studentIds: seats }, changed: false, reason: "capacity" };
  return { json: { studentIds: [...seats, studentId] }, changed: true, reason: "ok" };
}

function removeSeat(json, studentId) {
  return { studentIds: readSeats(json).filter((s) => s !== studentId) };
}

test("readSeats: extracts array from valid JSON", () => {
  assert.deepEqual(readSeats({ studentIds: ["u1", "u2"] }), ["u1", "u2"]);
});

test("readSeats: garbage JSON returns empty array", () => {
  assert.deepEqual(readSeats({}), []);
  assert.deepEqual(readSeats({ studentIds: "nope" }), []);
  assert.deepEqual(readSeats(null), []);
});

test("readSeats: filters non-string entries", () => {
  assert.deepEqual(readSeats({ studentIds: ["u1", 42, "u2"] }), ["u1", "u2"]);
});

test("addSeat: first student goes through", () => {
  const result = addSeat(null, "u1", 30);
  assert.equal(result.changed, true);
  assert.deepEqual(result.json.studentIds, ["u1"]);
});

test("addSeat: already-seated student is idempotent", () => {
  const result = addSeat({ studentIds: ["u1"] }, "u1", 30);
  assert.equal(result.changed, false);
  assert.equal(result.reason, "already");
  assert.deepEqual(result.json.studentIds, ["u1"]);
});

test("addSeat: refuses beyond seatCount", () => {
  const seats = { studentIds: ["u1", "u2", "u3"] };
  const result = addSeat(seats, "u4", 3);
  assert.equal(result.changed, false);
  assert.equal(result.reason, "capacity");
  assert.deepEqual(result.json.studentIds, ["u1", "u2", "u3"]);
});

test("addSeat: at capacity but a seat was vacated → succeeds", () => {
  // 3 seats, 2 currently used — adding the 3rd is fine
  const result = addSeat({ studentIds: ["u1", "u2"] }, "u3", 3);
  assert.equal(result.changed, true);
  assert.deepEqual(result.json.studentIds, ["u1", "u2", "u3"]);
});

test("removeSeat: removes the student", () => {
  const result = removeSeat({ studentIds: ["u1", "u2", "u3"] }, "u2");
  assert.deepEqual(result.studentIds, ["u1", "u3"]);
});

test("removeSeat: missing student is a no-op", () => {
  const result = removeSeat({ studentIds: ["u1"] }, "ghost");
  assert.deepEqual(result.studentIds, ["u1"]);
});

test("addSeat then removeSeat round-trips", () => {
  let state = null;
  for (const id of ["a", "b", "c"]) {
    const r = addSeat(state, id, 5);
    state = r.json;
  }
  assert.deepEqual(readSeats(state), ["a", "b", "c"]);
  // removeSeat returns { studentIds: [...] } — re-wrap for readSeats.
  state = removeSeat(state, "b");
  assert.deepEqual(state.studentIds, ["a", "c"]);
});
