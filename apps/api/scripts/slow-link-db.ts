/**
 * Imported FIRST by the seed-media script (before the Prisma client exists).
 *
 * The script runs on a laptop via `railway run`, often over a slow or
 * long-distance link to Neon. Prisma's defaults (5s connect timeout, 10s pool
 * timeout) are tuned for servers next to the database, so we lengthen them
 * here — only for this script, never for the live API.
 */
const raw = process.env.DATABASE_URL;
if (raw) {
  try {
    const url = new URL(raw);
    if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "60");
    if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "60");
    process.env.DATABASE_URL = url.toString();
  } catch {
    // Unparseable URL — leave it for Prisma to report.
  }
}

export {};
