import test from "node:test";
import assert from "node:assert/strict";
import { liveEventBus } from "../dist/modules/live/bus.js";

test("publish with no subscribers is a no-op", () => {
  // Fresh session id; no one subscribed yet
  liveEventBus.publish("session-no-subscribers", { type: "session.started", payload: { ok: true } });
  // We assert by absence of crash — subscriberCount should still be 0.
  assert.equal(liveEventBus.subscriberCount("session-no-subscribers"), 0);
});

test("subscribe + publish delivers to every subscriber", () => {
  const sessionId = "session-fanout";
  const received1 = [];
  const received2 = [];
  const u1 = liveEventBus.subscribe(sessionId, (ev) => received1.push(ev));
  const u2 = liveEventBus.subscribe(sessionId, (ev) => received2.push(ev));
  try {
    liveEventBus.publish(sessionId, { type: "page.flipped", payload: { pageNum: 3 } });
    assert.equal(received1.length, 1);
    assert.equal(received2.length, 1);
    assert.equal(received1[0].type, "page.flipped");
    assert.equal(received1[0].payload.pageNum, 3);
  } finally {
    u1();
    u2();
  }
});

test("subscriberCount tracks live connections (0 when empty, N when full)", () => {
  const sessionId = "session-count";
  assert.equal(liveEventBus.subscriberCount(sessionId), 0);
  const u1 = liveEventBus.subscribe(sessionId, () => {});
  assert.equal(liveEventBus.subscriberCount(sessionId), 1);
  const u2 = liveEventBus.subscribe(sessionId, () => {});
  assert.equal(liveEventBus.subscriberCount(sessionId), 2);
  u1();
  assert.equal(liveEventBus.subscriberCount(sessionId), 1);
  u2();
  assert.equal(liveEventBus.subscriberCount(sessionId), 0);
});

test("unsubscribe stops delivery but doesn't crash subsequent publishes", () => {
  const sessionId = "session-unsub";
  const received = [];
  const unsub = liveEventBus.subscribe(sessionId, (ev) => received.push(ev));
  liveEventBus.publish(sessionId, { type: "page.flipped", payload: { pageNum: 1 } });
  assert.equal(received.length, 1);
  unsub();
  liveEventBus.publish(sessionId, { type: "page.flipped", payload: { pageNum: 2 } });
  assert.equal(received.length, 1, "no event after unsubscribe");
});

test("a throwing subscriber doesn't break the others", () => {
  const sessionId = "session-throw";
  const okReceived = [];
  liveEventBus.subscribe(sessionId, () => {
    throw new Error("subscriber kaboom");
  });
  const u2 = liveEventBus.subscribe(sessionId, (ev) => okReceived.push(ev));
  try {
    liveEventBus.publish(sessionId, { type: "page.flipped", payload: { pageNum: 7 } });
    assert.equal(okReceived.length, 1, "second subscriber still received the event");
  } finally {
    u2();
  }
});

test("publishes on a different session don't leak", () => {
  const a = "session-a";
  const b = "session-b";
  const aReceived = [];
  const bReceived = [];
  const ua = liveEventBus.subscribe(a, (ev) => aReceived.push(ev));
  const ub = liveEventBus.subscribe(b, (ev) => bReceived.push(ev));
  try {
    liveEventBus.publish(a, { type: "page.flipped", payload: { pageNum: 1 } });
    assert.equal(aReceived.length, 1);
    assert.equal(bReceived.length, 0);
  } finally {
    ua();
    ub();
  }
});
