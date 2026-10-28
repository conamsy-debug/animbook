/**
 * Preload for `npm run test:unit` - runs the suite WITHOUT a database.
 *
 * It sets ANIMBOOK_SKIP_DB_TESTS=1 and then loads the real guard, which
 * blanks DATABASE_URL so that no database-backed suite can reach anything
 * (the DB suites detect the empty URL and skip themselves).
 *
 * Cross-platform on purpose: no `set X=1 &&` shell syntax, so it works the
 * same on Windows, macOS and Linux CI.
 */
process.env.ANIMBOOK_SKIP_DB_TESTS = "1";
await import("./_guard.mjs");
