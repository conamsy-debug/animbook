# AnimBook next-gen features on the homepage — implementation plan

This is the S1 plan doc for `animbook-nextgen-features-brief.md`. It records the recon findings and the concrete files this work will touch.

## S1 answers

### (a) Which slug does "Ask the Oracle" link to?

Querying `GET https://api.animbook.com/api/books?status=PUBLISHED&limit=100` returns 31 books, 4 in the **VERSE** vertical:

- `lagos-nights-3-the-letter` — Lagos Nights · The Letter
- `a-poem-for-lagos` — A Poem for Lagos
- `lagos-nights-prologue-the-bridge` — Lagos Nights · Prologue · The Bridge
- `a-poem-for-accra` — A Poem for Accra

**Decision:** the marquee's "Ask the Oracle" button links to `/read/lagos-nights-3-the-letter?from=oracle`. We pick the first item from the published books list (sorted by `createdAt` desc) where `vertical === "VERSE"`. The page fetches its books list via `useResilientFetch`, so the link is always picked fresh from production data without us hard-coding the slug.

### (b) Is `verticalCardBackground()` reusable for the constellation preview tiles?

Yes. `verticalCardBackground(accent: string | undefined): string` lives at `apps/web/src/lib/homepage/fanCovers.ts:47` and returns a CSS color string that mixes the accent 12% with ink 88%. Falls back to `#0D1420` for unknown accents. The constellation tiles will call this with each feature's accent color (gold `#C9A03C` for all 13, since they share the brand color). Result is `rgb(28, 25, 21)` — a dark warm surface that matches the home palette.

## Files this work will touch

### New files

- `apps/web/src/components/nextgen/OracleMarquee.tsx` — the ORACLE marquee (S3, S4).
- `apps/web/src/components/nextgen/ConstellationTile.tsx` — the single tile (S5).
- `apps/web/src/components/nextgen/ConstellationStrip.tsx` — the section (S6).
- `apps/web/src/lib/nextgen/features.ts` — the 13-feature static list + inline glyph constants (S2).
- `apps/web/tests/oracleMarquee.test.mjs` — at least 3 tests (S4): first verse book selection, fallback when no verse book, link shape.
- `apps/web/tests/constellationFeatures.test.mjs` — at least 3 tests (S2/S5): 13 entries, every entry has {name, tagline, route, glyph}, route starts with `/`.

### Modified files

- `apps/web/src/styles/globals.css` — four ORACLE tokens appended to the `.home-page` block; a new section under `.home-page .home-oracle-*` for the marquee + strip styles.
- `apps/web/src/pages/index.tsx` — import and render the two new components between `VerticalSection` and the footer; pass `books` to `OracleMarquee`.

### Unchanged

- `apps/api/**` — no backend, schema, queue, or env changes (per brief).
- `apps/web/src/components/OracleChoices.tsx` — the in-reader modal stays as-is; the marquee is a static preview, not a fork.
- All other pages — library, reader, profile, school, worlds, live, signal, network, archive, dream, companion, edu, memory — keep their current look.

## Decisions

1. **Scroll-track pattern.** The library's `.lib-track` is scoped under `.lib-page`. The constellation strip lives on the homepage under `.home-page`. Two options:
   - (i) Widen `.lib-track` to `:where(.lib-page, .home-page) .lib-track` (same pattern we used for the cinematic nav).
   - (ii) Create a new `.home-constellation-track` with the same shape.
   - **Chose (ii).** Keeps the library page's neighbor-dimming rules (`.lib-track:hover .lib-card:not(:hover):not(:focus-within) { opacity: .5 }`) library-only. The constellation tiles don't need neighbor dimming, so a fresh class is cleaner.

2. **Glyph source.** All 13 glyphs are inline SVG paths in `apps/web/src/lib/nextgen/features.ts` (one function per glyph returning JSX, or one constant per glyph path with a shared `<Glyph d=... />` wrapper). No SVG sprite, no external file.

3. **ORACLE marquee data flow.** The marquee reads `books` (already fetched by the homepage via `useResilientFetch`) and picks the first Verse book. No new endpoint. If the books list hasn't loaded yet (`books.length === 0`), the marquee shows a quiet skeleton (the page card with a loading shimmer, no "Ask the Oracle" button).

4. **No interaction with `/api/oracle/...`.** Per the brief, the marquee is a static visual. The "Ask the Oracle" button navigates to `/read/<slug>?from=oracle` — the actual Oracle experience is inside the reader, behind the existing modal. The marquee is a teaser, not a fork.

5. **Reduced motion.** Handled in CSS via `@media (prefers-reduced-motion: reduce)` — kill the entrance animation, kill the halo pulse. The constellation tiles don't move, so they need no reduced-motion overrides.

## Order of operations

S1 (this doc) → S2 tokens + features.ts → S3 marquee paper → S4 marquee motion → S5 tile → S6 strip → S7 wire into index.tsx → S8 QA + commit.
