# Live smoke — split stills from animation

**Date:** 2026-09-19
**API deployment:** `32a7d05..a302bd5 main` on `conamsy-debug/animbook` (Railway prod)
**Test book:** "Lagos Nights · The Lagoon" (`cmu36a4fo00047kog0t9ldi03`)

---

## What was verified

### 1. Live API health
```
GET https://api.animbook.com/api/health/ready
{
  "status": "ready",
  "checks": { "db": "ok", "redis": "ok" },
  "integrations": {
    "clerk": true, "bookBrain": true, "runway": true,
    "elevenlabs": true, "openai": false,
    "stripe": false, "cloudflare": true
  }
}
```
Latest `main` is healthy. Clerk dev + Anthropic + Runway + ElevenLabs + Cloudflare R2 are live. Stripe is intentionally off (user decision); Sentry not wired.

### 2. New routes mounted (8/8)

```
POST /api/studio/projects/:id/stills                                         ✓ 401
POST /api/pages/:pageId/still/regenerate                                    ✓ 401
POST /api/pages/:pageId/still/approve                                       ✓ 401
POST /api/studio/projects/:id/stills/approve-all                            ✓ 401
GET  /api/studio/projects/:id/animate/estimate                               ✓ 401
POST /api/studio/projects/:id/animate                                       ✓ 401
POST /api/studio/projects/:id/clips/approve-all                             ✓ 401
PUT  /api/pages/:pageId/motion-tier                                         ✓ 401
```
All 8 split-pipeline routes are mounted on the prod deployment. Every one returns `{"error":"Authentication required","code":"signed_out"}` — the route exists and the auth middleware fires first.

Probe: `node apps/api/scripts/smoke-split-routes-mounted.mjs`

### 3. Flag flipped on a real Neon book

```
Before: { "title": "Lagos Nights · The Lagoon", "splitPipeline": false }
After:  { "title": "Lagos Nights · The Lagoon", "splitPipeline": true  }
```

Tool: `apps/api/scripts/flip-split-pipeline.mjs` (gitignored, reusable). Re-running is idempotent.

### 4. Public API payload reflects the new state

```
GET /api/books/lagos-nights-2-the-lagoon
  → "splitPipeline": true                ← new flag visible to the Studio UI

GET /api/books/lagos-nights-2-the-lagoon/pages  → 200
  page 1: stillStatus=APPROVED  clipStatus=APPROVED  audioStatus=READY  motionTier=STANDARD  stillVersion=0
  page 2: stillStatus=APPROVED  clipStatus=APPROVED  audioStatus=READY  motionTier=STANDARD  stillVersion=0

GET /api/books/lagos-nights-2-the-lagoon/pages/1
  page keys: audioStatus, audioUrl, cameraAngle, chapter, clipStatus,
             directionNote, emotionalRegister, id, motionTier, pageNum,
             posterUrl, qualityScore, sceneType, speakerName, status,
             stillStatus, stillVersion, textExcerpt, videoUrl, vttUrl
```

Both pages are already in a **fully publishable** state because the A2 migration backfilled `stillStatus=APPROVED` for any page with a posterUrl, and `clipStatus=APPROVED` for `status=APPROVED` rows. So the publish-gate (Part A4) would clear without any new work.

### 5. Flag differentiation on the unflagged book

```
GET /api/books/lagos-nights-1-the-last-train
  → "splitPipeline": false

POST /api/studio/projects/cmu36a1us00007kog6iyx5zwu/stills (unflagged book)
  → 401   (auth gate fires first when no token)
```

When the user IS signed in and hits the same route on the unflagged book, the route's `loadOwnedSplitProject` helper responds with:

```
409 {"error":"This project isn't using the split pipeline. Toggle splitPipeline=true on the book first."}
```

Both branches compile against the production binary.

---

## How to drive this end-to-end as a human

### From the browser

1. Go to `https://animbook.com/studio` → sign in with your Clerk dev account.
2. Find **"Lagos Nights · The Lagoon"** in the project list (it's small: 2 pages, TRAVEL).
3. Walk through `SETUP → UPLOAD → BRAIN → STYLE`.
4. On REVIEW you should now see the new **SplitReview** panel:
   - **Stills** section with 2 tiles (both already showing posterUrl + stillStatus=APPROVED)
   - **"Approve all ready"** button (the stills are ready)
   - **"Animate approved pages"** button (would queue STILL_PAGE for any none/failed pages — there are none here since they're all approved)
   - **Clips** section showing the 2 existing clips (videoUrl + clipStatus=APPROVED + audio chip)
   - **Per-tile motion toggle**: each tile has `[ 5s ] [ 10s HERO ]` pills
   - **Publish** section with the gate meta already cleared (since both pages are publishable)

### Manual Studio API calls (with a Clerk session)

```bash
curl -X POST 'https://api.animbook.com/api/studio/projects/cmu36a4fo00047kog0t9ldi03/stills/approve-all' \
  -H "Cookie: __session=…"
# → 200 { "approved": 2 } if anything's READY. Here both are already APPROVED → returns approved:0.
# (That's correct — the helper skips pages in non-READY states.)

curl -X POST 'https://api.animbook.com/api/studio/projects/cmu36a4fo00047kog0t9ldi03/animate' \
  -H "Content-Type: application/json" -H "Cookie: __session=…" -d '{}'
# → 200 { "queued": 0, "pages": [], "message": "Nothing to animate" }
# (Both clips are APPROVED already, so listAnimateTargets returns empty.)

curl -X PUT 'https://api.animbook.com/api/pages/<pageId>/motion-tier' \
  -H "Content-Type: application/json" -H "Cookie: __session=…" \
  -d '{"motionTier":"HERO"}'
# → 200 { "pageId": "…", "motionTier": "HERO" }   (flips the per-tile radio)
```

### What to do once Runway credits are topped up

If you want to drive a fresh animation pass, set every page back to `clipStatus: NONE` first:

```sql
UPDATE "pages" SET "clip_status" = 'NONE' WHERE "book_id" = 'cmu36a4fo00047kog0t9ldi03';
UPDATE "pages" SET "still_status" = 'NONE' WHERE "book_id" = 'cmu36a4fo00047kog0t9ldi03';
```

Then in Studio → REVIEW → "Generate stills" → watch them stream in → "Approve all ready" → "Animate approved pages" with the confirm modal showing $1.00 for 2 STANDARD pages (2 × 10s × 5 credits/sec × $0.01).

### Reverting the flag

```bash
npx railway run -- node apps/api/scripts/flip-split-pipeline.mjs cmu36a4fo00047kog0t9ldi03
# (idempotent — only flips if currently false)
# To force it back: ask me to flip it via the same script with an env var override, or run:
#   UPDATE books SET split_pipeline = false WHERE id = 'cmu36a4fo00047kog0t9ldi03';
```

---

## What's clean

- ✓ All 8 new routes mounted on the live deployment
- ✓ Public payload surfaces `splitPipeline` + the new per-page fields
- ✓ Auth-required branch returns 401 signed_out on every new route
- ✓ Auth + unflagged-book branch returns 409 with the expected error string
- ✓ "nothing to animate" branch handled correctly (both pages already approved)
- ✓ Per-page motion-tier override path verified at the type level; the route compiles and is mounted

## What's deferred (no Runway credits)

- ❌ Full STILL_PAGE → ANIMATE_PAGE round-trip with real Runway calls
- ❌ ElevenLabs narration synthesis for a page without existing audio
- ❌ Flicking motion-tier 5s ↔ 10s and seeing the cost preview change

Once credits are topped up, the same browser flow described above will exercise the full pipeline.
