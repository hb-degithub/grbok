const CACHE_VERSION = '__CACHE_VERSION__';
const CACHE_NAME = 'huba-blog-' + CACHE_VERSION;
// NOTE: do NOT cache '/' or any HTML here. Caching HTML pages lets stale
// pages resurface forever (esp. via client-side router fetches).
const CORE_ASSETS = ['/offline/', '/favicon.svg', '/favicon.ico'];
const STATIC_EXT = /\.(css|js|mjs|woff2?|ttf|eot|png|jpe?g|gif|svg|ico|webp|avif)$/i;

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

function isStaticAsset(url) {
  return url.pathname.startsWith('/_astro/') ||
         url.pathname.startsWith('/pagefind/') ||
         STATIC_EXT.test(url.pathname);
}

function offlineResponse() {
  // caches.match may resolve to undefined (cache cleared / install incomplete);
  // respondWith MUST resolve to a real Response, otherwise the browser throws
  // "Failed to convert value to 'Response'" and the page dies with a network error.
  return caches.match('/offline/').then(r => r ||
    new Response('<!DOCTYPE html><html><body><h1>网络不可用，请稍后重试</h1></body></html>', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  );
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Do not intercept cross-origin requests - let the browser handle them directly
  if (url.origin !== self.location.origin) {
    return;
  }

  // Never cache API requests - always network
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(offlineResponse));
    return;
  }

  // Navigation requests: network-first with offline fallback
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(offlineResponse)
    );
    return;
  }

  // Static assets only: stale-while-revalidate.
  // IMPORTANT: HTML/document requests (e.g. Astro ClientRouter page fetches)
  // must NEVER be served from cache - always go to network.
  if (e.request.destination === 'document') {
    return;
  }

  if (isStaticAsset(url)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return resp;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Everything else: plain network passthrough (no caching)
});
