/* Firm Manager Mobile PWA: only static, public mobile assets can be cached.
   Never cache mission data, API responses, messages, tokens, uploaded documents or HTML. */
const CACHE_NAME = 'firm-manager-mobile-static-v5';
const STATIC_ASSETS = [
  '/assets/mobile.css',
  '/assets/mobile.js',
  '/assets/mobile-chat.js',
  '/assets/mobile-ai.js',
  '/assets/mobile-capture.js',
  '/assets/mobile-tasks.js',
  '/assets/mobile-mail.js',
  '/assets/mobile-manifest.json',
  '/assets/firm-mobile-180.png',
  '/assets/firm-mobile-192.png',
  '/assets/firm-mobile-512.png'
];
const STATIC_PATHS = new Set(STATIC_ASSETS);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('firm-manager-mobile-static-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !STATIC_PATHS.has(url.pathname)) return;
  event.respondWith(
    fetch(req)
      .then(response => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(req, copy)));
        }
        return response;
      })
      .catch(() => caches.match(req))
  );
});
