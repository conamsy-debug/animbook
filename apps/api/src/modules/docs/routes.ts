/**
 * AnimBook public API docs endpoint.
 *
 * GET /api/docs → JSON catalogue of every route the API ships.
 * GET /api/docs.json → the same, with `.json` extension for tooling.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { APP_ROUTES, totalRouteCount } from "../../appRoutes.js";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  res.json({
    service: "animbook-api",
    version: "0.11.0",
    totalRoutes: totalRouteCount(),
    moduleCount: APP_ROUTES.length,
    modules: APP_ROUTES
  });
});

router.get("/json", (_req: Request, res: Response) => {
  // Tooling-friendly variant. Same payload.
  res.json(APP_ROUTES);
});

export default router;
