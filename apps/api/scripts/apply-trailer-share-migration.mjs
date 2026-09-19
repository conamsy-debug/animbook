// Apply the additive trailer + share migration to Neon before pushing
// code that uses the new tables. Idempotent: skips if already applied.
// Run via:  railway run -- node scripts/apply-trailer-share-migration.mjs
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();

// Check current state
const tables = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('book_shares','share_clicks')`;
const existing = new Set(tables.map((t) => t.table_name));
console.log("existing tables:", [...existing]);

if (existing.has("book_shares") && existing.has("share_clicks")) {
  console.log("both tables exist — migration already applied, skipping");
  process.exit(0);
}

const sql = readFileSync(new URL("../prisma/migrations/20260918200000_trailer_and_share/migration.sql", import.meta.url), "utf8");
console.log("running migration…");
await prisma.$executeRawUnsafe(sql);
console.log("migration applied");

// Verify
const after = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('book_shares','share_clicks')`;
console.log("now existing:", after.map((t) => t.table_name));

await prisma.$disconnect();
