// AnimBook service worker. Installed on first visit from /_app.tsx.
// Strategy:
//   - PRECACHE: critical shell (root path, manifest, icons) so the app
//     can boot offline and re-open the last book from cache.
//   - RUNTIME CACHE, same-origin GETs: stale-while-revalidate. Always
//     serves the cached copy first, refreshes in the background, falls
//     back to network when no cache exists.
//   - BYPASS: cross-origin (Clerk, Runway, ElevenLabs CDN, R2 media),
//     POST / non-GET, Range requests (video seeks), Next.js _next/data
//     JSON (always fresh from the server).
//
// Versioning: bump CACHE_VERSION whenever the precache list changes so
// the new SW replaces the old on install. Old caches are deleted in
// activate.

const CACHE_VERSION = "v2";
const SHELL_CACHE = `animbook-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `animbook-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/site.webmanifest",
  "/favicon.ico",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Cross-origin: never cache. Clerk auth, R2 media, video streams all
  // need to flow through their own CDNs with proper auth / Range headers.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Video / audio range requests: never cache. The browser / <video>
  // element needs the server to honour Range, and caching partial
  // responses breaks playback.
  if (req.headers.has("range")) return;

  // Next.js data JSON: always fresh. Stale data here causes stale UI.
  if (url.pathname.startsWith("/_next/data/")) return;

  // Same-origin GETs: stale-while-revalidate against the runtime cache.
  // On fetch error we serve whatever is in cache; if nothing's cached
  // we return a 504 so the app can show an offline-friendly message.
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            cache.put(req, response.clone()).catch(() => undefined);
          }
          return response;
        })
        .catch(() => null);
      if (cached) {
        // Kick off a background refresh but return cached immediately.
        event.waitUntil(fetchPromise.catch(() => undefined));
        return cached;
      }
      const network = await fetchPromise;
      if (network) return network;
      // Last resort: try the shell cache for navigations so users can
      // at least re-open a page they already visited.
      if (req.mode === "navigate") {
        const shell = await caches.open(SHELL_CACHE);
        const shellHit = await shell.match(req);
        if (shellHit) return shellHit;
      }
      return new Response("", { status: 504, statusText: "Offline" });
    })()
  );
});

// Message channel: lets the page trigger an immediate skipWaiting so
// a new SW deploys without waiting for the next page reload. Useful
// when the user just dismissed the install prompt and we want the
// latest assets immediately.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
