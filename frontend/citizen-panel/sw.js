const CACHE_NAME = 'civic-reporter-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/login.html',
        '/signup.html',
        '/manifest.json',
        '/js/auth.js',
        '/js/app.js'
      ]);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Bypass Service Worker for blob:, data:, and other non-http requests.
  // This is critical to prevent the SW from stripping the 'download' filename attribute from blob downloads.
  if (!event.request.url.startsWith('http')) {
    return;
  }

  const url = new URL(event.request.url);

  // Bypass cache completely for API, admin panel, and contractor panel
  if (url.pathname.startsWith('/api/') || 
      url.pathname.startsWith('/admin') || 
      url.pathname.startsWith('/contractor')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Always go network-first for HTML pages to ensure auth guards work
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
