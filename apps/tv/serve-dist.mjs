// Tiny zero-dependency static server for the Apple TV shell.
// Run: node serve-dist.mjs
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 3006);
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
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let filePath = path.join(ROOT, urlPath);
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
    res.end(data);
  } catch {
    // SPA fallback
    const data = await readFile(path.join(ROOT, "index.html"));
    res.setHeader("Content-Type", MIME[".html"]);
    res.end(data);
  }
  console.log(`${req.method} ${urlPath}`);
});

server.listen(PORT, () => {
  console.log(`[tv-web] serving ${ROOT} on http://localhost:${PORT}`);
});