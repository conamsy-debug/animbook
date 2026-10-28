/**
 * HARD GUARD for the API test suite.
 *
 * WHY THIS EXISTS
 * ---------------
 * `apps/api/src/config/env.ts` does `import "dotenv/config"`, so running
 * `npm test` inside `apps/api` loads `apps/api/.env` — which points at the
 * PRODUCTION Neon database. The language-module tests then call unscoped
 * `deleteMany({})` on `exercise`, `user_vocab`, `review_log`,
 * `exercise_attempt`, `pronunciation_attempt`, `story_progress` and
 * `learner_stats`, which EMPTIES those production tables. A test run must
 * never be able to do that, even by accident.
 *
 * WHAT IT DOES
 * ------------
 * This module is loaded BEFORE any test file (see the `test` script in
 * package.json: `node --test --import ./tests/_guard.mjs ...`), and every
 * database-backed test file imports it directly as well, so a single file
 * run with `node --test tests/foo.test.mjs` is protected too.
 *
 *   1. `TEST_DATABASE_URL` MUST be set. Without it the test run ABORTS
 *      immediately with a clear message — before a single query runs.
 *   2. `TEST_DATABASE_URL` must not point at the production database
 *      (compared against the shell env AND `apps/api/.env` AND
 *      `apps/api/.env.production`). Same host + same database name is
 *      refused outright; the same host with a different database name
 *      additionally needs `ANIMBOOK_ALLOW_SAME_HOST_TEST_DB=1`.
 *   3. On success it PINS `process.env.DATABASE_URL` to `TEST_DATABASE_URL`.
 *      Every `new PrismaClient()` in the app resolves the datasource from
 *      `process.env.DATABASE_URL` at query time (prisma/schema.prisma uses
 *      `url = env("DATABASE_URL")`), so pinning it means the code under test
 *      cannot reach production either — not even the shared singleton in
 *      `src/db.ts`. `dotenv` never overwrites a variable that is already
 *      set, so loading `.env` afterwards cannot undo this.
 *
 * The production URL is never printed — only the host and database name.
 *
 * ESCAPE HATCH (for running the DB-free tests with no database at all)
 * --------------------------------------------------------------------
 *   ANIMBOOK_SKIP_DB_TESTS=1 npm run test:unit
 * In that mode the guard does not abort; instead it blanks DATABASE_URL so
 * that any accidental database access fails loudly instead of reaching
 * production. The DB-backed suites then skip themselves.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API_DIR = fileURLToPath(new URL("..", import.meta.url));

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

/**
 * What actually identifies a database: the host (which endpoint/branch) and
 * the database name. Query params like ?schema=public are ignored.
 */
function targetOf(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return {
      host: u.host.toLowerCase(),
      db: u.pathname.replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase()
    };
  } catch {
    return null;
  }
}

/** A short, credential-free label for a connection string. */
function labelOf(url) {
  const t = targetOf(url);
  if (!t) return "(unparseable)";
  return t.db ? `${t.host}/${t.db}` : t.host;
}

const envFiles = [".env", ".env.production"].map((f) => ({
  file: f,
  values: parseEnvFile(`${API_DIR}${f}`)
}));

/**
 * `TEST_DATABASE_URL` may come from the shell, or from a gitignored
 * `apps/api/.env.test` (the convenient place to keep it).
 *
 * ANIMBOOK_ENV_TEST_FILE only relocates WHERE that file is read from - it
 * changes nothing about the validation. It exists so the guard's own tests
 * can run against a controlled file.
 */
const envTestPath = process.env.ANIMBOOK_ENV_TEST_FILE ?? `${API_DIR}.env.test`;
const testEnvFile = parseEnvFile(envTestPath);
const testUrl = (
  process.env.TEST_DATABASE_URL ?? testEnvFile.TEST_DATABASE_URL ?? ""
).trim();
const testUrlSource = process.env.TEST_DATABASE_URL
  ? "the shell environment"
  : testEnvFile.TEST_DATABASE_URL
    ? "apps/api/.env.test"
    : "nowhere";
const skipDb = process.env.ANIMBOOK_SKIP_DB_TESTS === "1";

/**
 * Every DATABASE_URL we know of that could be the production database.
 *
 * The shell's DATABASE_URL is skipped ONLY when it is the value this guard
 * pinned in an already-validated parent process (ANIMBOOK_TEST_DB_PINNED).
 * Skipping it unconditionally would open a hole: a shell that sets
 * DATABASE_URL to production and TEST_DATABASE_URL to the same production
 * URL must still be refused. The .env files are always compared - they are
 * the authoritative record of the production database.
 */
