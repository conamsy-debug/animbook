/**
 * Tests for the test-database guard (tests/_guard.mjs).
 *
 * The guard is the thing that stops `npm test` from wiping production, so
 * it gets its own tests. They run the guard in child processes with
 * controlled environments and assert what it does.
 *
 * NOTE: this file deliberately does NOT `import "./_guard.mjs"`. It has to
 * be able to run the guard with a MISSING / hostile TEST_DATABASE_URL,
 * which the guard would refuse to allow in this very process.
 *
 * It never touches a database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, "..");
// --import needs a file:// URL for an absolute path on Windows.
const GUARD = pathToFileURL(join(HERE, "_guard.mjs")).href;

/** Parse a .env file without touching process.env. */
function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

const PROD_URL = parseEnvFile(join(API_DIR, ".env")).DATABASE_URL ?? "";

/**
 * A path that does not exist, so the guard finds no TEST_DATABASE_URL in
 * the .env.test file. The guard's own tests must not depend on whatever
 * the developer has configured locally.
 */
const NO_ENV_TEST_FILE = join(HERE, "__no_such_env_test_file__");

/**
 * Run the guard in a child process with a controlled environment.
 * Returns { status, stdout, stderr }.
 */
function runGuard(env) {
  // The child prints the resulting DATABASE_URL with its credentials masked,
  // so the test can assert WHERE the guard pointed it.
  const script = "console.log('GUARD_RETURNED', (process.env.DATABASE_URL||'').replace(/\\/\\/[^@]*@/, '//***@'))";
  const r = spawnSync(process.execPath, ["--import", GUARD, "-e", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...env
    },
    timeout: 60000
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

test("the guard aborts when TEST_DATABASE_URL is missing", () => {
  const r = runGuard({ DATABASE_URL: PROD_URL, ANIMBOOK_ENV_TEST_FILE: NO_ENV_TEST_FILE });
  assert.notEqual(r.status, 0, "the guard must fail the run");
  assert.match(r.stderr, /TEST_DATABASE_URL is not set/);
  assert.doesNotMatch(r.stdout, /GUARD_RETURNED/, "the script must not run");
});

test("the guard aborts when TEST_DATABASE_URL is the production database", () => {
  const r = runGuard({ DATABASE_URL: PROD_URL, TEST_DATABASE_URL: PROD_URL });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /points at the PRODUCTION database/);
  assert.doesNotMatch(r.stdout, /GUARD_RETURNED/);
});

test("the guard aborts on a same-host / different-database test URL unless explicitly allowed", () => {
  if (!PROD_URL) return; // no production URL configured - nothing to compare against
  const sameHostDifferentDb = PROD_URL.replace(/\/([^/?]+)(\?|$)/, "/animbook_test$2");
  const refused = runGuard({ DATABASE_URL: PROD_URL, TEST_DATABASE_URL: sameHostDifferentDb });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /same host as the production database/);

  const allowed = runGuard({
    DATABASE_URL: PROD_URL,
    TEST_DATABASE_URL: sameHostDifferentDb,
    ANIMBOOK_ALLOW_SAME_HOST_TEST_DB: "1"
  });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stdout, /using test database/);
});

test("the guard accepts a test database on a different host and pins DATABASE_URL to it", () => {
  const testUrl = "postgresql://animbook:pw@127.0.0.1:5432/animbook_test?schema=public";
  const r = runGuard({ DATABASE_URL: PROD_URL, TEST_DATABASE_URL: testUrl });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /using test database 127\.0\.0\.1:5432\/animbook_test/);
  assert.match(r.stdout, /GUARD_RETURNED postgresql:\/\/\*\*\*@127\.0\.0\.1:5432\/animbook_test/);
});

test("in DB-free mode the guard points DATABASE_URL at a dead address, never at production", () => {
  const r = runGuard({
    DATABASE_URL: PROD_URL,
    ANIMBOOK_SKIP_DB_TESTS: "1",
    ANIMBOOK_ENV_TEST_FILE: NO_ENV_TEST_FILE
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /ANIMBOOK_SKIP_DB_TESTS=1/);
  assert.match(r.stdout, /127\.0\.0\.1:1\/animbook_test_blocked/);
  if (PROD_URL) {
    const prodHost = new URL(PROD_URL).host;
    assert.doesNotMatch(r.stdout, new RegExp(prodHost.replace(/\./g, "\\.")), "must never point at production");
  }
});

test("a pinned DATABASE_URL (validated by a parent process) is not mistaken for production", () => {
  // A parent that already validated the test URL pins DATABASE_URL to it and
  // marks the process. The child must accept that, not refuse it.
  const testUrl = "postgresql://animbook:pw@127.0.0.1:5432/animbook_test?schema=public";
  const pinned = runGuard({
    DATABASE_URL: testUrl,
    TEST_DATABASE_URL: testUrl,
    ANIMBOOK_TEST_DB_PINNED: "1"
  });
  assert.equal(pinned.status, 0, pinned.stderr);
  assert.match(pinned.stdout, /using test database/);

  // WITHOUT that marker the same environment must still be refused: a shell
  // that points DATABASE_URL and TEST_DATABASE_URL at production is refused.
  const notPinned = runGuard({ DATABASE_URL: testUrl, TEST_DATABASE_URL: testUrl });
  assert.notEqual(notPinned.status, 0, "an unpinned DATABASE_URL must be treated as a production reference");
});

test("the guard never prints a credential", () => {
  const r = runGuard({ DATABASE_URL: PROD_URL, TEST_DATABASE_URL: "postgresql://u:supersecret@127.0.0.1:5432/animbook_test" });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /supersecret/);
  assert.doesNotMatch(r.stderr, /supersecret/);
});
