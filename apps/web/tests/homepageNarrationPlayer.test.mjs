// Pure-logic tests for the homepage narration player state machine.
// Run with: `node --test apps/web/tests/homepageNarrationPlayer.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { transition, ariaLabelFor, iconFor, INITIAL_STATE } from "../src/lib/homepage/narrationPlayer.ts";

test("initial state is idle", () => {
  assert.equal(INITIAL_STATE, "idle");
});

test("PLAY from idle → playing", () => {
  assert.equal(transition("idle", { type: "PLAY" }), "playing");
});

test("PLAY from paused → playing (resume)", () => {
  assert.equal(transition("paused", { type: "PLAY" }), "playing");
});

test("PLAY from ended → playing (replay from top)", () => {
  assert.equal(transition("ended", { type: "PLAY" }), "playing");
});

test("PAUSE from playing → paused", () => {
  assert.equal(transition("playing", { type: "PAUSE" }), "paused");
});

test("PAUSE from idle is a no-op", () => {
  assert.equal(transition("idle", { type: "PAUSE" }), "idle");
});

test("PAUSE from ended is a no-op", () => {
  assert.equal(transition("ended", { type: "PAUSE" }), "ended");
});

test("END from playing → ended", () => {
  assert.equal(transition("playing", { type: "END" }), "ended");
});

test("END from paused → ended (e.g. user paused then audio buffered and finished)", () => {
  assert.equal(transition("paused", { type: "END" }), "ended");
});

test("END from idle is a no-op", () => {
  assert.equal(transition("idle", { type: "END" }), "idle");
});

test("RESET from any state → idle", () => {
  for (const s of ["idle", "playing", "paused", "ended"]) {
    assert.equal(transition(s, { type: "RESET" }), "idle", `RESET from ${s} should → idle`);
  }
});

test("aria-label flips between Play and Pause", () => {
  assert.equal(ariaLabelFor("idle"), "Play narration");
  assert.equal(ariaLabelFor("playing"), "Pause narration");
  assert.equal(ariaLabelFor("paused"), "Play narration");
  assert.equal(ariaLabelFor("ended"), "Play narration");
});

test("icon flips between play and pause", () => {
  assert.equal(iconFor("idle"), "play");
  assert.equal(iconFor("playing"), "pause");
  assert.equal(iconFor("paused"), "play");
  assert.equal(iconFor("ended"), "play");
});

test("full lifecycle: idle → playing → paused → playing → ended → idle", () => {
  let s = "idle";
  s = transition(s, { type: "PLAY" });
  assert.equal(s, "playing");
  s = transition(s, { type: "PAUSE" });
  assert.equal(s, "paused");
  s = transition(s, { type: "PLAY" });
  assert.equal(s, "playing");
  s = transition(s, { type: "END" });
  assert.equal(s, "ended");
  s = transition(s, { type: "RESET" });
  assert.equal(s, "idle");
});
