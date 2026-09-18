/**
 * The gate that keeps private messaging away from school and child accounts.
 *
 * These tests are deliberately blunt: every way an account can be marked must
 * come back protected, an unrecognised value must come back protected, and
 * only a plain adult account with no classroom place gets through.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { verdictFor } from "../dist/src/services/accountStanding.js";

const adult = { accountKind: "ADULT", communityDisabled: false, classroomMemberships: 0 };

test("an ordinary adult account can message", () => {
  assert.equal(verdictFor(adult).protected, false);
});

test("a school account cannot message", () => {
  const v = verdictFor({ ...adult, accountKind: "SCHOOL" });
  assert.equal(v.protected, true);
  assert.equal(v.reason, "school");
});

test("an account declared as a minor cannot message", () => {
  const v = verdictFor({ ...adult, accountKind: "MINOR" });
  assert.equal(v.protected, true);
  assert.equal(v.reason, "minor");
});

test("community writing switched off closes messaging too", () => {
  const v = verdictFor({ ...adult, communityDisabled: true });
  assert.equal(v.protected, true);
  assert.equal(v.reason, "disabled");
});

test("a classroom place closes messaging even if the kind flag was missed", () => {
  const v = verdictFor({ ...adult, classroomMemberships: 1 });
  assert.equal(v.protected, true);
  assert.equal(v.reason, "classroom");
});

test("a missing account is protected, not permitted", () => {
  assert.equal(verdictFor(null).protected, true);
  assert.equal(verdictFor(undefined).protected, true);
});

test("an unrecognised account kind is protected, not permitted", () => {
  assert.equal(verdictFor({ ...adult, accountKind: "" }).protected, true);
  assert.equal(verdictFor({ ...adult, accountKind: "TEACHER" }).protected, true);
  assert.equal(verdictFor({ ...adult, accountKind: "adult" }).protected, true);
});
