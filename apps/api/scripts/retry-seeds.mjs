// Retry the 3 seeds that failed: phase2, phase3, phase6.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = path.resolve(__dirname, "..");

const RETRY = ["phase2-seed.ts", "phase3-seed.ts", "phase6-seed.ts"];

const env = { ...process.env };
env.NODE_ENV = env.NODE_ENV ?? "development";

let failed = 0;
for (const f of RETRY) {
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
console.log(`\n=== Done. Failed: ${failed}/${RETRY.length} ===`);
process.exit(failed > 0 ? 1 : 0);
