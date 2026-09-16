// AnimBook — shell supervisor.
//
// Spawns and supervises the four local services (API · Web · Mobile shell
// · TV shell) and restarts any that die. A single long-lived process
// replaces the manual 30-min-restart cycle.
//
// Usage:   node scripts/watch-shells.mjs
// Status:  GET /api/supervisor/status → JSON snapshot of child state.
// Stop:    Ctrl-C twice (or send SIGTERM).
//
// Why this exists
// ---------------
// The IDE/sandbox that this repo lives in caps every shell task at 30
// minutes. Without a supervisor, every session ends with four dead
// services. With one, restarting is a single command and the children
// come back inside ~3s each.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

/**
 * Service definitions. Order matters — API first so web/mobile/tv can
 * rely on its /api/health/ready probe before they fully boot.
 *
 * The supervisor reads the same `apps/api/.env` that the API reads.
 * No port / host knobs in two places.
 */
const SERVICES = [
  {
    id: "api",
    name: "API",
    cwd: path.join(ROOT, "apps", "api"),
    // Run from compiled `dist/index.js` — the API no longer uses tsx at
    // runtime (see AGENTS.md "Operating invariant #12"). Faster boot, no
    // esbuild resolution at startup. apps/api/tsconfig.json sets
    // rootDir: "src" so the output is a flat dist/ tree (no src/ prefix).
    cmd: "node dist/index.js",
    env: process.env, // .env already loaded by the API itself
    port: Number(process.env.PORT ?? 4000),
    healthcheck: { path: "/api/health/ready", timeoutMs: 4_000, intervalMs: 5_000 }
  },
  {
    id: "web",
    name: "Web",
    cwd: path.join(ROOT, "apps", "web"),
    cmd: "npx next start -p 3000",
    env: { ...process.env, NEXT_PUBLIC_API_URL: `http://localhost:${process.env.PORT ?? 4000}` },
    port: 3000,
    healthcheck: { path: "/", timeoutMs: 4_000, intervalMs: 5_000 }
  },
  {
    id: "mobile",
    name: "Mobile shell",
    cwd: path.join(ROOT, "apps", "mobile"),
    cmd: "node serve-dist.mjs",
    env: { ...process.env, PORT: "3005" },
    port: 3005,
    healthcheck: { path: "/healthz", timeoutMs: 4_000, intervalMs: 5_000 }
  },
  {
    id: "tv",
    name: "Apple TV shell",
    cwd: path.join(ROOT, "apps", "tv"),
    cmd: "node serve-dist.mjs",
    env: { ...process.env, PORT: "3006" },
    port: 3006,
    healthcheck: { path: "/healthz", timeoutMs: 4_000, intervalMs: 5_000 }
  }
];

/**
 * Child registry.
 * Each child keeps: process, lastBootAt, lastHealthyAt, restartCount,
 * consecutiveFailCount, lastExitCode, lastCrashAt.
 */
const children = new Map();
let stopping = false;
let stopCount = 0;

function startService(svc) {
  if (stopping) return;
  if (children.has(svc.id) && !children.get(svc.id).exited) {
    return; // already running
  }
  const now = Date.now();
  console.log(`[supervisor] starting ${svc.name} on port ${svc.port}`);
  const child = spawn(svc.cmd, {
    cwd: svc.cwd,
    env: svc.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    windowsHide: true,
    // Don't run on the parent's lifecycle: keep the child independent
    // of any shutdown signals we send during restart loops.
    detached: false
  });
  const state = {
    child,
    id: svc.id,
    name: svc.name,
    port: svc.port,
    lastBootAt: now,
    lastHealthyAt: 0,
    lastCheckedAt: 0,
    consecutiveFailCount: 0,
    restartCount: (children.get(svc.id)?.restartCount ?? 0) + 1,
    lastExitCode: null,
    lastCrashAt: 0,
    exited: false
  };
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[${svc.id}] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[${svc.id}] ${chunk}`);
  });
  child.on("exit", (code, signal) => {
    state.exited = true;
    state.lastExitCode = code;
    if (stopping) {
      console.log(`[supervisor] ${svc.name} stopped (code ${code})`);
      return;
    }
    // Crash-loop guard: if a service died in <3s, exponential backoff.
    const uptimeMs = Date.now() - state.lastBootAt;
    if (uptimeMs < 3000) {
      state.consecutiveFailCount += 1;
      state.lastCrashAt = Date.now();
      const backoff = Math.min(15000, 1000 * Math.pow(2, Math.min(5, state.consecutiveFailCount)));
      console.log(`[supervisor] ${svc.name} crashed after ${uptimeMs}ms; restart in ${backoff}ms (fail #${state.consecutiveFailCount})`);
      setTimeout(() => startService(svc), backoff).unref();
      return;
    }
    state.consecutiveFailCount = 0;
    console.log(`[supervisor] ${svc.name} exited after ${Math.round(uptimeMs / 1000)}s (code ${code}, signal ${signal}); restarting now`);
    setTimeout(() => startService(svc), 200).unref();
  });
  children.set(svc.id, state);
}

