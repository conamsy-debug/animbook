/**
 * Sanity test: every `.sql` file under `apps/api/prisma/migrations/`
 * must start with `-- ` (the standard Prisma migration comment), NOT
 * with a UTF-8 BOM (`EF BB BF`).
 *
 * Why: Patch 02 shipped with a BOM at byte 0 of its migration.sql.
 * Postgres rejects the file at `prisma migrate deploy` time with
 * `syntax error at or near "\u{feff}"`. The fix is one-time — but the
 * regression needs a guard so a future copy/paste from a Windows
 * editor can't reintroduce it.
 *
 * Run: `node --test apps/api/tests/migrationsBom.test.mjs`
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../prisma/migrations");

function* walkMigrations(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip a directory named something like ".shadow" if it ever
      // shows up. Prisma uses shadow databases but those aren't
      // committed here.
      yield* walkMigrations(full);
    } else if (entry.isFile() && entry.name.endsWith(".sql")) {
      yield full;
    }
  }
}

/** Detect a UTF-8 BOM (EF BB BF) at byte 0. */
function hasBom(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(3);
    const read = fs.readSync(fd, buf, 0, 3, 0);
    if (read < 3) return false;
    return buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  } finally {
    fs.closeSync(fd);
  }
}

test("every migration .sql file under prisma/migrations has no UTF-8 BOM", () => {
  // Sanity: the directory exists.
  assert.ok(
    fs.existsSync(migrationsDir),
    `migrations directory not found: ${migrationsDir}`
  );

  const offenders = [];
  for (const sqlFile of walkMigrations(migrationsDir)) {
    if (hasBom(sqlFile)) {
      offenders.push(sqlFile);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these migration files start with a UTF-8 BOM and Postgres will reject them with "syntax error at or near \\"\\u{feff}\\"" — strip with:\n` +
      offenders.map((f) => `  node -e "const b=require('fs').readFileSync(${JSON.stringify(f)});require('fs').writeFileSync(${JSON.stringify(f)},b.subarray(3))"`).join("\n")
  );
});

test("every migration .sql file under prisma/migrations starts with a comment line", () => {
  // Adjacent sanity: the first non-empty line is a SQL comment (`--`).
  // Prisma-generated migrations always start with `-- Migration ...`
  // and the BOM bug breaks that.
  const offenders = [];
  for (const sqlFile of walkMigrations(migrationsDir)) {
    const head = fs.readFileSync(sqlFile, "utf8").replace(/^\uFEFF/, "").split("\n")[0] ?? "";
    if (!head.trimStart().startsWith("--")) {
      offenders.push(`${sqlFile} → first line: ${JSON.stringify(head.slice(0, 80))}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `migration files where the first line is not a SQL comment — likely a BOM or stray data:\n` +
      offenders.join("\n")
  );
});

test("the Patch 02 migration file (20260922120000_animbook_languages_p1) exists and is clean", () => {
  // Pin the specific file that introduced the bug. If this fails,
  // either the migration was renamed or a future edit re-added the
  // BOM.
  const target = path.join(migrationsDir, "20260922120000_animbook_languages_p1/migration.sql");
  assert.ok(fs.existsSync(target), `expected ${target}`);
  assert.equal(hasBom(target), false, "Patch 02 migration.sql must not start with a BOM");
});
