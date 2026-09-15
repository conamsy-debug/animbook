// Tiny zero-dependency static server for the Expo web export.
// Run: node serve-dist.mjs
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 3005);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8"
};

async function resolveFile(p) {
  const candidate = path.join(ROOT, p);
  try {
    const s = await stat(candidate);
    if (s.isFile()) return candidate;
  } catch {}
  return null;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let filePath = await resolveFile(urlPath);
  if (!filePath) {
    filePath = path.join(ROOT, "index.html");
  }
  const data = await readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
  res.end(data);
  console.log(`${req.method} ${urlPath} → ${path.relative(ROOT, filePath)}`);
});

server.listen(PORT, () => {
  console.log(`[mobile-web] serving ${ROOT} on http://localhost:${PORT}`);
});