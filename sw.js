// Offline-first: the app shell, the AI runtime (WASM) and the SiteNet model are cached on install.
const V = 'mmo-v1';
const CORE = ['./', './index.html', './css/app.css', './manifest.webmanifest', './js/app.js', './js/risk.js', './js/weather.js',
  './js/i18n.js', './js/store.js', './js/sitenet.js', './icons/mark.svg', './icons/icon-192.png'];
const AI = ['./vendor/ort/ort.wasm.min.mjs', './vendor/ort/ort-wasm-simd-threaded.mjs', './vendor/ort/ort-wasm-simd-threaded.wasm',
  './models/sitenet.onnx', './models/sitenet_meta.json'];
self.addEventListener('install', (e) => e.waitUntil((async () => {
  const c = await caches.open(V);
  await c.addAll(CORE);
  await Promise.all(AI.map((u) => c.add(u).catch(() => {}))); // model may not exist yet during development
  self.skipWaiting();
})()));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // weather & places: network (app caches data itself)
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => {
    const net = fetch(e.request).then((r) => { if (r.ok) caches.open(V).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => hit);
    return hit || net; // cache first (fast, offline), refresh in background
  }));
});
