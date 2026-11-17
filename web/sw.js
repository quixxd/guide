// Service worker for the installed app (PWA).
//
// - The app's own files: network first, so every deploy shows up straight away; the last copy
//   is kept so the app still opens with a weak or no connection.
// - Versioned libraries from the CDNs (Leaflet, the vector-tile decoder): cache first.
// - Everything else (the LLM relay, Wikipedia, OpenStreetMap, map tiles): straight to the network,
//   never cached here. The relay in particular must never be answered from a cache.

const SHELL = "guide-shell-v1";
const LIBS = "guide-libs-v1";
const PRECACHE = ["./", "index.html", "app.js", "manifest.json", "icons/icon-192.png"];
const LIB_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== LIBS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.includes("/api/")) return; // the relay and health check: never cached
    event.respondWith(networkFirst(req));
    return;
  }
  if (LIB_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req));
  }
  // Anything else: not handled, the browser fetches it normally.
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    // Pages are stored without their query string, so an address with ?key=… isn't kept.
    if (res.ok) cache.put(req.mode === "navigate" ? "./" : req, res.clone());
    return res;
  } catch (error) {
    const hit = (await cache.match(req, { ignoreSearch: true })) ?? (req.mode === "navigate" ? await cache.match("./") : undefined);
    if (hit) return hit;
    throw error;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(LIBS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}
