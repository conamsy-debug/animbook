// AnimBook API entry point.
//
// Boot sequence (see apps/api/railway.json for the deploy config):
//   1. bootEnv() parses + validates apps/api/.env (production loads
//      /app/apps/api/.env.production in Docker / Railway NIXPACKS).
//   2. initSentry() — no-op unless SENTRY_DSN is set.
//   3. appEnv.featureStatus() flips bookBrain / runway / elevenlabs /
//      openai / stripe / cloudflare flags based on which integration
//      keys are present. Stub fallbacks handle the rest.
//   4. mountRoutes() wires 26 modules under /api/* — single source of
//      truth in src/appRoutes.ts.
//   5. listen on $PORT (Railway injects one; we default to 4000).
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { appEnv, featureStatus } from "./config/env.js";
import { initSentry, captureException } from "./observability/sentry.js";
import books from "./modules/books/routes.js";
import library from "./modules/library/routes.js";
import studio from "./modules/studio/routes.js";
import subscriptions from "./modules/subscriptions/routes.js";
import health from "./modules/health/routes.js";
import edu from "./modules/edu/routes.js";
import achievements from "./modules/achievements/routes.js";
import faith from "./modules/faith/routes.js";
import creator from "./modules/creator/routes.js";
import publishers from "./modules/publishers/routes.js";
import offline from "./modules/offline/routes.js";
import business from "./modules/business/routes.js";
import memory from "./modules/memory/routes.js";
import oracle from "./modules/oracle/routes.js";
import live from "./modules/live/routes.js";
import translation from "./modules/translation/routes.js";
import worlds from "./modules/worlds/routes.js";
import stage from "./modules/stage/routes.js";
import signal from "./modules/signal/routes.js";
import network, { networkPublicRouter } from "./modules/network/routes.js";
import archive from "./modules/archive/routes.js";
import school from "./modules/school/routes.js";
import dream from "./modules/dream/routes.js";
import studioPro, { studioProPublicRouter } from "./modules/studio-pro/routes.js";
import legal from "./modules/legal/routes.js";
import docs from "./modules/docs/routes.js";
import { startPipelineWorker, startPipelineEvents } from "./services/pipeline.js";

// Initialise Sentry before anything else so subsequent throws are captured.
await initSentry(appEnv.SENTRY_DSN, appEnv.NODE_ENV, appEnv.RELEASE);

const app = express();

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

// CORS — WEB_ORIGIN is a comma-separated allowlist; localhost:3000 is always
// permitted so local smokes still work. When ALLOW_RAILWAY_PREVIEW=true,
// any *.up.railway.app origin is also accepted — this is for the pre-launch
// period when animbook.com DNS is still landing and the web service lives at
// its Railway preview URL (e.g. https://animbook-web-*.up.railway.app).
const ALWAYS_ALLOWED_ORIGINS = ["http://localhost:3000"];
const RAILWAY_PREVIEW_PATTERN = /^https:\/\/[a-z0-9-]+\.up\.railway\.app$/i;

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin, server-to-server, curl, mobile
  const allowList = [...appEnv.WEB_ORIGIN_LIST, ...ALWAYS_ALLOWED_ORIGINS];
  if (allowList.includes(origin)) return true;
  if (appEnv.ALLOW_RAILWAY_PREVIEW && RAILWAY_PREVIEW_PATTERN.test(origin)) return true;
  return false;
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin not allowed by CORS: ${origin ?? "<none>"}`));
      }
    },
    credentials: true
  })
);
app.use(express.json({ limit: "8mb" }));

app.get("/", (_req: Request, res: Response) => {
  res.json({ service: "animbook-api", version: "0.1.0", integrations: featureStatus });
});

app.use("/api/health", health);
app.use("/api/books", books);
app.use("/api/library", library);
app.use("/api/studio", studio);
app.use("/api/subscriptions", subscriptions);
app.use("/api/edu", edu);
app.use("/api/achievements", achievements);
app.use("/api/faith", faith);
app.use("/api/creator", creator);
app.use("/api/publishers", publishers);
app.use("/api/offline", offline);
app.use("/api/business", business);
app.use("/api/memory", memory);
app.use("/api/oracle", oracle);
app.use("/api/live", live);
app.use("/api/translation", translation);
app.use("/api/worlds", worlds);
app.use("/api/stage", stage);
app.use("/api/signal", signal);
app.use("/api/network", network);
app.use("/api/archive", archive);
app.use("/api/school", school);
app.use("/api/dream", dream);
app.use("/api/studio-pro", studioPro);
app.use("/api/studio-pro", studioProPublicRouter);
app.use("/api", legal);
app.use("/api/docs", docs);
app.use("/api", networkPublicRouter);

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "Not found", path: req.path });
});

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const status = (err as Error & { status?: number }).status ?? 500;
  console.error(`[animbook-api] unhandled error on ${req.method} ${req.path}:`, err);
  captureException(err, {
    route: req.path,
    method: req.method,
    status
  });
  if (!res.headersSent) {
    res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
  }
});

const worker = startPipelineWorker();
const events = startPipelineEvents();

const server = app.listen(appEnv.PORT, () => {
  console.log(`[animbook-api] listening on http://localhost:${appEnv.PORT}`);
  console.log(`[animbook-api] integrations: ${JSON.stringify(featureStatus)}`);
  console.log(`[animbook-api] release: ${appEnv.RELEASE}`);
});

function shutdown(signal: string) {
  console.log(`[animbook-api] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  void worker?.close();
  void events?.close();
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));