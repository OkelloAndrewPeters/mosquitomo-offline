// MosquitoMo Offline service worker.
// - App code (HTML/JS/CSS/JSON): NETWORK-FIRST with a 3 s timeout, so phones always get the latest version when online,
//   and fall back to the saved copy when offline or on a very slow connection.
// - Big, rarely-changing files (AI model, WASM runtime, map library, icons): CACHE-FIRST, for instant offline loads.
// - Precaching uses cache:'reload' so a new version never stores a stale copy from the browser's HTTP cache.
const VERSION = '2026-10-03.7';
const CACHE = 'mmo-' + VERSION;
const CORE = ['./', './index.html', './css/app.css', './manifest.webmanifest', './js/app.js', './js/risk.js', './js/weather.js',
  './js/i18n.js', './js/store.js', './js/sitenet.js', './js/places-ug.js', './js/care.js', './icons/mark.svg', './icons/icon-192.png'];
const HEAVY = ['./vendor/ort/ort.wasm.min.mjs', './vendor/ort/ort-wasm-simd-threaded.mjs', './vendor/ort/ort-wasm-simd-threaded.wasm',
  './models/sitenet.onnx', './models/sitenet_meta.json', './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css'];
const isHeavy = (url) => /\/(vendor|models|icons)\//.test(url.pathname) && !url.pathname.endsWith('sitenet_meta.json');

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  await c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })));
  // Heavy files: copy from the previous version's cache if present (no re-download), else fetch fresh.
  for (const u of HEAVY) {
    const old = await caches.match(u);
    if (old && !u.includes('sitenet')) await c.put(u, old);
    else await c.add(new Request(u, { cache: 'reload' })).catch(() => {});
  }
  self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('message', (e) => { if (e.data === 'version') e.source.postMessage({ version: VERSION }); });

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // weather, places, tiles: network (app keeps its own data cache)

  if (isHeavy(url)) {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    })));
    return;
  }

  e.respondWith((async () => {
    try {
      const r = await Promise.race([fetch(e.request, { cache: 'no-cache' }), timeout(3000)]);
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    } catch {
      return (await caches.match(e.request, { ignoreSearch: true })) || (await caches.match('./index.html')) || Response.error();
    }
  })());
});
