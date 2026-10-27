// Smart School service worker: app-shell caching + Web Push.
// API calls are always network (attendance data must never be served
// stale). Structure: [1] app-shell caching below, [2] Web Push handlers
// at the end of the file (Phase 29 WS9, byte-for-byte — do not edit).
// WS10 completed section [1]: full shell precache (index + manifest +
// every icon incl. maskable + apple-touch), a complete never-cache
// API list (incl. /platform and /push/config, missed before), and
// only successful (ok) responses are ever put in the cache.
const CACHE = "smart-school-v2";
const CORE = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];
// Same-origin API prefixes — NEVER cached, always network. Covers
// every Express mount in src/app.js plus the Vercel rewrites in
// vercel.json (/platform/* operator console, /push/config VAPID
// endpoint). Anything under these prefixes bypasses the SW entirely.
const API = /^\/(auth|schools|attendance|webhooks|internal|me|health|platform|push)(\/|$)/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Only same-origin GETs are ever handled: non-GET (POST/PUT/PATCH/
  // DELETE) and cross-origin requests pass straight to the network.
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // API + auth: never cache.
  if (API.test(url.pathname)) return;
  // Hashed build assets + icons + manifest: cache-first, then network
  // (caching only successful responses, so a 404 is never pinned).
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    })));
    return;
  }
  // Navigations: network-first, fall back to the cached shell offline.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/")));
  }
});

// ---------------------------------------------------------------------
// [2] Web Push (Phase 29 WS9). The server sends a JSON payload
// { title, body, url } via the Web Push protocol (VAPID). Clicking a
// notification focuses an open app tab (or opens one) at the payload
// URL — the in-app Notifications inbox by default.
self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { body: e.data ? e.data.text() : "" };
  }
  const title = data.title || "Smart School";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/notifications" },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/notifications";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
