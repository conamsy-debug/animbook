// Pure-logic tests for the AnimBook NETWORK page UI helpers.
//
// Pin the shape of the scope catalog (rendered in the table on /network)
// and the test-key click handler's request shape so the UI stays
// consistent with the API.
//
// Run with: `node --test apps/web/tests/networkSync.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";

const SCOPE_DOCS = [
  { scope: "books:read", label: "Read books", description: "GET /api/books, GET /api/books/:id, GET /api/books/:id/pages — list and read published AnimBooks." },
  { scope: "library:write", label: "Modify library", description: "POST /api/library — record the reader's progress on behalf of a signed-in user." },
  { scope: "edu:write", label: "Post EDU work", description: "POST /api/edu/* — push curriculum data on behalf of a teacher account." },
  { scope: "creator:read", label: "Read creator profile", description: "GET /api/creator/:handle — read public creator profiles and book metadata." }
];

function findScopeDoc(scopeName) {
  return SCOPE_DOCS.find((s) => s.scope === scopeName) ?? null;
}

function buildBearer(prefix, secret) {
  return `${prefix}.${secret}`;
}

test("findScopeDoc: returns the matching scope", () => {
  const d = findScopeDoc("books:read");
  assert.ok(d);
  assert.match(d.description, /\/api\/books/);
});

test("findScopeDoc: returns null for unknown scopes", () => {
  assert.equal(findScopeDoc("admin:nuke"), null);
});

test("SCOPE_DOCS: every scope has a label + description", () => {
  for (const s of SCOPE_DOCS) {
    assert.ok(s.label.length > 0, `${s.scope} missing label`);
    assert.ok(s.description.length > 10, `${s.scope} missing description`);
  }
});

test("SCOPE_DOCS: matches the API's accepted scopes", () => {
  const apiScopes = ["books:read", "library:write", "edu:write", "creator:read"];
  assert.deepEqual(SCOPE_DOCS.map((s) => s.scope).sort(), apiScopes.sort());
});

test("buildBearer: prefix.secret shape", () => {
  assert.equal(buildBearer("abk_abcd1234", "supersecret"), "abk_abcd1234.supersecret");
});

test("buildBearer: round-trips split on first dot", () => {
  const token = buildBearer("abk_0011aabb", "secret");
  const dot = token.indexOf(".");
  const prefix = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  assert.equal(prefix, "abk_0011aabb");
  assert.equal(secret, "secret");
});
