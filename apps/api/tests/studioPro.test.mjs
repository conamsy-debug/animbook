/**
 * Unit tests for the STUDIO PRO companion ID generator.
 *
 * Companion IDs are deterministic — re-running the same book id must
 * always produce the same marker hash and NFC tag id. Pinning the
 * format matters for QR-code re-printable journeys.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  generateMarkerHash,
  generateNfcTagId,
  ensureCompanionLink,
  findCompanionLinkByMarker,
  findCompanionLinkByNfc
} from "../dist/services/studioPro.js";

test("generateMarkerHash: deterministic + sha256 of stable seed string", () => {
  const bookId = "cmsvoddhp00097k4opyzqnnwl";
  const a = generateMarkerHash(bookId);
  const b = generateMarkerHash(bookId);
  assert.equal(a, b);
  const expected = crypto.createHash("sha256").update(`animbook.studio.pro.v1:${bookId}`).digest("hex");
  assert.equal(a, expected);
  assert.equal(a.length, 64);
});

test("generateNfcTagId: deterministic + 14 hex chars in AB-XXXX-XXXX-XXXX-XX shape", () => {
  const bookId = "cmsvoddhp00097k4opyzqnnwl";
  const a = generateNfcTagId(bookId);
  const b = generateNfcTagId(bookId);
  assert.equal(a, b);
  assert.match(a, /^AB-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{2}$/);
});

test("generateMarkerHash: distinct books have distinct hashes", () => {
  const a = generateMarkerHash("book-a");
  const b = generateMarkerHash("book-b");
  assert.notEqual(a, b);
});

test("generateNfcTagId: distinct books have distinct tags", () => {
  const a = generateNfcTagId("book-a");
  const b = generateNfcTagId("book-b");
  assert.notEqual(a, b);
});

test("ensureCompanionLink: idempotent — same book id produces same link record", async () => {
  const bookId = `test-book-idempotent-${Date.now()}`;
  const a = await ensureCompanionLink(bookId);
  const b = await ensureCompanionLink(bookId);
  assert.equal(a.id, b.id);
  assert.equal(a.markerHash, b.markerHash);
  assert.equal(a.nfcTagId, b.nfcTagId);
});

test("ensureCompanionLink: link is findable by marker hash and by NFC tag", async () => {
  const bookId = `test-book-lookup-${Date.now()}`;
  const created = await ensureCompanionLink(bookId);
  const byMarker = await findCompanionLinkByMarker(created.markerHash);
  const byNfc = await findCompanionLinkByNfc(created.nfcTagId);
  assert.equal(byMarker?.id, created.id);
  assert.equal(byNfc?.id, created.id);
});
