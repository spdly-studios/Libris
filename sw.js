const CACHE_NAME = 'libris-v2.6';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './data.js',
  './search.js',
  './charts.js',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Firebase and CDN requests must bypass this app-shell worker.
  if (new URL(e.request.url).origin !== self.location.origin) return;

  // Network first strategy
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200 && e.request.method === 'GET') {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return caches.match('./index.html').then((fallback) => fallback || new Response('', {
          status: 503,
          statusText: 'Offline'
        }));
      }))
  );
});
