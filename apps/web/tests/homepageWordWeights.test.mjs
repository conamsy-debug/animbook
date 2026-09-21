// Pure-logic tests for the homepage word-weight timing helper. Run
// with: `node --test apps/web/tests/homepageWordWeights.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { weightWords, findWordAt } from "../src/lib/homepage/wordWeights.ts";

test("weightWords: empty input → empty array", () => {
  assert.deepEqual(weightWords(""), []);
  assert.deepEqual(weightWords("   "), []);
  assert.deepEqual(weightWords("\n\t  "), []);
});

test("weightWords: single word covers the full range", () => {
  const words = weightWords("hello");
  assert.equal(words.length, 1);
  assert.equal(words[0].word, "hello");
  assert.equal(words[0].start, 0);
  assert.equal(words[0].end, 1);
});

test("weightWords: many words, fractions sum to 1 and are monotonic", () => {
  const text = "The quick brown fox jumps over the lazy dog";
  const words = weightWords(text);
  assert.equal(words.length, 9);
  for (let i = 1; i < words.length; i++) {
    assert.ok(words[i].start >= words[i - 1].end - 1e-9, `start ${i} < prev end`);
  }
  assert.ok(Math.abs(words[words.length - 1].end - 1) < 1e-9, "last word ends at 1");
});

test("weightWords: longer words get a wider range than shorter ones", () => {
  const words = weightWords("I am extraordinary");
  // "I" → 1 char, "am" → 2 chars, "extraordinary" → 13 chars
  const iRange = words[0].end - words[0].start;
  const amRange = words[1].end - words[1].start;
  const exRange = words[2].end - words[2].start;
  assert.ok(exRange > amRange);
  assert.ok(amRange > iRange);
});

test("weightWords: pure-punctuation tokens are dropped", () => {
  // Standalone "!" and "..." have no letters/numbers → dropped.
  // Trailing punctuation on a word (e.g. "world!") stays because
  // the word itself contains letters.
  const words = weightWords("Hello world! ! ... done");
  assert.deepEqual(words.map((w) => w.word), ["Hello", "world!", "done"]);
});

test("weightWords: hyphenated words stay one token", () => {
  const words = weightWords("well-known author");
  assert.equal(words.length, 2);
  assert.equal(words[0].word, "well-known");
});

test("weightWords: unicode is weighted by character count", () => {
  // "café" is 4 letters, "résumé" is 6 letters — ratio 4:6 = 2:3.
  const words = weightWords("café résumé");
  assert.equal(words.length, 2);
  assert.equal(words[0].word, "café");
  assert.equal(words[1].word, "résumé");
  const cafeRange = words[0].end - words[0].start;
  const resumeRange = words[1].end - words[1].start;
  // résumé range should be 1.5× café range.
  assert.ok(Math.abs(resumeRange / cafeRange - 1.5) < 1e-6, `ratio was ${resumeRange / cafeRange}`);
});

test("findWordAt: returns the right index for each fraction", () => {
  // Use equal-weight input (4 same-length words) so boundaries land at
  // exact quarter points: 0, 0.25, 0.5, 0.75, 1.
  const words = weightWords("aaaa bbbb cccc dddd");
  assert.equal(words.length, 4);
  assert.equal(findWordAt(words, 0.0), 0);
  assert.equal(findWordAt(words, 0.1), 0);
  // 0.25 belongs to the second word (half-open: f >= start, f < end).
  assert.equal(findWordAt(words, 0.25), 1);
  assert.equal(findWordAt(words, 0.5), 2);
  assert.equal(findWordAt(words, 0.74), 2);
  assert.equal(findWordAt(words, 0.75), 3);
  assert.equal(findWordAt(words, 1.0), 3, "last word owns up to 1.0");
});

test("findWordAt: empty words → -1", () => {
  assert.equal(findWordAt([], 0.5), -1);
});

test("findWordAt: clamps out-of-range fractions", () => {
  const words = weightWords("alpha beta");
  assert.equal(findWordAt(words, -0.5), 0);
  assert.equal(findWordAt(words, 1.5), 1);
});
