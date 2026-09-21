// Pure-logic tests for the useResilientFetch hook's helper pieces.
//
// The hook itself is a thin orchestrator over apiFetch + setTimeout. The
// interesting guarantees worth pinning in tests are:
//   - stuckMs timer fires before timeoutMs
//   - timeoutMs fires the hard error state
//   - retry() bumps the retryKey, which re-runs the effect
//   - the error message includes the tag for debuggability
//
// Run with: `node --test apps/web/tests/useResilientFetch.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";

/** Tiny mock of the hook's reducer-like state machine. Mirrors the
 *  real hook's stuck/timeout/load transitions without React. */
function makeResilient(opts = {}) {
  const stuckMs = opts.stuckMs ?? 4_000;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const tag = opts.tag ?? "[mock]";
  const state = { data: null, loading: true, error: null, stuck: false, toasts: [] };
  const fakeApiFetch = opts.fetch ?? (async () => ({ ok: 1 }));

  const timers = [];
  const clear = () => timers.forEach((t) => clearTimeout(t));
  timers.push(setTimeout(() => { state.stuck = true; }, stuckMs));
  timers.push(setTimeout(() => {
    state.error = `${tag} timeout at ${timeoutMs}ms`;
    state.loading = false;
  }, timeoutMs));
  (async () => {
    try {
      const res = await fakeApiFetch();
      clear();
      state.data = res;
      state.loading = false;
    } catch (err) {
      clear();
      state.error = `${tag} failed: ${err?.message ?? String(err)}`;
      state.loading = false;
    }
  })();
  return state;
}

test("stuck fires before timeout (4s before 8s)", async () => {
  const s = makeResilient({ tag: "[STUCK-TEST]", stuckMs: 50, timeoutMs: 100, fetch: () => new Promise(() => {}) });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(s.stuck, true, "stuck should fire by 60ms");
  assert.equal(s.loading, true, "loading still true (waiting for timeout)");
  assert.equal(s.error, null);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(s.loading, false);
  assert.match(s.error, /timeout at 100ms/);
});

test("successful fetch clears both timers and sets data", async () => {
  const s = makeResilient({ tag: "[OK-TEST]", stuckMs: 100, timeoutMs: 1000, fetch: async () => ({ x: 42 }) });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(s.data, { x: 42 });
  assert.equal(s.loading, false);
  assert.equal(s.stuck, false, "stuck cleared because fetch won");
  assert.equal(s.error, null);
});

test("failed fetch sets error and stops loading", async () => {
  const s = makeResilient({
    tag: "[FAIL-TEST]",
    stuckMs: 100,
    timeoutMs: 1000,
    fetch: async () => { throw new Error("503 Service Unavailable"); }
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(s.data, null);
  assert.equal(s.loading, false);
  assert.match(s.error, /\[FAIL-TEST\] failed: 503 Service Unavailable/);
});

test("error message includes the supplied tag for debuggability", async () => {
  const s = makeResilient({
    tag: "[WORLDS]",
    stuckMs: 100,
    timeoutMs: 1000,
    fetch: async () => { throw new Error("Failed to fetch"); }
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.match(s.error, /^\[WORLDS\] failed: Failed to fetch/);
});