/**
 * Healthcheck loop — runs in the background. Independent of the
 * 30-min ceiling because the supervisor itself is the long-lived
 * process. If a port stops responding for 30s across 6 attempts,
 * kill the child and let the exit handler restart it.
 */
const SVC_BY_ID = new Map(SERVICES.map((s) => [s.id, s]));
async function checkHealth(svc, state) {
  return new Promise((resolve) => {
    const url = `http://localhost:${svc.port}${svc.healthcheck.path}`;
    const req = http.get(url, { timeout: svc.healthcheck.timeoutMs }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode && res.statusCode < 500));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve(false));
    req.setTimeout(svc.healthcheck.timeoutMs, () => req.destroy(new Error("timeout")));
  });
}

setInterval(() => {
  if (stopping) return;
  for (const svc of SERVICES) {
    const state = children.get(svc.id);
    if (!state || state.exited) continue;
    checkHealth(svc, state).then((ok) => {
      state.lastCheckedAt = Date.now();
      if (ok) {
        state.lastHealthyAt = Date.now();
        state.consecutiveFailCount = 0;
      } else {
        state.consecutiveFailCount += 1;
        if (state.consecutiveFailCount >= 6) {
          console.log(`[supervisor] ${svc.name} unresponsive for ${state.consecutiveFailCount} checks — killing`);
          try { state.child.kill("SIGTERM"); } catch {}
          // The exit handler will restart it.
        }
      }
    });
  }
}, 5000).unref?.();

/**
 * Status server — exposes supervisor introspection on /api/supervisor/status
 * and a simple /api/supervisor/quit to shut it all down. Useful for smoke
 * tests and human diagnosis.
 */
const STATUS_PORT = Number(process.env.SUPERVISOR_PORT ?? 4099);
http
  .createServer((req, res) => {
    if (req.url === "/api/supervisor/status" || req.url?.startsWith("/api/supervisor/status?")) {
      const out = Array.from(children.values()).map((s) => ({
        id: s.id,
        name: s.name,
        port: s.port,
        running: !s.exited,
        pid: s.child?.pid ?? null,
        uptimeSeconds: s.lastBootAt ? Math.round((Date.now() - s.lastBootAt) / 1000) : 0,
        restartCount: s.restartCount,
        consecutiveFailCount: s.consecutiveFailCount,
        lastHealthyAt: s.lastHealthyAt || null,
        lastCheckedAt: s.lastCheckedAt || null,
        lastExitCode: s.lastExitCode
      }));
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 200;
      res.end(JSON.stringify({ supervisor: "animbook-watch-shells", services: out, ts: new Date().toISOString() }, null, 2));
    } else if (req.url === "/api/supervisor/quit") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, message: "shutting down" }));
      shutdown();
    } else {
      res.statusCode = 404;
      res.end("not found");
    }
  })
  .listen(STATUS_PORT, () => {
    console.log(`[supervisor] status endpoint on http://localhost:${STATUS_PORT}/api/supervisor/status`);
  });

function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  console.log(`[supervisor] shutting down ${children.size} children${reason ? ` (${reason})` : ""}…`);
  for (const state of children.values()) {
    try { state.child.kill("SIGTERM"); } catch {}
  }
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => {
  stopCount += 1;
  if (stopCount >= 2) shutdown("double Ctrl-C");
  else console.log("[supervisor] press Ctrl-C again to force shutdown");
});
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log("[supervisor] booting 4 services");
for (const svc of SERVICES) startService(svc);
console.log("[supervisor] watching — Ctrl-C twice to stop");
