/**
 * AnimBook public API catalogue.
 *
 * Single source of truth for every route the API ships. The `/api/docs`
 * endpoint surfaces this as JSON; `/docs` on the web renders it.
 *
 * Maintain this file when adding new modules. The trade-off vs auto-enumerating
 * Express's internal stack is that we get:
 *  - Stable grouping by module
 *  - Optional descriptions per route
 *  - Explicit documentation status (smoke-tested, smoke-pending, etc.)
 *  - A natural place to note auth requirements
 *
 * Shape:
 *   {
 *     module: "books",
 *     title: "AnimBook catalogue",
 *     routes: [
 *       { method: "GET", path: "/api/books", auth: "public", summary: "List AnimBooks" }
 *     ]
 *   }
 */

export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: "public" | "user" | "verified" | "service";
  summary: string;
  notes?: string;
}

export interface Module {
  id: string;
  title: string;
  description: string;
  routes: Route[];
}

export const APP_ROUTES: Module[] = [
  {
    id: "health",
    title: "Health",
    description: "Process liveness + dependency readiness for orchestrators.",
    routes: [
      { method: "GET", path: "/api/health", auth: "public", summary: "Smoke-friendly JSON with integration flags.", notes: "Returns 200 always when the process is up." },
      { method: "GET", path: "/api/health/live", auth: "public", summary: "Process liveness probe.", notes: "Use for Docker HEALTHCHECK / Kubernetes liveness." },
      { method: "GET", path: "/api/health/ready", auth: "public", summary: "DB + Redis readiness probe.", notes: "Returns 503 when any dependency is down." }
    ]
  },
  {
    id: "books",
    title: "AnimBook catalogue",
    description: "List, search, and read AnimBooks. Public reads, no auth.",
    routes: [
      { method: "GET", path: "/api/books", auth: "public", summary: "List AnimBooks with filters.", notes: "Filter: vertical, status, language, world (genre), q (text), limit, offset." },
      { method: "GET", path: "/api/books/verticals", auth: "public", summary: "Available verticals + Consumer worlds." },
      { method: "GET", path: "/api/books/search/full", auth: "public", summary: "Full-text search by title / author / synopsis / tags." },
      { method: "GET", path: "/api/books/:id", auth: "public", summary: "One AnimBook by id or slug.", notes: "Includes publisher + Book Brain." },
      { method: "GET", path: "/api/books/:id/pages", auth: "public", summary: "All pages of an AnimBook." },
      { method: "GET", path: "/api/books/:id/pages/:num", auth: "public", summary: "One page by number." }
    ]
  },
  {
    id: "library",
    title: "Reader library",
    description: "The reader's shelf. Personal state — auth required.",
    routes: [
      { method: "POST", path: "/api/library/:slug", auth: "user", summary: "Add an AnimBook to the library." },
      { method: "PUT", path: "/api/library/:slug/progress", auth: "user", summary: "Update reading progress (page + mode)." },
      { method: "GET", path: "/api/library/:slug/progress", auth: "user", summary: "Read current progress." },
      { method: "DELETE", path: "/api/library/:slug", auth: "user", summary: "Remove from the library." },
      { method: "GET", path: "/api/library", auth: "user", summary: "List the reader's library." }
    ]
  },
  {
    id: "studio",
    title: "AnimBook Studio",
    description: "Self-service authoring. Auth required, AI rate-limit honoured.",
    routes: [
      { method: "GET", path: "/api/studio/projects", auth: "user", summary: "List your Studio projects." },
      { method: "POST", path: "/api/studio/projects", auth: "user", summary: "Create a project." },
      { method: "POST", path: "/api/studio/projects/:id/upload", auth: "user", summary: "Upload a manuscript (multipart).", notes: "Triggers pipeline.ingest." },
      { method: "POST", path: "/api/studio/projects/:id/analyze", auth: "user", summary: "Re-run Book Brain.", notes: "Rate-limited: 30 RPM/user." },
      { method: "GET", path: "/api/studio/projects/:id/events", auth: "user", summary: "SSE stream of pipeline events." }
    ]
  },
  {
    id: "subscriptions",
    title: "Subscriptions (Stripe)",
    description: "Checkout + portal links for Premium / Studio tiers.",
    routes: [
      { method: "POST", path: "/api/subscriptions/checkout", auth: "user", summary: "Open a Stripe Checkout session." },
      { method: "POST", path: "/api/subscriptions/webhook", auth: "service", summary: "Stripe webhook receiver.", notes: "Verifies signature with STRIPE_WEBHOOK_SECRET." },
      { method: "GET", path: "/api/subscriptions/status", auth: "user", summary: "Current subscription state." }
    ]
  },
  {
    id: "community",
    title: "Community",
    description: "Public author profiles, following, reporting and blocking.",
    routes: [
      { method: "GET", path: "/api/community/authors/:handle", auth: "public", summary: "An author's public page and books." },
      { method: "GET", path: "/api/community/me", auth: "user", summary: "My public profile and community settings." },
      { method: "PUT", path: "/api/community/me", auth: "user", summary: "Set handle, bio and whether readers may message me." },
      { method: "POST", path: "/api/community/authors/:id/follow", auth: "user", summary: "Follow or unfollow an author." },
      { method: "GET", path: "/api/community/following", auth: "user", summary: "Authors I follow and their newest books." },
      { method: "POST", path: "/api/community/reports", auth: "user", summary: "Report a note, post, message or account." },
      { method: "POST", path: "/api/community/blocks", auth: "user", summary: "Block or unblock an account." }
    ]
  },
  {
    id: "notes",
    title: "Margin notes",
    description: "Short notes readers leave on a page, screened before they appear.",
    routes: [
      { method: "GET", path: "/api/notes/pages/:pageId", auth: "user", summary: "Notes on a page (blocked accounts hidden)." },
      { method: "POST", path: "/api/notes/pages/:pageId", auth: "user", summary: "Leave a note; screened, and held if uncertain." },
      { method: "DELETE", path: "/api/notes/:id", auth: "user", summary: "Remove your own note." },
      { method: "GET", path: "/api/notes/books/:bookId/counts", auth: "user", summary: "Note counts per page." }
    ]
  },
  {
    id: "circles",
    title: "Reading circles",
    description: "Small private groups reading a book together, joined by invite.",
    routes: [
      { method: "GET", path: "/api/circles", auth: "user", summary: "Circles I'm in." },
      { method: "POST", path: "/api/circles", auth: "user", summary: "Start a circle, optionally about a book." },
      { method: "GET", path: "/api/circles/:id", auth: "user", summary: "A circle, its members and conversation." },
      { method: "POST", path: "/api/circles/:id/posts", auth: "user", summary: "Post to the circle (screened)." },
      { method: "DELETE", path: "/api/circles/posts/:id", auth: "user", summary: "Remove your post; owners may remove any." },
      { method: "POST", path: "/api/circles/join", auth: "user", summary: "Join with an invite code." },
      { method: "POST", path: "/api/circles/:id/leave", auth: "user", summary: "Leave; owners hand over or close the circle." },
      { method: "DELETE", path: "/api/circles/:id/members/:userId", auth: "user", summary: "Owner removes a member." },
      { method: "POST", path: "/api/circles/:id/invite", auth: "user", summary: "Owner issues a fresh invite code." }
    ]
  },
  {
    id: "narration",
    title: "Narration voices",
    description: "Reader-selectable narrators, recorded once per page and voice, then shared.",
    routes: [
      { method: "GET", path: "/api/narration/voices", auth: "public", summary: "Narrator voices readers can choose." },
      { method: "GET", path: "/api/narration/voices/:voice/sample", auth: "public", summary: "Short sample of a voice (cached)." },
      { method: "GET", path: "/api/narration/pages/:pageId?voice=ID", auth: "user", summary: "Narration for one page in the chosen voice.", notes: "Recorded on first request; daily limits per reader and account-wide." }
    ]
  },
  {
    id: "legal",
    title: "Pricing & Legal",
    description: "Public pricing + GDPR export/erase.",
    routes: [
      { method: "GET", path: "/api/legal/pricing", auth: "public", summary: "3-tier pricing table for the /pricing page." },
      { method: "GET", path: "/api/account/me", auth: "user", summary: "The signed-in reader's account (profile page)." },
      { method: "GET", path: "/api/account/export", auth: "user", summary: "GDPR Art. 20 — data portability (JSON download)." },
      { method: "POST", path: "/api/account/delete", auth: "user", summary: "GDPR Art. 17 — right to erasure.", notes: "Audit row preserved as required by Art. 30." }
    ]
  },
  {
    id: "edu",
    title: "EDU vertical",
    description: "AnimBook EDU — curriculum-mapped with checkpoints + teacher dashboard.",
    routes: [
      { method: "GET", path: "/api/edu/curriculum/:bookId", auth: "public", summary: "Curriculum mapping for an AnimBook." },
      { method: "POST", path: "/api/edu/checkpoints/:pageId/respond", auth: "user", summary: "Submit a checkpoint response." },
      { method: "GET", path: "/api/edu/classroom/:slug", auth: "user", summary: "Classroom overview for teachers." },
      { method: "GET", path: "/api/edu/dashboard/:slug", auth: "user", summary: "Heatmap + misconception rollup." }
    ]
  },
  {
    id: "kids",
    title: "KIDS vertical",
    description: "Bedtime mode + character voices. Public reads, KIDS author writes are auth-required.",
    routes: [
      { method: "GET", path: "/api/kids/voices/:bookId", auth: "public", summary: "List character voices for a KIDS AnimBook." }
    ]
  },
  {
    id: "faith",
    title: "FAITH vertical",
    description: "Sacred texts. Theological-advisor review before publish.",
    routes: [
      { method: "GET", path: "/api/faith/books", auth: "public", summary: "List FAITH AnimBooks (only approved)." },
      { method: "POST", path: "/api/faith/review/:bookId", auth: "user", summary: "Submit a theological-advisor review." }
    ]
  },
  {
    id: "memory",
    title: "MEMORY (adaptive profile)",
    description: "Reader's adaptive Reader profile. Auth required.",
    routes: [
      { method: "GET", path: "/api/memory/settings", auth: "user", summary: "Read the adaptive profile (palette, pacing, font size…)." },
      { method: "PUT", path: "/api/memory/settings", auth: "user", summary: "Update the profile — drives MEMORY adaptive tuning." }
    ]
  },
  {
    id: "oracle",
    title: "ORACLE (branching narratives)",
    description: "Branching story continuations for VERSE AnimBooks.",
    routes: [
      { method: "POST", path: "/api/oracle/trees", auth: "user", summary: "Start a branching tree from a page." },
      { method: "POST", path: "/api/oracle/choose", auth: "user", summary: "Commit a chosen continuation." }
    ]
  },
  {
    id: "live",
    title: "LIVE (hosted readings)",
    description: "One-to-many reading sessions.",
    routes: [
      { method: "POST", path: "/api/live/sessions", auth: "user", summary: "Start a LIVE session." },
      { method: "GET", path: "/api/live/sessions/:id/events", auth: "public", summary: "SSE feed of page events." }
    ]
  },
  {
    id: "translation",
    title: "Translation",
    description: "Tappable word translation across the vertical.",
    routes: [
      { method: "GET", path: "/api/translation/gloss", auth: "public", summary: "Lookup a word's translation + pronunciation." }
    ]
  },
  {
    id: "worlds",
    title: "Worlds (shared universes)",
    description: "Multi-book franchises with shared characters + style.",
    routes: [
      { method: "GET", path: "/api/worlds", auth: "user", summary: "List worlds.", notes: "Cached 120s." },
      { method: "POST", path: "/api/worlds", auth: "user", summary: "Create a world." },
      { method: "POST", path: "/api/worlds/:id/books/:bookId/member", auth: "user", summary: "Add a book to the world." }
    ]
  },
  {
    id: "stage",
    title: "Stage (collaborative)",
    description: "Many authors contribute pages before AI generation.",
    routes: [
      { method: "POST", path: "/api/stage/rounds", auth: "user", summary: "Open a contribution round." },
      { method: "POST", path: "/api/stage/rounds/:id/contribute", auth: "user", summary: "Submit a contributed page." }
    ]
  },
  {
    id: "signal",
    title: "Signal (page telemetry)",
    description: "Dwell time + scrollback events that drive MEMORY tuning.",
    routes: [
      { method: "POST", path: "/api/signal/page-event", auth: "user", summary: "Record a per-page event." }
    ]
  },
  {
    id: "network",
    title: "Network",
    description: "Public AnimBook graph + private creator distribution.",
    routes: [
      { method: "GET", path: "/api/network/graph", auth: "public", summary: "Public AnimBook ↔ AnimBook edges." },
      { method: "GET", path: "/api/network/distribution", auth: "user", summary: "Creator's distribution stats." }
    ]
  },
  {
    id: "achievements",
    title: "Achievements",
    description: "Reader-achievement ledger (first flip, bedtime streak…).",
    routes: [
      { method: "GET", path: "/api/achievements", auth: "user", summary: "List the reader's earned achievements." }
    ]
  },
  {
    id: "creator",
    title: "Creator portal",
    description: "Author-side earnings + royalty statements.",
    routes: [
      { method: "GET", path: "/api/creator/earnings", auth: "user", summary: "Creator earnings summary." }
    ]
  },
  {
    id: "publishers",
    title: "Publishers",
    description: "Publisher admin — AnimBooks under their licence.",
    routes: [
      { method: "GET", path: "/api/publishers/:id/catalog", auth: "user", summary: "Publisher's catalogue." }
    ]
  },
  {
    id: "offline",
    title: "Offline",
    description: "Service-worker manifest for offline reading.",
    routes: [
      { method: "GET", path: "/api/offline/:slug/manifest", auth: "user", summary: "List every asset to cache." },
      { method: "POST", path: "/api/offline/:slug/download", auth: "user", summary: "Record a download on the reader." }
    ]
  },
  {
    id: "business",
    title: "Business vertical (SCORM)",
    description: "L&D AnimBooks with SCORM 2004 packaging.",
    routes: [
      { method: "GET", path: "/api/business/scorm/:bookId", auth: "user", summary: "Download the SCORM 2004 4th Edition package." }
    ]
  },
  {
    id: "archive",
    title: "AnimBook ARCHIVE (oral history)",
    description: "Consent-gated oral-history publications.",
    routes: [
      { method: "GET", path: "/api/archive/projects", auth: "public", summary: "List archive projects." },
      { method: "GET", path: "/api/archive/:slug", auth: "public", summary: "Archive project detail." }
    ]
  },
  {
    id: "school",
    title: "AnimBook SCHOOL",
    description: "Classrooms, assignments, submissions.",
    routes: [
      { method: "POST", path: "/api/school/classrooms", auth: "user", summary: "Create a classroom." },
      { method: "POST", path: "/api/school/classrooms/:id/assignments", auth: "user", summary: "Add an assignment." }
    ]
  },
  {
    id: "languages",
    title: "AnimBook Languages",
    description:
      "Interactive language-learning: animated stories, tappable subtitles, vocabulary deck with FSRS, 5 exercise types, pronunciation scoring. Phase 1 ships English/French UI and 7 target languages (en, fr, es, zh-Hans, de, it, he). Routes mount only when LANGUAGES_ENABLED=true.",
    routes: [
      {
        method: "GET",
        path: "/api/lang/health",
        auth: "public",
        summary: "Health probe for the Languages module.",
        notes: "Returns { ok, feature, patch, status }. Mounted only when LANGUAGES_ENABLED=true."
      },
      {
        method: "GET",
        path: "/api/lang/stories/:storyId",
        auth: "user",
        summary: "Story player payload.",
        notes: "Returns scenes, lines, tokens, exercises for the StoryPlayer. Query `?base=fr` selects translation + gloss language (defaults to en)."
      },
      {
        method: "GET",
        path: "/api/lang/languages",
        auth: "user",
        summary: "Active languages catalog (Patch 05 onboarding).",
        notes: "Returns `is_active=true` rows ordered by base flag + code. Mirrors apps/web/src/features/languages/config.ts."
      },
      {
        method: "GET",
        path: "/api/lang/courses",
        auth: "user",
        summary: "Courses for a base language (Patch 05 course picker).",
        notes: "Query `?base=en|fr`. Returns the 5–6 published courses for the requested base."
      },
      {
        method: "POST",
        path: "/api/lang/enrollments",
        auth: "user",
        summary: "Create / upsert an enrollment (Patch 05).",
        notes: "Body `{ target_lang, base_lang, daily_goal? }`. Idempotent on (user, course). Spec forbids target_lang == base_lang. daily_goal is accepted but not yet persisted (lands with Patch 10 stats)."
      },
      {
        method: "GET",
        path: "/api/lang/enrollments/me",
        auth: "user",
        summary: "Current user's enrollments (Patch 05 onboarding follow-up).",
        notes: "Returns each enrollment's course metadata so the picker renders directly."
      },
      {
        method: "GET",
        path: "/api/lang/courses/:courseId",
        auth: "user",
        summary: "Course home (Patch 05).",
        notes: "Stories list, learner's per-story progress, streak/XP rollup. Course home preview is allowed without an enrollment."
      },
      {
        method: "POST",
        path: "/api/lang/stories/:storyId/progress",
        auth: "user",
        summary: "Record per-scene story progress (Patch 05).",
        notes: "Body `{ last_scene_order, score_pct?, completed? }`. Idempotent upsert keyed on (user, story). Touches the matching enrollment + LearnerStats so the streak math has a fresh anchor."
      },
      {
        method: "GET",
        path: "/api/lang/lexemes/:lexemeId",
        auth: "user",
        summary: "Word popup data (Patch 06).",
        notes: "Returns surface + lemma + reading + partOfSpeech + gender + per-base glosses + audioUrl. Query `?base=fr` switches gloss language. Optional `?line_id=` adds the source-line context the popup displays under the example sentence."
      },
      {
        method: "POST",
        path: "/api/lang/vocab",
        auth: "user",
        summary: "Save a word to the learner's deck (Patch 06).",
        notes: "Body `{ lexeme_id, source_line_id? }`. Idempotent on (user, lexeme) — a duplicate returns 200 + `alreadySaved: true`. Creates a `user_vocab` card in the FSRS \"new\" state and awards 2 XP."
      },
      {
        method: "DELETE",
        path: "/api/lang/vocab/:userVocabId",
        auth: "user",
        summary: "Remove a word from the deck (Patch 06).",
        notes: "Idempotent — 200 with `{ removed: false }` when the row is already gone or belongs to another user."
      },
      {
        method: "GET",
        path: "/api/lang/vocab",
        auth: "user",
        summary: "My words (Patch 06).",
        notes: "Returns the learner's saved cards with lexeme + source-line metadata. Query `?course=:courseId` scopes to one course; `?q=…` substring-searches lemma + glosses; `?base=fr` picks the gloss language."
      },
      {
        method: "POST",
        path: "/api/lang/exercises/:exerciseId/attempts",
        auth: "user",
        summary: "Record an exercise attempt + award XP (Patch 07).",
        notes: "Body shape depends on Exercise.type: `{ index }` for comprehension_mc / word_meaning_mc / listen_select; `{ order }` for sentence_builder; `{ score, transcript? }` for speak_line. Awards 10 XP per correct MC / sentence_builder answer, 5 XP per speak_line attempt scoring ≥ 60. Wrong attempts still write a row for the admin review screen (Patch 12)."
      },
      {
        method: "POST",
        path: "/api/lang/pronunciation",
        auth: "user",
        summary: "Speak_line audio scoring (Patch 08).",
        notes: "Raw audio body (`audio/webm` / `audio/ogg` / `audio/mp4`) with `X-Line-Id` + `X-Stt-Code` headers. Runs Whisper transcription, normalises + tokenises both sides, emits a 0..100 score + per-word colouring. Awards 5 XP for ≥ 60. 503 when OPENAI_API_KEY is unset."
      },
      {
        method: "GET",
        path: "/api/lang/review/due",
        auth: "user",
        summary: "List due FSRS cards (Patch 09).",
        notes: "Optional `?course=:courseId` filters by enrollment's target_lang. Optional `?limit=` (max 20, default 20) trims the response. Returns `cards[]` (lexeme + card state) + `totalDue` (uncapped count) + `count` (rows in this response)."
      },
      {
        method: "POST",
        path: "/api/lang/review/:userVocabId",
        auth: "user",
        summary: "Record an FSRS rating (Patch 09).",
        notes: "Body: `{ rating: 1|2|3|4 }` (Again|Hard|Good|Easy). Runs ts-fsrs to compute the next card state, writes both the `user_vocab` update + `review_logs` insert in a transaction, awards +1 XP. Returns the next card state + the FSRS log payload."
      }
    ]
  },
  {
    id: "dream",
    title: "AnimBook DREAM",
    description: "Sleep-mode for WELLNESS AnimBooks. Auto-applies a slower palette + gentle narration when a WELLNESS book opens.",
    routes: [
      { method: "POST", path: "/api/dream/sessions", auth: "user", summary: "Open a DREAM session." },
      { method: "PUT", path: "/api/dream/sessions/:id", auth: "user", summary: "Update page progress." },
      { method: "POST", path: "/api/dream/sessions/:id/end", auth: "service", summary: "End the session (Reader unmount → sendBeacon)." }
    ]
  },
  {
    id: "studio-pro",
    title: "AnimBook STUDIO PRO",
    description: "AR / NFC companion for every published AnimBook.",
    routes: [
      { method: "GET", path: "/api/studio-pro/marker/:bookId", auth: "public", summary: "Look up by AR marker hash." },
      { method: "GET", path: "/api/studio-pro/nfc/:tagId", auth: "public", summary: "Look up by NFC tag id." }
    ]
  }
];

export function totalRouteCount(): number {
  return APP_ROUTES.reduce((acc, m) => acc + m.routes.length, 0);
}
