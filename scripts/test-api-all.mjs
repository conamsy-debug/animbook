import { spawnSync } from "node:child_process";
import fs from "node:fs";

const r = spawnSync(
  "node",
  ["--test", "tests/dream.test.mjs", "tests/rateLimit.test.mjs", "tests/studioPro.test.mjs", "tests/accountStanding.test.mjs", "tests/releaseSchedule.test.mjs", "tests/manuscriptExtract.test.mjs"],
  {
    cwd: "C:/Users/msi 22/.minimax/workspace/animbook/apps/api",
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 600_000,
  },
);

const out = (r.stdout ?? "") + "\n--- stderr ---\n" + (r.stderr ?? "");
fs.writeFileSync("C:/Users/msi 22/.minimax/workspace/animbook/api-tests-all-now.log", out, "utf8");

console.log("exit:", r.status);
console.log(out.split(/\r?\n/).filter(l => /tests|pass|fail|✔|✗|Error/i.test(l)).join("\n"));
