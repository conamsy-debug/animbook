/**
 * Minimal offline shell. Phase 1 keeps this barebones; the SW caches the
 * built JS/CSS so the Reader can re-open the last AnimBook without a network.
 */
const CACHE = "animbook-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const response = await fetch(req);
        if (response.status === 200 && req.url.startsWith(self.location.origin)) {
          cache.put(req, response.clone());
        }
        return response;
      } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        return new Response("", { status: 504, statusText: "Offline" });
      }
    })
  );
});