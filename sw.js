/* Vagus – Offline-Start. Programm: zuerst Netz (für Updates), sonst Zwischenspeicher. Daten von COROS/Abgleich werden nie zwischengespeichert. */
const VERSION = '2e31c07c46';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open('vagus-' + VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== 'vagus-' + VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const same = u.origin === self.location.origin;
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (!same && !fonts) return; // COROS, Abgleich, Claude: immer direkt
  if (same && /[?&](code|state|error)=/.test(u.search)) return; // Rückkehr von der Anmeldung
  e.respondWith((async () => {
    const cache = await caches.open('vagus-' + VERSION);
    if (fonts) { const hit = await cache.match(e.request); if (hit) return hit; const r = await fetch(e.request); if (r.ok || r.type === 'opaque') cache.put(e.request, r.clone()); return r; }
    try { const r = await fetch(e.request); if (r.ok) cache.put(e.request, r.clone()); return r; }
    catch (err) { return (await cache.match(e.request, { ignoreSearch: true })) || (await cache.match('./index.html')) || Response.error(); }
  })());
});
