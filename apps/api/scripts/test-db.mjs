/**
 * Safe runner for everything that touches the TEST database.
 *
 * Every command in here (migrate, seed, test) must run against the
 * disposable test database and NEVER against production. Rather than
 * trusting each caller to set DATABASE_URL correctly, this script:
 *
 *   1. reads TEST_DATABASE_URL from apps/api/.env.test (gitignored),
 *   2. hands it to the SAME guard the test suite uses
 *      (apps/api/tests/_guard.mjs), which refuses to start if the value
 *      is missing or resolves to the production database, and which pins
 *      process.env.DATABASE_URL to it,
 *   3. runs the command with that pinned environment.
 *
 * That last point is the important one: `prisma migrate deploy` and
 * `prisma/seed.ts` would otherwise read apps/api/.env and hit PRODUCTION,
 * because the Prisma CLI loads .env on its own.
 *
 * Usage:
 *   node apps/api/scripts/test-db.mjs check      # validate + show the target
 *   node apps/api/scripts/test-db.mjs migrate   # prisma migrate deploy
 *   node apps/api/scripts/test-db.mjs seed      # prisma/seed.ts
 *   node apps/api/scripts/test-db.mjs test      # the API test suite
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_DIR = fileURLToPath(new URL("../../..", import.meta.url));
const ENV_TEST = join(API_DIR, ".env.test");

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

const testUrl = (parseEnvFile(ENV_TEST).TEST_DATABASE_URL ?? "").trim();

if (!testUrl) {
  console.error(
    `\nNo TEST_DATABASE_URL in apps/api/.env.test.\n\n` +
      `  Copy apps/api/.env.test.example to apps/api/.env.test and paste the\n` +
      `  connection string of the Neon "test" branch (direct, non-pooled).\n`
  );
  process.exit(1);
}

// The guard validates it (refuses production) and pins DATABASE_URL for us.
process.env.TEST_DATABASE_URL = testUrl;
await import("../tests/_guard.mjs");

/** host + database name, no credentials. */
function label(url) {
  const u = new URL(url);
  return `${u.host}/${u.pathname.replace(/^\/+/, "")}`;
}

const target = label(testUrl);
const prodUrl = (parseEnvFile(join(API_DIR, ".env")).DATABASE_URL ?? "").trim();
const prodTarget = prodUrl ? label(prodUrl) : "(none)";

console.log(`\n  test target : ${target}`);
console.log(`  production  : ${prodTarget}`);

if (/-pooler\./.test(new URL(testUrl).host)) {
  console.warn(
    "\n  WARNING: the test host is a POOLED (-pooler) endpoint. Prisma's\n" +
      "  interactive transactions do not work through PgBouncer transaction\n" +
      "  pooling - the language tests will fail with 'Transaction not found'.\n" +
      "  Use the branch's DIRECT (non-pooled) connection string.\n"
  );
}
if (prodUrl && new URL(testUrl).host === new URL(prodUrl).host) {
  console.error("\n  ABORT: the test URL is on the production host.\n");
  process.exit(1);
}
console.log("");

const COMMANDS = {
  check: null,
  migrate: {
    cmd: process.execPath,
    args: [join(REPO_DIR, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"],
    cwd: API_DIR,
    label: "prisma migrate deploy"
  },
  seed: {
    cmd: process.execPath,
    args: [join(REPO_DIR, "node_modules", "tsx", "dist", "cli.mjs"), "prisma/seed.ts"],
    cwd: API_DIR,
    label: "prisma/seed.ts"
  },
  test: {
    cmd: process.execPath,
    // --test-concurrency=1: the language suites all load the SAME fixture and
    // wipe the SAME global tables (unscoped exercise.deleteMany({})), so they
    // must not run at the same time.
    args: ["--test", "--test-concurrency=1", "--import", "./tests/_guard.mjs", "tests/*.test.mjs"],
    cwd: API_DIR,
    label: "the API test suite"
  }
};

const mode = process.argv[2] ?? "check";
const spec = COMMANDS[mode];
if (spec === undefined) {
  console.error(`Usage: node apps/api/scripts/test-db.mjs ${Object.keys(COMMANDS).join("|")}`);
  process.exit(1);
}
if (spec === null) {
  console.log("  Guard accepted the test database. Nothing to run.\n");
  process.exit(0);
}

console.log(`  -> ${spec.label} against ${target}\n`);
const r = spawnSync(spec.cmd, spec.args, {
  cwd: spec.cwd,
  stdio: "inherit",
  env: { ...process.env }
});
process.exit(r.status ?? 1);
