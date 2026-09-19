# Split stills from animation — Part A plan

AnimBook currently generates a still and a Runway clip together per page. The
clip is 5× more expensive than the still, so a bad still means a wasted clip
and the author can't reject a still before it gets animated.

**Split:** every page goes through `STILL_PAGE` → (author approval) →
`ANIMATE_PAGE`. Books opt in via a new `Book.splitPipeline` boolean. Old books
keep their existing single-stage pipeline exactly as it is today.

This document is the plan for Part A. See `animbook-split-brief.md` for the
full brief.

---

## 1. Files I'll touch

### Database

- `apps/api/prisma/schema.prisma`
  - `Book`: add `splitPipeline Boolean @default(false)`
  - `Page`: add
    - `stillStatus   StillStatus @default(NONE)`
    - `clipStatus    ClipStatus  @default(NONE)`
    - `audioStatus   AudioStatus @default(NONE)`
    - `stillPrompt   String?`
    - `stillVersion  Int         @default(0)`
    - `motionTier    MotionTier  @default(STANDARD)`
  - Three new enums: `StillStatus`, `ClipStatus`, `AudioStatus`, `MotionTier`.
- `apps/api/prisma/migrations/<timestamp>_split_pipeline/migration.sql`
  - Additive only. New columns, three new enums. Backfill rules per the
    brief (see section 2).

### API service code

- `apps/api/src/services/pageState.ts` (NEW)
  - Pure state-machine helpers and the `move(field, table, pageId, to)`
    compare-and-set helper that uses `WHERE … IN` so two workers can't both
    claim the same page.
- `apps/api/tests/pageState.test.mjs` (NEW)
  - Transition tables, illegal transitions throw, the WHERE IN guard, and a
    concurrent-update simulation.
- `apps/api/src/services/pipeline.ts`
  - New job name constants and processors `runStillStage` + `runAnimateStage`,
    both per-page, both behind `splitPipeline === true`. The existing
    `runVideoStage` / `animatePage` / `runAudioStage` stay exactly as they
    are for the legacy path. Add `audioStatus` writes to the audio stage
    (`READY` on success, `FAILED` on failure). Add a tiny
    `pickClipSeconds(motionTier)` (HERO=10, STANDARD=10 for Part A — Part B
    makes STANDARD 5).
- `apps/api/src/services/runway.ts`
  - Untouched. We reuse `generateStill`, `animateStill`, `mirrorToR2`.
- `apps/api/src/config/env.ts`
  - Two new env knobs: `STILL_PAGE_CONCURRENCY` (default 4) and
    `ANIMATE_PAGE_CONCURRENCY` (default 2). Both applied to dedicated
    `Worker` instances so per-page jobs run in parallel without colliding with
    the existing `pipeline` worker.
- `apps/api/src/modules/studio/routes.ts`
  - New endpoints (all auth-gated, all verify project ownership):
    - `POST /api/studio/projects/:id/stills`
    - `POST /api/pages/:pageId/still/regenerate` (optional `promptOverride`)
    - `POST /api/pages/:pageId/still/approve`
    - `POST /api/studio/projects/:id/stills/approve-all`
    - `GET  /api/studio/projects/:id/animate/estimate`
    - `POST /api/studio/projects/:id/animate` (optional `maxUsd`)
  - Modify `/publish` so for split books it fails unless every page has
    `stillStatus=APPROVED`, `clipStatus=APPROVED`, `audioStatus=READY`,
    returning the list of blocking pages.
  - Modify `/reanimate-failed` so split books route through `ANIMATE_PAGE`
    with the same `FAILED`-only filter, instead of the legacy single-stage
    job.
  - Modify `/pages/:pageId/approve` so split books move `clipStatus` and
    keep the legacy `status` column in sync.
  - New bulk "approve all ready clips" endpoint
    (`POST /api/studio/projects/:id/clips/approve-all`) since one doesn't
    exist.
- `apps/api/src/modules/books/routes.ts`
  - `GET /:id/pages` and `GET /:id/pages/:num` add the new fields to their
    Prisma `select` so the reader (and the Studio grid) can render them.
    Existing readers ignore unknown fields, so no shape change.
- `apps/api/src/studio/events.ts`
  - Already supports per-event `payload: Record<string, unknown>`; the new
    `STILL_PAGE` / `ANIMATE_PAGE` SSE events will use it to carry
    `{ pageId, status }`.

### Web UI

- `apps/web/src/pages/studio.tsx`
  - In REVIEW, when `project.book.splitPipeline === true`:
    1. `Generate stills` button (calls `POST /stills`) → grid of still tiles
       with status chips + Approve / Regenerate / Edit-prompt-and-regenerate /
       `Approve all ready`.
    2. Once stills are approved, `Animate approved pages` button — first
       calls `/animate/estimate`, shows the confirm modal, then submits
       `/animate`.
    3. After animation: per-tile clip status, existing per-page
       `Re-animate`, plus the existing bulk `Re-animate N failed`.
    4. Buttons disabled per the API rejection cases.
  - The legacy flow stays for `splitPipeline === false`.

### Tests

- `apps/api/tests/pageState.test.mjs` — pure state machine.
- `apps/api/tests/clipSeconds.test.mjs` — `pickClipSeconds(motionTier)` →
  10s for both tiers in Part A (Part B changes STANDARD to 5).
