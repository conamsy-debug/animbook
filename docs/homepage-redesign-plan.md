# Homepage redesign — implementation plan (S1)

## Recon summary

**Library redesign IS already in the repo** (just shipped in 0e0d040).
Reusable pieces:

| Library piece | Reused for homepage? |
| --- | --- |
| `--lib-*` tokens in `.lib-page` | Mirror as `--home-*` under `.home-page` (don't lift to `:root` — would touch library pages) |
| Figtree font in globals.css | Already global — usable from any scope |
| `Topbar` `variant="cinematic"` | Reuse as-is |
| `components/library/icons.tsx` PlayIcon, ChevronRightIcon, SearchIcon | Reuse |
| `verticalAccent` from `lib/verticals.ts` | Reuse (the existing per-vertical accent) |
| `coverColorFor` from `lib/library/coverColors.ts` | Reuse for fan generated minis |

**New pieces the homepage needs that library doesn't have:**

| New piece | Used by |
| --- | --- |
| `lib/homepage/wordWeights.ts` — `weightWords(text)` → `[{ word, start, end }]` | Living card word highlight |
| `lib/homepage/narrationPlayer.ts` — pure state machine (idle/playing/paused/ended) | Living card play/pause |
| `lib/homepage/fanCovers.ts` — `pickFanCovers(books, verticalId, max=3)` | Vertical card fans |
| `lib/homepage/verticalBackgrounds.ts` — derived `bg` for each vertical card | Section glow + card background |

## Answers to S1 (a) and (b)

### (a) Can the browser get the featured page's clip URL and narration audio through existing data?

**Clip URL — YES, public.** `GET /api/books/lagos-nights-2-the-lagoon/pages` (already used by `HeroPreview.tsx`) returns pages with `videoUrl`, `posterUrl`, `textExcerpt`. No new endpoint. Render `<video muted loop playsinline autoplay preload="metadata" poster={...} src={videoUrl}>`. The homepage already loads the books list via `/api/books?status=PUBLISHED&limit=100` and pulls the featured page from the existing `HeroPreview` call.

**Narration audio — PARTIAL.** `/api/narration/voices` is public and returns the curated voice list. `/api/narration/pages/:pageId?voice=<id>` is **auth-required** (uses `authMiddleware`) and returns `{ audioUrl }`. So:

- Unauthenticated users (most homepage visitors): play button must be hidden, quote shown as static text.
- Signed-in users: play button works. Click fetches the audio URL on demand.

This matches the brief's fallback rule ("If the narration audio can't be loaded... hide the play button, show the quote as static text"). I'll surface a small `aria-label` on the play button that says "Sign in to hear it" when not authenticated, so the affordance is still discoverable. The static quote is always shown regardless.

Existing helper `narrationUrl(pageId, voiceId)` in `apps/web/src/lib/voices.ts` already wraps the narration call. **I'll reuse it** — same dedup behavior the Reader relies on, and it caches in-module so the homepage doesn't double-fetch.

### (b) Are word timings stored anywhere?

**No.** The Prisma schema (`Page` model) has `audioUrl` but no `wordTimings` JSON column, no VTT alignment data, no phoneme timestamps. ElevenLabs' API does return `alignment` data on the synthesis response, but the existing `services/elevenlabs.ts` discards it — only the audio bytes are stored. Per the brief, I'll estimate on the client: weight each word by `character count` (after stripping whitespace), build cumulative fractions of the total, and the "current word" is the one whose range contains `audio.currentTime / audio.duration`. Driven by `timeupdate`.

The estimation is decent — it matches the user's intuition that longer words take longer. It drifts on words that the narrator pauses on (commas, sentence ends), but that's an acceptable trade-off for not changing the backend.

## Files I'll touch

### New
- `apps/web/src/lib/homepage/wordWeights.ts` — `weightWords(text)` returns `[{ word, start, end }]`
- `apps/web/src/lib/homepage/narrationPlayer.ts` — state-machine helpers (idle / playing / paused / ended)
- `apps/web/src/lib/homepage/fanCovers.ts` — `pickFanCovers(books, verticalId)`
- `apps/web/src/lib/homepage/verticalBackgrounds.ts` — derive card `bg` from vertical accent
- `apps/web/src/components/homepage/HomeHero.tsx` — backdrop + copy + buttons + stats + load sequence
- `apps/web/src/components/homepage/LivingCard.tsx` — clip / still + narration panel + word highlight
- `apps/web/src/components/homepage/BeforeAfter.tsx` — manuscript vs animated comparison with drag handle
- `apps/web/src/components/homepage/VerticalCard.tsx` — single vertical tile with fan
- `apps/web/src/components/homepage/VerticalSection.tsx` — header + grid + glow

### Modified
- `apps/web/src/pages/index.tsx` — rewrite to wire the new components
- `apps/web/src/styles/globals.css` — append `.home-page` block (tokens, hero, card, comparison, vertical cards, fan, glow, responsive). Library's `.lib-page` block is untouched.
- `apps/web/src/components/Topbar.tsx` — already has `variant="cinematic"`; homepage will use it (no change)

### Removed / deprecated
- `apps/web/src/components/HeroPreview.tsx` — replaced by LivingCard
- `apps/web/src/components/HeroActions.tsx` — replaced by inline buttons in HomeHero
- Existing `.home-section`, `.vertical-tile`, `.hero-banner`, `.hero-split` styles in globals.css are kept (still apply to non-redesigned pages like `/pricing`, `/profile` etc., though they currently aren't used elsewhere). No deletion — too easy to break something.

### Tests (pure-logic, no React)
- `apps/web/tests/homepageWordWeights.test.mjs` — character weighting, edge cases
- `apps/web/tests/homepageNarrationPlayer.test.mjs` — state transitions
- `apps/web/tests/homepageFanCovers.test.mjs` — vertical grouping, fallback to fewer covers

## Mapping the existing data

**Hero copy** — keep verbatim from `apps/web/src/pages/index.tsx`:
- Kicker: brief says sentence-case "A book that moves" (current is "AnimBook · A book that moves", all-caps eyebrow style).
- Headline: "Open a page. Watch a world come alive."
- Paragraph: "Every AnimBook pairs the original text with its own animation and a narrator you can choose. Read it, watch it, or listen. Built in Africa for readers everywhere."
- Buttons: "Open the library" (gold), "Create in Studio" (glass). Replaces the current "Get started free / Sign in / Create in Studio" trio — auth-gated "Open the library" instead of CTA-first sign-up.
- Stats: three items — books (data-driven from the loaded list), 12 verticals (data-driven via `VERTICALS.length`), 5 narrator voices (literal — matches today's count; could be derived from `narratorVoices().length` but the current page hard-codes "5").

**Vertical cards** — keep the twelve VERTICALS array (label / promise / blurb / accent / subcategories) verbatim from `lib/verticals.ts`. The brief table is an approximation; the source of truth is the existing array.

**Stats data** — already data-driven via `counts` map (books per vertical) and `books.length` (total books). "12 verticals" can be `VERTICALS.length`. "5 narrator voices" hard-coded (matches today's value; if voices change, this is a one-character update).

## Things in the brief that don't fit the real code

1. **Narration requires auth.** Brief acknowledges this with the fallback rule. I'll add a "Sign in" affordance so unauthenticated users know why the button is missing.

2. **Word timings — none stored.** Estimate on the client per the brief's recommendation.

3. **Stats "5 narrator voices" — hard-coded.** The brief says "stats numbers stay data-driven as they are today", and today the homepage hard-codes 5. I'll keep that but use `narratorVoices().length` instead so the value is correct if the catalog grows. (Same data source the narrator picker uses.)

4. **Vertical card "background" color** — the brief gives hex approximations. The existing `vertical.accent` is the canonical value. I'll use it directly for the top accent, and derive the dark background by mixing accent toward `#070B12` (ink) at about 12% accent / 88% ink per the brief's "If the app doesn't define a background tint per vertical" instruction.

5. **`<video>` autoplay** — modern browsers may block autoplay even when muted. The brief's rule: "If the browser blocks autoplay, the still shows." `<video poster=...>` handles that automatically.

## Things I'm explicitly NOT doing (per the brief's hard constraints)

- No API / Prisma / migration / env changes. (Confirmed with recon — narration endpoint already exists, clip endpoint already exists.)
- No new dependencies. (Will use only React, plain CSS, and the existing `narrationUrl` helper.)
- No changes to the library or any other page's nav, fonts, or styling.
- No `npm install`. (Sticking with React 18 / Next 14.2.35.)

## Sequence

S2 → mirror tokens + reuse cinematic nav.
S3 → Hero shell (backdrop, copy, buttons, stats, load sequence).
S4 → Living card (media + narration + word highlight + tests).
S5 → Before-and-after section.
S6 → Vertical cards (fan, glow, tests).
S7 → Responsive + reduced-motion + data-saver.
S8 → QA pass.

Each step ends with `git add` + `git commit` locally. No `git push` to main.
