# AnimBook next-gen features on the homepage: brief for MiniMax (frontend only)

## 0. How to work

Read this whole file first, then read the codebase before changing anything.

- **Presentation only.** Do not change the API, Prisma schema, migrations, queue, environment variables or response shapes. No new endpoints. Use only data and endpoints the app already has.
- Every other page keeps its current look. Scope new styles to the homepage unless this brief says otherwise.
- No new dependencies unless you ask me first. Use CSS and the framework already in the project.
- **Reuse the homepage redesign system.** The new homepage (commit `810eeb6`) ships tokens under `.home-page`, the cinematic nav variant, the HomeHero / LivingCard / BeforeAfter / VerticalSection pieces. Reuse them. Do not duplicate.
- **Reuse the library redesign system.** Same tokens, fonts, icons, generated-cover component, and row pattern. Do not duplicate.
- If `git status` shows uncommitted changes from another task, don't overwrite them: tell me and work around them.
- Work through the steps in section 8. Commit locally after each step with a clear message.
- **Do not push to main.** When you finish, run the web app locally, tell me the exact command and URL, and wait for my review. Every push rebuilds all three Railway services and my credit is limited.
- Never print API keys or other secret values.
- If something in this brief conflicts with the real code, choose the option that changes the least and say so in the final report.

## 1. What we're changing

The current homepage has no mention of the 14 next-gen features we shipped. A visitor lands, sees the hero + BeforeAfter + 12 verticals, and never learns that ORACLE exists, that LIVE is a real-time shared-reading experience, that MEMORY adapts the reader to their pace, that WORLDS ties character universes across books, that DREAM is a sleep-mode for WELLNESS, or that STUDIO PRO turns phones into AR/NFC companion surfaces.

We will add two new sections between the existing VerticalSection and the footer:

1. **ORACLE marquee** — a full-width cinematic section that puts ORACLE front and center. Verse-paper palette, a single tall "page" with a pulsing "Ask the Oracle" button, and three continuation cards that fan in below it. Static mock data (no API call). The marquee should feel different from the rest of the page — warmer, slower, more deliberate.
2. **Constellation strip** — a horizontal scroll of the other 13 next-gen features as compact tiles (Memory, Lens, Echo, Live Translation, Live, Dream, Worlds, Stage, Signal, Network, Archive, School, Studio Pro). Each tile: a small visual preview + name + one-line tagline + → /feature. Reuses the LibraryRow pattern (scroll-snap, hidden scrollbar, scroll arrows).

**Why ORACLE first.** ORACLE is the most novel feature in the product — a branching book that lets the reader choose their own path. No competitor does this. Putting ORACLE front-and-center turns the homepage from "we have a lot of features" into "AnimBook reads you back". The constellation below it shows breadth without diluting the ORACLE moment.

## 2. Data and assets (no backend work)

The 14 features, with one-line taglines and existing routes:

| # | Feature | Tagline | Existing route |
|---|---|---|---|
| 1 | **ORACLE** | Choose the path. We write the next page. | (verse reader overlay) |
| 2 | **MEMORY** | The book learns your pace. | `/memory` |
| 3 | **LENS** | First-person reading, just for you. | rides on Memory |
| 4 | **ECHO** | A quiet vibration on every turn. | rides on Memory |
| 5 | **LIVE TRANSLATION** | Tap any word. See its tongue. | (reader popover) |
| 6 | **LIVE** | Read together. Real-time, room-by-room. | `/live` |
| 7 | **DREAM** | A slower AnimBook for tired eyes. | `/dream` |
| 8 | **WORLDS** | Character universes across books. | `/worlds` |
| 9 | **STAGE** | Pass the page, one round at a time. | `/worlds` |
| 10 | **SIGNAL** | See where readers linger. | `/signal` |
| 11 | **NETWORK** | AnimBook as an API, with keys. | `/network` |
| 12 | **ARCHIVE** | Oral history with consent + cultural notes. | `/archive` |
| 13 | **SCHOOL** | Classrooms, assignments, dashboards. | `/school` |
| 14 | **STUDIO PRO** | Point a phone. Open the book. | `/companion` |

