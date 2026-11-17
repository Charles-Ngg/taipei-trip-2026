/* ==========================================================================
   Service worker ── 離線快取 + 自動更新

   * 改咗 index.html、assets/、icons/ 或 manifest 之後，將 CACHE_VERSION 改大一號
     （例如 'v1' → 'v2'），大家下次開網站就會自動換新版本。
   * 淨係改 data/trip.js 唔使改呢度：行程資料每次開網站都會先試攞最新版本，
     冇網／網絡太慢先用手機入面嘅舊版，之後一收到新版就會即時更新畫面。

   All paths are relative to this file, so it works at "/" and at a sub-path
   such as "/taipei-trip-2026/".
   ========================================================================== */
const CACHE_VERSION = 'v4';
const CACHE_PREFIX = 'taipei-trip-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

const SCOPE = new URL('./', self.location.href).href;
const DATA_URL = new URL('data/trip.js', SCOPE).href;
const DATA_TIMEOUT_MS = 2500; // wait this long for fresh trip data before using the saved copy

const PRECACHE = [
  './',
  'data/trip.js',
  'assets/style.css',
  'assets/app.js',
  'manifest.webmanifest',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
].map((p) => new URL(p, SCOPE).href);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Only remove this site's old caches (other sites on the same github.io origin share the cache storage).
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;
  if (url.href === new URL('sw.js', SCOPE).href) return;

  if (req.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(event, SCOPE));
    return;
  }
  const key = url.origin + url.pathname; // ignore ?query so cache-busting params still hit the cache
  if (key === DATA_URL) {
    event.respondWith(networkFirst(event, key));
    return;
  }
  event.respondWith(staleWhileRevalidate(event, key));
});

/* ---------------------------------------------------------------- helpers */

function isText(res) {
  const type = res.headers.get('content-type') || '';
  return /text|javascript|json|css|html|xml|svg/.test(type);
}

// Responses that came through a redirect can't be used for navigations; store a clean copy.
async function clean(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

// Fetch a fresh copy (revalidating the HTTP cache), store it, and report whether it changed.
async function refresh(key) {
  const res = await clean(await fetch(key, { cache: 'no-cache' }));
  if (!res.ok) return { res, changed: false };
  const cache = await caches.open(CACHE_NAME);
  const old = await cache.match(key);
  let changed = false;
  if (old && isText(res)) {
    const [a, b] = await Promise.all([old.text(), res.clone().text()]);
    changed = a !== b;
  }
  await cache.put(key, res.clone());
  return { res, changed };
}

async function notify(type) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  list.forEach((client) => client.postMessage({ type }));
}

// Trip data: prefer the network (so itinerary edits show up straight away), fall back to the
// saved copy when offline or slow. Whenever a newer trip.js is saved, every open page and the
// installed app are told; each page then compares the data it is showing and refreshes if needed.
async function networkFirst(event, key) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(key);
  const net = refresh(key);
  event.waitUntil(net.then((r) => (r.changed ? notify('data-updated') : null)).catch(() => {}));
  if (!cached) return net.then((r) => r.res);

  return new Promise((resolve) => {
    let settled = false;
    const useSaved = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(cached);
    };
    const timer = setTimeout(useSaved, DATA_TIMEOUT_MS);
    net.then((r) => {
      if (settled) return;
      if (!r.res.ok) return useSaved();
      settled = true;
      clearTimeout(timer);
      resolve(r.res);
    }, useSaved);
  });
}

// App shell (HTML/CSS/JS/icons): answer instantly from the cache, refresh in the background.
async function staleWhileRevalidate(event, key) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(key);
  const net = refresh(key);
  event.waitUntil(net.then((r) => (cached && r.changed ? notify('app-updated') : null)).catch(() => {}));
  return cached || net.then((r) => r.res);
}
