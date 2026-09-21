# Library redesign — implementation plan (S1)

## Files I'll touch

### New
- `apps/web/src/components/library/LibraryHero.tsx` — hero with backdrop, poster, text block, parallax
- `apps/web/src/components/library/LibraryPosterCard.tsx` — poster card with hover panel + generated cover fallback
- `apps/web/src/components/library/LibraryRow.tsx` — horizontal track with snap, scroll arrows, "Explore all"
- `apps/web/src/components/library/LibraryNav.tsx` — sticky translucent nav with expanding search
- `apps/web/src/components/library/icons.tsx` — Play/Read/Listen/Details/Chevron/Search/Menu SVGs
- `apps/web/src/lib/library/series.ts` — pure helpers: splitTitle, deriveSeries, isOriginals
- `apps/web/src/lib/library/coverColors.ts` — pure helper: coverColorFor(vertical, fallbackAccent)
- `apps/web/src/lib/library/heroSelection.ts` — pure helper: pickFeaturedBook(books)
- `apps/web/src/lib/library/rowDerivation.ts` — pure helper: deriveRows(books) — originals, series, verticals

### Modified
- `apps/web/src/pages/library.tsx` — replace card grid with hero + rows + grid mode branch
- `apps/web/src/components/Topbar.tsx` — accept a `variant?: "default" | "cinematic"` prop. Default unchanged.
- `apps/web/src/styles/globals.css` — append a `.lib-page` block at the bottom (scoped tokens + selectors). All other CSS untouched.

### Tests (pure-logic, no React)
- `apps/web/tests/librarySeries.test.mjs` — splitTitle, deriveSeries, isOriginals edge cases
- `apps/web/tests/libraryCoverColors.test.mjs` — stable hash → palette, fallback behavior
- `apps/web/tests/libraryHeroSelection.test.mjs` — prefers first with cover+description, falls back gracefully
- `apps/web/tests/libraryRows.test.mjs` — deriveRows ordering, skip-empty, dedupe, series inference

## Data mapping decisions

**Imprint "AnimBook Originals"** — there is no separate `imprint` field on BookSummary.
In this codebase `vertical === "ORIGINALS"` IS the AnimBook Originals imprint
(verticals.ts already names it "Originals" with promise "Made for the medium").
So `isOriginals(book) === book.vertical === "ORIGINALS"`.

**Series** — there is no `series` field on BookSummary. The brief explicitly allows
inferring from titles. Pattern: `title.split("·").map(s => s.trim())`. If exactly 2
parts AND both look like title words (not empty, not too long), treat the first
as `series`, second as `title`. Otherwise `series = null`. Books without a
detected series are not in any series row. The "Lagos Nights · The Lagoon"
example in the brief matches this pattern exactly.

**Hero selection** — no `featured` or `pinned` flag in BookSummary. Client-side
choice: first book in the loaded list that has both `coverUrl` AND a non-empty
`synopsis`. Stable because the API sorts by createdAt desc (`?limit=100`).
If no book qualifies, fall back to first book with cover, then first book at all.

**Vertical ordering for rows** — by `count` descending, then alphabetical as tie-break.
Skipped entirely when count is 0 (so empty verticals never show up as a row).

**Card data used** — `coverUrl`, `title` (split into series + title where pattern applies),
`vertical`, `subcategory`, `totalPages`, `synopsis` (clamped to 3 lines in hero).
No `author` on poster cards (it's already on the book landing page).

**No `?from=` filter changes.** When `vertical !== "ALL"` OR a search term is
present, render the existing single wrapped grid using the new `LibraryPosterCard`
component (same component, grid-mode styling in 4.8).

## Things in the brief that don't fit the real code

1. **Reader mode URLs don't exist.** The brief says "open Watch, Read and Listen
   in that mode" but the current Reader has no URL/query handling for modes —
   `useReaderStore` defaults to `"BOTH"`. Adding `?mode=watch` to the reader
   would change a separate page (not the library) and is explicitly out of scope
   ("Don't change the API…"). Decision: all three card icons open the book
   landing page (`/book/<slug>`) where the reader can pick a mode. I'll note
   this in the final report so the user can decide if they want me to follow up.

2. **"AnimBook Originals" imprint = vertical ORIGINALS.** There is no separate
   imprint column. Already covered above.

3. **Topbar variant, not a new component.** Brief says "library page variant
   only" for the nav. Cleanest path that respects "every other page keeps its
   current nav" is a `variant="cinematic"` prop on the existing `Topbar`.
   Default behavior is identical to today.

4. **No `<img>`-vs-CSS-background-image debate.** The brief says "explicit width
   and height" for covers to avoid layout shift. The current `BookCard` uses
   `background-image` on a `div` (aspect-ratio 3/4). I'll keep `background-image`
   for the poster card because it lets the cover scale-and-crop with `object-fit:
   cover` semantics via `background-size: cover; background-position: center;`
   and matches the existing visual language. Same explicit dimensions via
   `aspect-ratio: 200 / 300` (the brief's 2:3).

5. **No `content-visibility` magic.** The brief says "below-the-fold rows use
   `content-visibility: auto`" — I'll apply it but be aware it's a Chrome-only
   win; Safari/Firefox ignore it harmlessly.

## Things I'm explicitly NOT doing (per the brief's hard constraints)

- No new dependencies (no `framer-motion`, no `react-spring`, no icon library).
  All icons inline SVG.
- No API / Prisma / migration / env changes.
- No new endpoints or fields on existing responses.
- No changes to other pages' topbars, fonts, or any other styling.
- No `npm install`. (I'm relying on Next 14.2.35's React 18 and `globals.css`.)

## Sequence

S2 → tokens + Figtree font in `.lib-page` scope.
S3 → Poster card + generated cover + tests.
S4 → Rows derivation + LibraryRow + tests.
S5 → Hero + parallax + tests.
S6 → Library nav variant + expanding search.
S7 → Filter chips + grid mode branch + loading/error states.
S8 → Phone/tablet layouts.
S9 → QA pass.

Each step ends with `git add` + `git commit` locally. No `git push` to main.
