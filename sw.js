// CACHE_FILES: generated with get_cache.go — run `go run get_cache.go` to regenerate.
const CACHE_NAME = "scream-v0.4.2";
const CACHE_FILES = [
  './css/app.css',
  './fonts/iconoir-font.css',
  './fonts/iconoir.woff2',
  './fonts/OstrichSans-Heavy.otf',
  './fonts/OstrichSans-Medium.otf',
  './fonts/phosphor/Phosphor-Light.woff2',
  './fonts/phosphor/phosphor.css',
  './icons/icon-192.png',
  './icons/icon-32.png',
  './icons/icon-512.png',
  './index.html',
  './js/css-snippets.js',
  './js/editor.js',
  './js/exporter.js',
  './js/iconoir-icons.js',
  './js/main.js',
  './js/parser.js',
  './js/present.js',
  './js/phosphor-icons.js',
  './js/preview.js',
  './js/timeline.js',
  './libs/codejar-cursor.js',
  './libs/codejar.js',
  './libs/marked.min.js',
  './manifest.json',
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      for (const url of CACHE_FILES) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn("scream SW: failed to cache", url, err);
        }
      }
      return self.skipWaiting();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => {
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
      });
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.map((n) => n !== CACHE_NAME && caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});
