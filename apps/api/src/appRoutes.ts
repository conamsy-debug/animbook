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
