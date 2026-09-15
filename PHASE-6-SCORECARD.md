# AnimBook · Phase 6 Scorecard

**Date:** 2026-07-25
**Scope:** Ship the last 2 of 14 next-gen features, run the full 8-suite smoke.

---

## Next-gen features — 14 / 14 ✅

| # | Feature | Phase | Status | Endpoints |
|---|---|---|---|---|
| 1 | MEMORY (adaptive profile) | 3 | ✅ | 3 |
| 2 | ORACLE (branching) | 3 | ✅ | 2 |
| 3 | LENS (first-person UI) | 3 | ✅ | rides on memory |
| 4 | ECHO (haptics via Vibration API) | 3 | ✅ | rides on memory |
| 5 | LIVE TRANSLATION (tap-word) | 3 | ✅ | 2 |
| 6 | LIVE (SSE reading rooms) | 3 | ✅ | 4 |
| 7 | DREAM (WELLNESS sleep-mode) | **6** | ✅ | 6 |
| 8 | WORLDS (Lagos Nights trilogy) | 4 | ✅ | 2 |
| 9 | STAGE (collaborative rounds) | 4 | ✅ | 5 |
| 10 | SIGNAL (page-dwell analytics) | 4 | ✅ | 2 |
| 11 | NETWORK (API keys + `/whoami`) | 4 | ✅ | 5 |
| 12 | ARCHIVE (oral history + cultural notes) | 5 | ✅ | 5 |
| 13 | SCHOOL (classrooms + assignments) | 5 | ✅ | 6 |
| 14 | STUDIO PRO (AR/NFC companion) | **6** | ✅ | 9 |

---

## Phase 6 — what shipped

### AnimBook DREAM
- `DreamSession` Prisma model (`dream_sessions`) — `user_id`, `book_id`, `ambient_track`, `pages_read`, `started_at`, `ended_at`, `fell_asleep_at`, `exit_reason`
- `services/dream.ts` — `dreamProfileForBook()` returns a pure-function profile (palette `cool`, pacing `leisurely`, narration 0.7×, font 22, motion 0.4, flip spring 880ms, dim screen, ambient track) when the book is WELLNESS
- `modules/dream/routes.ts` — 6 endpoints:
  - `GET  /api/dream/ambient` — ambient track library
  - `GET  /api/dream/profile/:bookId` — pick up the auto-pacing profile
  - `POST /api/dream/sessions` — open a session (409 if non-WELLNESS)
  - `PUT  /api/dream/sessions/:id` — log page progress
  - `POST /api/dream/sessions/:id/end` — close the session, mark `fellAsleep`
  - `GET  /api/dream/sessions` — recent sessions
- Reader auto-detects WELLNESS, calls the profile endpoint, opens a session, applies the soft palette / slow narration / dimmed backdrop, pushes page progress every 4 flips, and closes the session on unmount via `navigator.sendBeacon`
- New `/dream` page — drift log, ambient library, "how it works"

### AnimBook STUDIO PRO
- `CompanionLink` + `CompanionSession` Prisma models — `marker_hash`, `nfc_tag_id`, `experience_mode`, `anchor_page`, `trigger_mode`, `page_reached`
- `services/studioPro.ts` — deterministic marker (sha256 namespace + bookId) + NDEF-shaped NFC tag id (`AB-XXXX-XXXX-XXXX-XX`); idempotent `ensureCompanionLink()`
- `modules/studio-pro/routes.ts` — 9 endpoints:
  - `POST /api/studio-pro/companion/:bookId` — mint or fetch link
  - `GET  /api/studio-pro/companion/:bookId` — read the link
  - `POST /api/studio-pro/companion/:bookId/page` — pin anchor page
  - `GET  /api/studio-pro/companion/:bookId/analytics` — reach summary
  - `POST /api/studio-pro/sessions` — log a session (AR / NFC / manual)
  - `GET  /api/studio-pro/scan/marker/:marker` — public marker resolver
  - `GET  /api/studio-pro/scan/nfc/:tagId` — public NFC resolver
- `phase6-seed.ts` minted companion links for all 11 published books + a sample dream + companion session
- New `/companion` page — book picker, anchor pin, AR marker tile, NFC tag, AR overlay preview, manual resolvers, Web NFC scan when available

---

## Verification

### Smoke suites — 98 / 98 ✅

| Suite | Endpoints | Result |
|---|---|---|
| `smoke-phase1.mjs` | 16 | **16/16** ✅ |
| `smoke-edu.mjs` | 9 | **9/9** ✅ |
| `smoke-kids.mjs` | 8 | **8/8** ✅ |
| `smoke-phase2.mjs` | 13 | **13/13** ✅ |
| `smoke-phase3.mjs` | 12 | **12/12** ✅ |
| `smoke-phase4.mjs` | 14 | **14/14** ✅ |
| `smoke-phase5.mjs` | 11 | **11/11** ✅ |
| `smoke-phase6.mjs` | 15 | **15/15** ✅ |
| **Total** | **98** | **98/98 ✅** |

### Web build
- `npx next build` — 23 pages compile (added `/dream` and `/companion`)
- All 15 user-facing routes serve 200 on `http://localhost:3000`
- TS clean on `@animbook/web` and `@animbook/api`

---

## Inventory at close-out

- **AnimBooks seeded:** 11 (Night Train · Coast of Mombasa · Poem for Lagos · Peter Rabbit · Mitosis · First 90 Days · Sleeping Coast · Lagos Nights 1/2/3 · Lord's Prayer)
- **Verticals surfaced:** 11 / 12 (DOCS pending)
- **Migrations applied:** 9 (init → phase6)
- **API modules:** 24 (added `dream`, `studio-pro`)
- **Phase-6 seed:** 11 companion links + 1 dream session + 1 companion session

---

## Status

**AnimBook next-gen: 14 of 14 shipped.**
The platform is feature-complete against the original 30-item + 14-next-gen brief.
Ready for the next conversation: real-API keys, mobile/TV shells, polish, or production hardening.