const PINNED = process.env.ANIMBOOK_TEST_DB_PINNED === "1";
const knownProdUrls = [
  ["shell environment", PINNED ? undefined : process.env.DATABASE_URL],
  ...envFiles.map((e) => [e.file, e.values.DATABASE_URL])
].filter(([, v]) => typeof v === "string" && v.length > 0);

function abort(lines) {
  const bar = "=".repeat(78);
  console.error(`\n${bar}\nANIMBOOK TEST GUARD - refusing to run\n${bar}\n`);
  for (const l of lines) console.error(l);
  console.error(`\n${bar}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * 1. TEST_DATABASE_URL must be present
 * ------------------------------------------------------------------ */
if (!testUrl) {
  if (skipDb) {
    // DB-free mode: point the datasource at a dead address instead of
    // blanking it. Prisma validates the datasource URL when the client is
    // constructed, so an empty value would break every module that creates
    // a client at import time - and those modules carry plenty of
    // database-free tests. With a sentinel the imports still work, the
    // DB-backed suites skip themselves (they read TEST_DATABASE_URL), and
    // anything that really queries fails loudly against 127.0.0.1:1.
    process.env.DATABASE_URL = "postgresql://animbook:animbook@127.0.0.1:1/animbook_test_blocked";
    console.warn(
      "[test-guard] ANIMBOOK_SKIP_DB_TESTS=1 - no database is used; DATABASE_URL points at a dead address."
    );
  } else {
    abort([
      "TEST_DATABASE_URL is not set.",
      "",
      "The API test suite must never touch the production database, so it refuses",
      "to run without an explicit test database.",
      "",
      "  Set it in the shell:",
      "",
      '    $env:TEST_DATABASE_URL = "postgresql://user:pass@host/dbname?schema=public"',
      "",
      "  or put it in apps/api/.env.test (gitignored) - see .env.test.example.",
      "",
      "  To run only the tests that need no database:",
      "",
      "    npm run test:unit",
      "",
      `  Known production DATABASE_URL (not used): ${knownProdUrls
        .map(([, v]) => labelOf(v))
        .join(", ")}`,
    ]);
  }
} else {
  /* -------------------------------------------------------------- *
   * 2. TEST_DATABASE_URL must not be the production database
   * -------------------------------------------------------------- */
  const testTarget = targetOf(testUrl);
  const sameHostOptIn = process.env.ANIMBOOK_ALLOW_SAME_HOST_TEST_DB === "1";

  for (const [source, prodUrl] of knownProdUrls) {
    const prodTarget = targetOf(prodUrl);
    if (!prodTarget || !testTarget) continue;
    const sameHost = prodTarget.host === testTarget.host;
    const sameDb = prodTarget.db === testTarget.db;
    if (!sameHost) continue;

    if (sameDb) {
      abort([
        `TEST_DATABASE_URL points at the PRODUCTION database (${labelOf(prodUrl)}).`,
        "",
        `  source of the production URL: ${source}`,
        "",
        "  The test suite would wipe production tables. Refusing to run.",
      ]);
    }
    if (!sameHostOptIn) {
      abort([
        `TEST_DATABASE_URL uses the same host as the production database (${testTarget.host}).`,
        "",
        `  production database: ${labelOf(prodUrl)} (from ${source})`,
        `  test database:       ${labelOf(testUrl)}`,
        "",
        "  A different database on the same endpoint is allowed, but only when you",
        "  are certain it is not production. Re-run with:",
        "",
        "    ANIMBOOK_ALLOW_SAME_HOST_TEST_DB=1",
      ]);
    }
  }

  /* -------------------------------------------------------------- *
   * 3. Pin the datasource so the code under test cannot reach prod
   * -------------------------------------------------------------- */
  process.env.DATABASE_URL = testUrl;
  // The test files read TEST_DATABASE_URL. Publish the value we resolved
  // (whether it came from the shell or from .env.test) so the suites run
  // instead of silently skipping.
  process.env.TEST_DATABASE_URL = testUrl;
  // Tell a child process that this DATABASE_URL was validated and pinned
  // here, so it does not mistake it for a production reference.
  process.env.ANIMBOOK_TEST_DB_PINNED = "1";
  console.log(`[test-guard] using test database ${labelOf(testUrl)} (from ${testUrlSource})`);
  console.log(
    `[test-guard] DATABASE_URL pinned to the test database - ` +
      `${knownProdUrls.map(([, v]) => labelOf(v)).join(", ") || "the production database"} ` +
      `is unreachable from this run.`
  );
}