ORACLE gets its own marquee; the other 13 go in the constellation strip.

**Mock data for ORACLE.** Hard-code a single verse scene (no `/api/oracle/...` call). The "page" shows 2-3 lines of verse in the existing paper-palette. Below it, three continuation cards with hand-written copy:

- Choice A — "The lantern-lighter turns, and sees you."
- Choice B — "You step through the doorway. The market roars."
- Choice C — "You write a letter. It goes unanswered."

One card is "selected" by default (visual hint, not interactive). Hover or focus of the marquee briefly shows all three.

**Mock data for the constellation tiles.** Each tile carries:
- a name (sentence case)
- a one-line tagline (sentence case, 8-14 words)
- a route (existing)
- a small visual — a 1px-frame preview tile with the vertical's accent color, a single representative glyph (see §4.3)

Taglines live in a single `NEXTGEN_FEATURES` constant in `apps/web/src/lib/nextgen/features.ts`. No new endpoints.

## 3. Design tokens

Reuse the existing `.home-page` tokens. Add only what's missing:

| Token | Value | Use |
| --- | --- | --- |
| `--home-oracle-paper` | #F1E6CE | ORACLE marquee paper background (warm, slightly darker than the BeforeAfter paper) |
| `--home-oracle-paper-text` | #2A221A | ORACLE verse text |
| `--home-oracle-paper-rule` | #9D4C73 | ORACLE accent (matches the Verse vertical color) |
| `--home-oracle-glow` | rgba(157, 76, 115, 0.35) | pulsing halo around the "Ask the Oracle" button |

The constellation tiles reuse `--home-gold`, `--home-gold-bright`, `--home-text`, `--home-muted`, `--home-link`. No new tokens for the strip.

**Type.** Display: Cormorant Garamond (already loaded). Interface: Figtree (already loaded). Sizes: ORACLE marquee headline 64px, verse text 26px, choice card text 19px, constellation tile name 16px/600, tagline 14px/1.45 muted.

## 4. Components

### 4.1 ORACLE marquee

- Full-width section, 880px tall on desktop. Layers back to front:
  - (a) Verse-paper background with a soft top-and-bottom vignette (`--home-ink` → `--home-oracle-paper` at top, `--home-oracle-paper` → `--home-ink` at bottom).
  - (b) A single tall "page" card, centered, 760px wide, 600px tall, radius 14, paper background, 1px rule in `--home-oracle-paper-rule`, faint inner shadow. Inside the card:
    - Eyebrow "AnimBook · ORACLE" (12px/600, `--home-oracle-paper-rule`, letter-spacing 0.16em).
    - Verse title (Cormorant 500, 36px).
    - Three lines of verse (Cormorant 500, 26px/1.45, `--home-oracle-paper-text`).
    - A rule (1px `--home-oracle-paper-rule` at 30% alpha).
    - "Ask the Oracle" button — 52px tall, 18px/600, paper-rule border, paper-text color, with a pulsing halo (`--home-oracle-glow`, scale 1 to 1.04, 2.6s alternate). On hover: gold background, `--home-on-gold` text.
  - (c) Three continuation cards (each ~280px wide, 140px tall) below the page card, in a row, gap 24px, slightly staggered with a 16px Y offset. Each card: paper background, 1px rule, hover lifts 4px. The middle card is "selected" by default (gold-bright border, soft glow).
- On viewport-enter, the page card fades up (700ms) and the three choice cards stagger in from below (each 200ms apart).
- **No interaction with `/api/oracle/...`.** Pure visual. Click on the "Ask the Oracle" button scrolls to `/read/<some-verse-slug>` (use the first book with vertical === "VERSE" from the books list).
- **Phones (under 700px):** section 660px tall, page card 100% wide with 20px gutter, verse text 20px, choice cards stack below at 100% wide.
- **Reduced motion:** kill the halo pulse and the entrance stagger; show the cards in their final state.

