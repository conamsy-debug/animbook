/**
 * R2 bucket CORS manager for the `animbook-media` bucket (media.animbook.com).
 *
 * R2 does NOT expose bucket CORS through the S3 API — it is a Cloudflare
 * account-level setting:
 *   GET/PUT https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/{bucket}/cors
 * Authenticated with the Cloudflare API token (CLOUDFLARE_API_TOKEN), not the
 * R2 access key.
 *
 * Usage:
 *   node apps/api/scripts/r2-cors.mjs show
 *   node apps/api/scripts/r2-cors.mjs set
 *
 * Why this exists: the reader's next-page prefetch uses
 * `<link rel="preload" as="video/audio" crossorigin="anonymous">`. A
 * crossorigin preload is a CORS request, and without an
 * `Access-Control-Allow-Origin` on the media objects the preload fails
 * with `net::ERR_FAILED` — so the browser silently refuses to warm the
 * next page's clip. The objects themselves are publicly readable, so
 * allowing GET/HEAD from our own origins costs nothing and fixes the
 * prefetch.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function loadEnv(p) {
  const out = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

const env = { ...loadEnv(fileURLToPath(new URL("../.env", import.meta.url))) };

// A shell-provided token wins over the .env one, so the operator can run
// this with a fresh token without editing a file.
if (process.env.CLOUDFLARE_API_TOKEN) env.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const ACCOUNT = env.CLOUDFLARE_ACCOUNT_ID;
const BUCKET = env.CLOUDFLARE_R2_BUCKET;
const TOKEN = env.CLOUDFLARE_API_TOKEN;

if (!ACCOUNT || !BUCKET || !TOKEN) {
  console.error("Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_R2_BUCKET / CLOUDFLARE_API_TOKEN");
  process.exit(1);
}

const CORS_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/cors`;

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json"
};

/** The CORS policy we want on the bucket. */
const POLICY = {
  rules: [
    {
      allowed: {
        origins: ["https://animbook.com", "https://www.animbook.com"],
        methods: ["GET", "HEAD"],
        headers: ["*"]
      },
      // The reader needs these to read a ranged response and to know the
      // real size of the body it is downloading.
      expose_headers: [
        "Accept-Ranges",
        "Cache-Control",
        "Content-Length",
        "Content-Range",
        "Content-Type",
        "ETag",
        "Last-Modified"
      ],
      max_age_seconds: 86400
    }
  ]
};

const mode = process.argv[2] ?? "show";

async function show() {
  const res = await fetch(CORS_URL, { headers });
  const body = await res.json().catch(() => null);
  console.log(`GET ${CORS_URL.replace(ACCOUNT, "<account>")} -> ${res.status}`);
  console.log(JSON.stringify(body, null, 2));
  if (!body?.success) {
    console.error("Cloudflare API returned an error envelope.");
    process.exit(1);
  }
}

async function set() {
  const res = await fetch(CORS_URL, { method: "PUT", headers, body: JSON.stringify(POLICY) });
  const body = await res.json().catch(() => null);
  console.log(`PUT -> ${res.status}`);
  console.log(JSON.stringify(body, null, 2));
  if (!body?.success) {
    console.error("Cloudflare API rejected the CORS policy.");
    process.exit(1);
  }
  console.log("\nCORS policy applied. Verifying with a real GET…");
  await verify();
}

async function verify() {
  // NOTE: CLOUDFLARE_CDN_BASE in .env says https://media.animbook.app - that
  // host does not resolve. The real custom domain is media.animbook.com.
  const base = "https://media.animbook.com";
  // A real object from the bucket (the seed book's page-1 clip).
  const probe = `${base}/books/lagos-nights-2-the-lagoon/p1-mu4vrigb.mp4`;
  for (const origin of ["https://animbook.com", "https://www.animbook.com", "https://evil.example"]) {
    const res = await fetch(probe, { method: "GET", headers: { Origin: origin, Range: "bytes=0-99" } });
    console.log(
      `  Origin: ${origin.padEnd(28)} -> ${res.status} ` +
        `ACAO="${res.headers.get("access-control-allow-origin") ?? "(none)"}" ` +
        `ACAM="${res.headers.get("access-control-allow-methods") ?? "(none)"}"`
    );
  }
}

if (mode === "show") await show();
else if (mode === "set") await set();
else if (mode === "verify") await verify();
else {
  console.error("Usage: node apps/api/scripts/r2-cors.mjs show|set|verify");
  process.exit(1);
}