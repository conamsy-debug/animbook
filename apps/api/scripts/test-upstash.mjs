// Test Upstash Redis (TLS) connectivity.
import Redis from "ioredis";

const url = process.env.REDIS_URL;
if (!url) { console.error("REDIS_URL not set"); process.exit(1); }

console.log("URL host:", new URL(url).host, "scheme:", new URL(url).protocol);

const r = new Redis(url, {
  tls: { rejectUnauthorized: false },
  connectTimeout: 10000,
  maxRetriesPerRequest: 1,
  lazyConnect: true
});

try {
  await r.connect();
  console.log("Connected.");
  await r.set("animbook:smoke:upstash", "ok", "EX", 60);
  const got = await r.get("animbook:smoke:upstash");
  console.log("Round-trip GET:", got);
  await r.del("animbook:smoke:upstash");
  console.log("DEL ok.");
  const info = await r.info("server");
  const version = info.split("\n").find(l => l.startsWith("redis_version"));
  console.log("Server:", version?.trim());
  await r.quit();
  console.log("\nUPSTASH OK");
} catch (err) {
  console.error("UPSTASH FAIL:", err.message);
  process.exit(1);
}