### 4.2 Constellation strip

- Section, 480px tall on desktop. Layered:
  - (a) Section header — left: "More than a book" (Cormorant 500, 44px/1.05); right: a small line "(13 ways AnimBook reads back)" in muted, 14px.
  - (b) Horizontal scroll track with the same `.lib-track` pattern as LibraryRow: 14px gaps, `scroll-snap-type: x proximity`, hidden scrollbar, scroll arrows on hover (touch: hidden).
  - (c) 13 tiles, each 240px wide, 280px tall, radius 12, `--home-surface` background, 1px ring `rgba(242,238,230,0.10)`, padding 18px 18px 22px.
- **Below-the-fold performance:** the strip uses `content-visibility: auto` with `contain-intrinsic-size: 0 480px`.
- **Responsive:** phone (under 700px) → tiles 200px wide, scroll-snaps per tile.

### 4.3 Constellation tile

- Vertical structure inside the 240×280 frame:
  - Preview tile (top, 204px wide × 130px tall) — vertical-accent background mixed 12% accent + 88% ink (reuse `verticalCardBackground()` from `apps/web/src/lib/homepage/fanCovers.ts`), 1px inset frame at 26% opacity (currentColor), a single representative glyph centered (see glyph table below). No image asset.
  - Name (Cormorant 500, 16px, color: vertical accent).
  - Tagline (Figtree, 14px/1.45, `--home-muted`, max 2 lines via `-webkit-line-clamp: 2`).
  - Hover: lifts 4px, ring becomes `rgba(242,238,230,0.26)`, the arrow at the bottom right (24×24, gold) fades in.

**Glyph table** (per feature, single SVG path, no library):

| Feature | Glyph (simple) | Color token |
|---|---|---|
| MEMORY | a brain outline | `--home-gold` |
| LENS | an eye outline | `--home-gold` |
| ECHO | three concentric arcs | `--home-gold` |
| LIVE TRANSLATION | two speech bubbles overlapping | `--home-gold` |
| LIVE | three dots in a row + radio waves | `--home-gold` |
| DREAM | a crescent moon | `--home-gold` |
| WORLDS | a small connected-dots graph | `--home-gold` |
| STAGE | a stage curtain outline | `--home-gold` |
| SIGNAL | a pulse line | `--home-gold` |
| NETWORK | a node with three branches | `--home-gold` |
| ARCHIVE | a stack of three sheets | `--home-gold` |
| SCHOOL | a chalkboard outline | `--home-gold` |
| STUDIO PRO | a phone outline with a marker | `--home-gold` |

Each glyph is an inline 64×64 SVG at 60% size inside the 130px preview tile, centered.

### 4.4 Wiring into the homepage

The new sections go between the existing `VerticalSection` and the footer, inside the same `<main>` element in `apps/web/src/pages/index.tsx`. No changes to API calls or data fetching. The marquee needs the first Verse book slug; the constellation strip needs no data (static).

- `OracleMarquee` reads `books`, finds the first book with `vertical === "VERSE"` and a non-empty slug, and links the "Ask the Oracle" button to `/read/<slug>?from=oracle`.
- `ConstellationStrip` reads `NEXTGEN_FEATURES` (static). No books list needed.

## 5. Motion

- **ORACLE marquee load:** page card fades up 24px (700ms cubic-bezier(.2,.7,.2,1)); choice cards stagger in from y+30 (each 220ms apart, 600ms each).
- **Ambient:** pulsing halo on the "Ask the Oracle" button (2.6s alternate, scale 1 → 1.04).
- **Constellation strip:** tiles don't move on scroll. Hover lifts tile 4px, fades the arrow in 180ms.
- **With `prefers-reduced-motion: reduce`:** kill the ORACLE entrance animation, kill the halo pulse. The constellation tiles stay static. Hover state is still instant.
- Animate only `transform` and `opacity`.