- `apps/api/tests/splitPipeline.test.mjs` — STILL_PAGE + ANIMATE_PAGE
  worker tests with mocked Runway, ElevenLabs, R2:
  - STILL_PAGE: still → R2 → status=READY.
  - STILL_PAGE: throw → FAILED on last attempt only; rethrow.
  - ANIMATE_PAGE: stillStatus !== APPROVED → clipStatus=STALE, no Runway
    call (assert no body sent to Runway).
  - ANIMATE_PAGE: stillStatus === APPROVED → GENERATING → READY.
  - ANIMATE_PAGE: throw on first attempt, succeed on retry → READY
    (no illegal transition).
  - ANIMATE_PAGE: throw on every attempt → FAILED on last attempt.
  - STALE clip re-animation: still re-uploaded → clip → QUEUED, not STALE.
  - audioStatus: success → READY; failure → FAILED.
- `apps/api/tests/studioSplitRoutes.test.mjs` — express supertest-style
  with a mocked queue + Prisma:
  - ownership checks (caller does not own the project → 404).
  - each rejection case (clip QUEUED/GENERATING on regenerate; estimate
    exceeds maxUsd; approve when status is wrong).
  - publish gate (missing stillStatus/clipStatus/audioStatus returns the
    blocking page list).
  - bulk approve-all routes.

## 2. Database migration

Additive. Three new enums, four new columns on `pages`, one new column on
`books`. Defaults let existing rows work unchanged.

Backfill for existing rows:

```sql
-- A row has a still when posterUrl is set
UPDATE pages SET still_status = 'APPROVED'
WHERE poster_url IS NOT NULL AND still_status = 'NONE';

-- Legacy status -> clipStatus (only for non-split books; covered by the
-- guard in the route, but we set sensible defaults so dumps are tidy)
UPDATE pages SET clip_status = 'APPROVED' WHERE status = 'APPROVED';
UPDATE pages SET clip_status = 'FLAGGED'  WHERE status = 'FLAGGED';
UPDATE pages SET clip_status = 'READY'    WHERE status = 'PENDING';
UPDATE pages SET clip_status = 'QUEUED'   WHERE status = 'REGENERATING';

-- A row has narration audio when audioUrl is set
UPDATE pages SET audio_status = 'READY' WHERE audio_url IS NOT NULL;
```

Notes:

- `stillVersion` defaults to 0. We never decrement.
- `motionTier` defaults to `STANDARD`. Part B adds the Brain-derived field
  and the per-page override; Part A only sets the schema and respects the
  default in `pickClipSeconds`.
- The brief says the new behaviour is gated on `splitPipeline`. We will NOT
  backfill `splitPipeline=true` automatically — the user flips it on for one
  book manually (per the brief).

## 3. Things in the brief that don't quite fit the real code

- **Per-page parallel workers.** The current pipeline uses a single Bull
  worker (`animbook-pipeline`) with `Promise.all` over pages inside one
  processor. The brief asks for *Bull jobs per page* so pages run in
  parallel without blocking one another. We'll add a second queue
  (`animbook-split-pipeline`) with two named workers (`STILL_PAGE`,
  `ANIMATE_PAGE`). The legacy worker is untouched.
- **`jobId` includes `stillVersion`.** Bull jobIds must be unique; we use
  `still:<pageId>:v<stillVersion>` and `animate:<pageId>:v<stillVersion>`.
  A second click with the same version is a no-op (Bull rejects duplicate
  jobIds); a regeneration increments `stillVersion` so the new attempt
  goes through.
- **`setTimeout` retries not in the estimate.** The estimate counts
  `seconds × 5 credits × $0.01` and explicitly excludes retries. With
  `attempts: 2` and exponential backoff, retries are a rare Runway rate-limit
  blip, not a budget concern — leave them out of the cost preview.
- **Concurrency defaults.** 4 stills and 2 animations feels right for
  Runway's rate limit. Make them env-driven so we can tune without a
  deploy.
- **Clip length.** The brief Part A says "10 seconds for every page" and
  asks us to put it behind `pickClipSeconds` so Part B can change it. We do
  exactly that — both tiers return 10s in Part A.
- **"Re-animate N failed" already exists.** Brief 3.4 says "Make the
  existing Re-animate N failed route use the same function, restricted to
  FAILED." The existing `/reanimate-failed` route is FAILED-only already;
  we just route it to `ANIMATE_PAGE` (instead of legacy `VIDEO_GENERATION`)
  when `splitPipeline` is on. The web button stays where it is.
- **Clip status ↔ legacy status sync.** When a clip moves
  `READY → APPROVED` on a split book, we also set legacy
  `status = APPROVED` so existing reader/Studio code paths that still read
  `Page.status` keep working. Same for `READY → FLAGGED` etc.

## 4. Order of work

1. A2 (migration + state helpers + transition tests) — **stops at Checkpoint 1**.
2. A3 (STILL_PAGE / ANIMATE_PAGE / audioStatus) — needs A2 schema.
3. A4 (API routes + publish gate).
4. A5 (Studio UI).
5. A6 (typecheck, lint, build, tests, push, final report).

Each step is one commit. Push only happens at the end of A6 if everything
is green.

## 5. What I'll explicitly NOT do (yet)

- No changes to the reader playback loop (Part B).
- No Brain analysis changes (Part B).
- No new npm dependencies.
- No refactor of the legacy `runVideoStage` path.
- No per-book cost-history table — the estimate is recomputed on demand.