/**
 * Smoke the split-pipeline route surface mounted on the live API.
 *
 * We expect 401 (auth required) for every protected route, and 404 (not
 * found) only when the path is wrong. The split-routes file (apps/api/
 * src/modules/studio/splitRoutes.ts) should have mounted all eight.
 */
const baseUrl = "https://api.animbook.com";

const ROUTES = [
  // Stills
  { method: "POST", path: "/api/studio/projects/test/stills" },
  { method: "POST", path: "/api/pages/test/still/regenerate" },
  { method: "POST", path: "/api/pages/test/still/approve" },
  { method: "POST", path: "/api/studio/projects/test/stills/approve-all" },
  // Animation
  { method: "GET", path: "/api/studio/projects/test/animate/estimate" },
  { method: "POST", path: "/api/studio/projects/test/animate" },
  { method: "POST", path: "/api/studio/projects/test/clips/approve-all" },
  // Motion tier
  { method: "PUT", path: "/api/pages/test/motion-tier" },
];

const results = [];
for (const route of ROUTES) {
  try {
    const res = await fetch(`${baseUrl}${route.path}`, {
      method: route.method,
      headers: { "Content-Type": "application/json", Cookie: "_dummy=bypass" },
      body: route.method === "POST" || route.method === "PUT" ? "{}" : undefined
    });
    const body = await res.text();
    results.push({
      route: `${route.method} ${route.path}`,
      status: res.status,
      // Check for the route-shape rather than the literal 401: not-found would
      // be plain text 404, auth-required would be {"error":...}.
      shape: body.startsWith("{") ? "json" : "text",
      body: body.slice(0, 120)
    });
  } catch (err) {
    results.push({ route: `${route.method} ${route.path}`, error: String(err) });
  }
}

// Pretty print
console.log(JSON.stringify(results, null, 2));

// Assertion helper: every result must be 401 with JSON body (route exists).
const failures = results.filter(
  (r) => r.status !== 401 || r.shape !== "json"
);
if (failures.length > 0) {
  console.error(`\n${failures.length} route(s) failed the mount check:`);
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log("\nALL 8 ROUTES MOUNTED ✓");