## 6. Accessibility

- Real `<a>` for every constellation tile (`href={route}`). Visible focus ring: 2px `--home-gold-bright`, offset 3px.
- The "Ask the Oracle" button is a real `<Link>` to a Verse book.
- Each glyph SVG has `aria-hidden="true"`. Each tile's accessible name comes from the visible name + tagline.
- Contrast: gold-bright on ink is ≥ 4.5:1 (already audited). Paper-text on paper is darker pair, ≥ 7:1.
- The marquee has a single h2 "ORACLE. The book reads you back." — describes the feature for screen readers.

## 7. Performance

- The marquee is pure CSS + SVG; no images, no API calls.
- The constellation strip uses CSS `content-visibility: auto` on below-the-fold sections (already used on library rows).
- No `backdrop-filter` on the marquee paper. No animation on the section as a whole.
- Total budget: the marquee + strip together should add no more than 4 kB First Load JS.

## 8. Steps (do them in order and commit after each)

**S1. Recon.** Find ORACLE's component, the Verse book in the books list, the LibraryRow scroll-track pattern, the `verticalCardBackground()` helper, and confirm no existing component renders the 13 features. Write `docs/nextgen-features-plan.md` with the files you'll touch and your decisions. Report clearly: (a) which slug the "Ask the Oracle" button should link to (the first Verse book), and (b) whether `verticalCardBackground()` is reusable for the constellation preview tiles.

**S2. Tokens + mock data.** Add the four ORACLE tokens to `.home-page`. Create `apps/web/src/lib/nextgen/features.ts` with the 13 (non-ORACLE) features: `{ name, tagline, route, glyph }` — glyph is a small inline SVG function or path constant.

**S3. ORACLE marquee paper + verse card.** Build `apps/web/src/components/nextgen/OracleMarquee.tsx` with the paper background, the single verse page card, and the eyebrow + title + verse lines + rule + "Ask the Oracle" button.

**S4. ORACLE choice cards + motion.** Add the three continuation cards below the page card with the staggered entrance, the pulsing halo on the button, and the reduced-motion overrides.

**S5. Constellation tile.** Build `apps/web/src/components/nextgen/ConstellationTile.tsx` with the 240×280 frame, preview tile, glyph, name, tagline, hover arrow.

**S6. Constellation strip.** Build `apps/web/src/components/nextgen/ConstellationStrip.tsx` — section header + horizontal scroll track + 13 tiles reusing the `.lib-track` pattern. Use `content-visibility: auto`.

**S7. Wire into the homepage.** Add both components to `apps/web/src/pages/index.tsx`, between `VerticalSection` and the footer. Pass `books` to `OracleMarquee`. Pass nothing to `ConstellationStrip` (static).

**S8. QA.** Run typecheck, the existing tests and the web build. Then check this list by hand and report each result:

1. The ORACLE marquee loads with the staggered entrance, then settles.
2. The pulsing halo on "Ask the Oracle" runs at ~2.6s alternate.
3. The "Ask the Oracle" button is a real link to a Verse book.
4. The constellation strip scrolls horizontally with snap and the scroll arrows.
5. Each constellation tile has a glyph, a name, a tagline and a route.
6. Hover on a constellation tile lifts it and fades in the arrow.
7. With reduced motion on, no entrance animation runs and no halo pulse; the layout is identical.
8. Phone layout: marquee page card is 100% wide, choice cards stack; constellation tiles are 200px wide.
9. Other pages are unchanged.
10. The homepage still builds under 4 kB additional JS for the new components.

Then run the app locally, tell me the command and URL, and stop. Do not push.

## 9. Final report

When you finish (or stop early), tell me:

1. Which steps are done and committed.
2. The files changed, in one short list.
3. How to run it locally.
4. The answers to S1 (a) and (b): the Verse slug chosen and whether `verticalCardBackground()` is reusable.
5. Anything you were unsure about or chose not to do.
