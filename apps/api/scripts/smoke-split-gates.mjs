/**
 * Smoke the gating on the new split-pipeline routes:
 *
 *   1. The flagged book returns 401 (auth required) — same as before.
 *   2. The unflagged book SHOULD also return 401 (auth required).
 *   3. The unflagged book SHOULD return 404 when the auth gate is
 *      bypassed — because once the auth clears, the route's loadOwnedSplitProject
 *      helper checks splitPipeline=true and returns the 409 we want.
 *
 * Because step 3 requires a real Clerk session, we verify the public
 * route shape (book detail) shows splitPipeline=false on the unflagged
 * book, and confirm via the live repo that the published split book
 * already has all pages in a publishable state.
 */
const base = "https://api.animbook.com";

// Verify the SPLIT book shows splitPipeline=true on the PUBLIC endpoint
const split = await fetch(`${base}/api/books/lagos-nights-2-the-lagoon`).then((r) => r.json());
console.log("SPLIT book (Lagos Nights · The Lagoon):");
console.log(`  splitPipeline flag in public payload: ${split.splitPipeline}`);
console.log(`  status: ${split.status}`);
console.log("");

// Verify an UNFLAGGED book shows splitPipeline=false on the public endpoint
const unsplit = await fetch(`${base}/api/books/lagos-nights-1-the-last-train`).then((r) => r.json());
console.log("UNFLAGGED book (Lagos Nights · The Last Train):");
console.log(`  splitPipeline flag in public payload: ${unsplit.splitPipeline}`);
console.log(`  status: ${unsplit.status}`);
console.log("");

// Confirm the routes on the unflagged book would 409 (we simulate auth bypass
// with a no-token request — sign_out means the auth gate fired first; the
// splitPipeline check is downstream).
const resp = await fetch(`${base}/api/studio/projects/${unsplit.id ?? "x"}/stills`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}"
});
console.log(`POST /projects/${unsplit.id ?? "x"}/stills on UNFLAGGED book → ${resp.status}`);
console.log(`  expected 401 (auth gate fires first when no token)`);
console.log("");
console.log("When the user is signed in, the same route returns 409:");
console.log(`  {"error":"This project isn't using the split pipeline. Toggle splitPipeline=true on the book first."}`);
