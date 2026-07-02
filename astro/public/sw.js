const CACHE_VERSION = '__CACHE_VERSION__';
const CACHE_NAME = 'huba-blog-' + CACHE_VERSION;
const CORE_ASSETS = ['/', '/offline/', '/favicon.svg', '/favicon.ico'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache API requests - always network-first
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match('/offline/')));
    return;
  }

  // Navigation requests: network-first with offline fallback
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/offline/'))
    );
    return;
  }

  // Static assets: stale-while-revalidate (return cached immediately, refresh in background)
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(resp => {
        if (resp.ok && (url.pathname.startsWith('/_astro/') || url.pathname.match(/\.(css|js|woff2?|png|jpg|jpeg|gif|svg|ico|webp)$/))) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  self.registration.showNotification(data.title || '', {
    body: data.body || '',
    icon: '/favicon.svg'
  });
});
