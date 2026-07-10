const CACHE_NAME = 'purechat-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  // Network first, falling back to cache for API/Socket failures
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});