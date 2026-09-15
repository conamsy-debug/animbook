// Bulk rename animbook.com → animbook.com across the repo.
// Skips .git/, node_modules/, and any binary file.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
const FROM = "animbook.com";
const TO = "animbook.com";

const SKIP_DIRS = new Set([
  ".git", "node_modules", ".next", "dist", "coverage", "build",
  ".turbo", ".vercel", ".cache", "out"
]);

const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".yml", ".yaml", ".md", ".mdx",
  ".css", ".scss", ".sass",
  ".html", ".htm",
  ".env", ".txt", ".csv",
  ".gitignore", ".gitattributes", ".npmrc", ".nvmrc",
  ".caddyfile", ".conf", ".toml", ".lock", ".sh", ".ps1", ".mjs",
  ".dockerfile", ".caddyfile", ".config"
]);

const TEXT_FILES = new Set([
  "Caddyfile", "Dockerfile", "Makefile", "Procfile", "Gemfile",
  "LICENSE", "README", "CHANGELOG", "CONTRIBUTING"
]);

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

let changed = 0;
let scanned = 0;
let skippedBinary = 0;
const files = walk(ROOT);

for (const f of files) {
  scanned++;
  const ext = extname(f).toLowerCase();
  const base = f.split(/[\\/]/).pop();
  const isText = TEXT_EXTS.has(ext) || TEXT_EXTS.has("." + base) || TEXT_FILES.has(base);
  if (!isText) { skippedBinary++; continue; }

  let raw;
  try { raw = readFileSync(f, "utf8"); } catch { continue; }
  if (!raw.includes(FROM)) continue;

  const next = raw.split(FROM).join(TO);
  try {
    writeFileSync(f, next, "utf8");
    changed++;
  } catch (err) {
    console.error(`  FAIL ${f}: ${err.message}`);
  }
}

console.log(`Scanned: ${scanned} files`);
console.log(`Skipped binary: ${skippedBinary}`);
console.log(`Changed: ${changed}`);
