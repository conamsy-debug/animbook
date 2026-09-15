// Run all seed scripts against Neon in dependency order.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = path.resolve(__dirname, "..");

const ORDER = [
  "seed.ts",          // Phase 1 — 3 books
  "phase2-seed.ts",   // EDU · KIDS · FAITH
  "phase3-seed.ts",   // Next-gen
  "phase4-seed.ts",   // Worlds / Stage / Signal / Network
  "phase5-seed.ts",   // Archive + School
  "phase6-seed.ts",   // Dream + Studio Pro
  "phase11-seed.ts",  // 19 more + 3 translation packs
  "edu-seed.ts",      // EDU additions
  "kids-seed.ts"      // KIDS additions
];

const env = { ...process.env };
if (!env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
env.NODE_ENV = env.NODE_ENV ?? "development";

let failed = 0;
for (const f of ORDER) {
  const full = path.join(API, "prisma", f);
  console.log(`\n=== ${f} ===`);
  const start = Date.now();
  await new Promise((resolve) => {
    const child = spawn("cmd.exe", ["/c", `npx tsx prisma/${f}`], {
      cwd: API,
      env,
      stdio: "inherit",
      windowsHide: true
    });
    child.on("exit", (code) => {
      const ms = Date.now() - start;
      if (code === 0) console.log(`[OK] ${f} (${ms}ms)`);
      else { console.error(`[FAIL ${code}] ${f}`); failed++; }
      resolve();
    });
  });
}

console.log(`\n=== Done. Failed: ${failed}/${ORDER.length} ===`);
process.exit(failed > 0 ? 1 : 0);
