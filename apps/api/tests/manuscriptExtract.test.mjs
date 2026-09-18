/**
 * Tests for the OCR-garbage cleanup in manuscriptExtract.ts.
 *
 * The detector is heuristic — these tests pin the cases that matter:
 *  - the page 49 garbage from "Practical Physical Immortality" is stripped
 *    without losing the real sentence that follows it
 *  - clean text comes through unchanged
 *  - legitimate mixed-case words (mTOR, iPhone, NASA, PhD) survive
 *  - short garbage runs (1-2 tokens) are kept with an ellipsis marker so
 *    we don't lose prose like "...see chapter mTOR..." by accident
 *
 * Run with: `node --test tests/manuscriptExtract.test.mjs`
 */
import test from "node:test";
import assert from "node:assert/strict";

const { cleanOcrGarbage, looksLikeOcrGarbage } = await import(
  "../dist/src/services/manuscriptExtract.js"
);

test("looksLikeOcrGarbage flags the page-49 fragments", () => {
  assert.equal(looksLikeOcrGarbage("cNutorioi,nFNsaPoingNlr"), true);
  assert.equal(looksLikeOcrGarbage("dPFNanhNoMeNbeoaw"), true);
  assert.equal(looksLikeOcrGarbage("dicNSTiocMePNDMaoN"), true);
  assert.equal(looksLikeOcrGarbage("meoerHineNY"), true);
  assert.equal(looksLikeOcrGarbage("tN!ge"), true);
  assert.equal(looksLikeOcrGarbage("Nutorioi,nFNsaPoingNlr"), true);
});

test("looksLikeOcrGarbage preserves legitimate mixed-case words", () => {
  assert.equal(looksLikeOcrGarbage("mTOR"), false);
  assert.equal(looksLikeOcrGarbage("AMPK"), false);
  assert.equal(looksLikeOcrGarbage("iPhone"), false);
  assert.equal(looksLikeOcrGarbage("NASA"), false);
  assert.equal(looksLikeOcrGarbage("PhD"), false);
  assert.equal(looksLikeOcrGarbage("autophagy"), false);
  assert.equal(looksLikeOcrGarbage("Organ-Specific"), false);
  assert.equal(looksLikeOcrGarbage("Clive"), false);
  assert.equal(looksLikeOcrGarbage("1935,"), false);
});

test("cleanOcrGarbage strips the page-49 column-mixing run", () => {
  const dirty = [
    "Chapter Three",
    "",
    "Food as Medicine Organ-Speci cNutorioi,nFNsaPoingNlr,o,c,dPFNanhNoMeNbeoaw,dicNSTiocMePNDMaoN meoerHineNY,TNsaPoNA,tN!ge IN 1935, A CORNELL nutritionist named Clive McCay published a study that troubled his colleagues for a decade. He had taken two groups of laboratory rats and fed them differently; one group ate freely, the other received all necessary nutrients but roughly forty percent fewer calories. The underfed rats looked, to casual inspection, like animals failing to thrive. They were smaller, slower to mature, and visibly thin. They lived, on average, forty percent longer."
  ].join("\n");
  const cleaned = cleanOcrGarbage(dirty);

  // The real sentence must survive intact.
  assert.match(cleaned, /Clive McCay published a study that troubled his colleagues/);
  assert.match(cleaned, /laboratory rats/);
  assert.match(cleaned, /forty percent longer/);

  // The garbage fragments must be gone.
  assert.doesNotMatch(cleaned, /cNutorioi,nFNsaPoingNlr/);
  assert.doesNotMatch(cleaned, /dPFNanhNoMeNbeoaw/);
  assert.doesNotMatch(cleaned, /dicNSTiocMePNDMaoN/);
  assert.doesNotMatch(cleaned, /meoerHineNY/);
  assert.doesNotMatch(cleaned, /tN!ge/);
});

test("cleanOcrGarbage leaves the page-48 prose untouched", () => {
  const clean = [
    "But the most important development in the near term is not technological. It is the growing recognition in mainstream medicine that the body's renewal capacity is far greater than clinical practice currently assumes."
  ].join("\n");
  const cleaned = cleanOcrGarbage(clean);
  assert.equal(cleaned, clean.trim());
});

test("cleanOcrGarbage preserves mTOR / iPhone / NASA / PhD", () => {
  const text =
    "mTOR and AMPK are the master switches. The iPhone was announced at NASA. PhD students study this. Researchers in 1935 measured autophagy.";
  const cleaned = cleanOcrGarbage(text);
  assert.match(cleaned, /mTOR/);
  assert.match(cleaned, /AMPK/);
  assert.match(cleaned, /iPhone/);
  assert.match(cleaned, /NASA/);
  assert.match(cleaned, /PhD/);
  assert.match(cleaned, /autophagy/);
});

test("cleanOcrGarbage drops a paragraph that is entirely garbage", () => {
  const garbage =
    "xYzAbCdEfGhIjKlMnOpQrStUvWxYz xYzAbCdEfGhIjKlMnOpQrStUvWxYz xYzAbCdEfGhIjKlMnOpQrStUvWxYz";
  const cleaned = cleanOcrGarbage(garbage);
  assert.equal(cleaned, "");
});

test("cleanOcrGarbage marks short runs (1-2 garbage tokens) with an ellipsis so we don't lose context", () => {
  // A single bad token shouldn't be silently dropped — it could be a typo.
  // We mark it with an ellipsis so the reader + Runway still know something
  // was there.
  const text = "The study found mTOR abCDeFgHiJkLmN rats gained weight.";
  const cleaned = cleanOcrGarbage(text);
  // The bad token is preserved with the ellipsis, not silently dropped.
  assert.match(cleaned, /…/);
  // The real words stay.
  assert.match(cleaned, /The study found mTOR/);
  assert.match(cleaned, /rats gained weight/);
});

test("cleanOcrGarbage tidies whitespace after stripping a run", () => {
  const text = "Before the study.   xYzAbCdEfGhIjKlMn xYzAbCdEfGhIjKlMn xYzAbCdEfGhIjKlMn   After the study.";
  const cleaned = cleanOcrGarbage(text);
  // No double-spaces, no leading/trailing whitespace, no garbage tokens.
  assert.doesNotMatch(cleaned, /  /);
  assert.equal(cleaned, cleaned.trim());
  assert.match(cleaned, /^Before the study\./);
  assert.match(cleaned, /After the study\.$/);
});
