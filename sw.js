// Mizica — service worker: samo toliko, da je stran nameščljiva ("Dodaj na domači zaslon") in da
// osnovna lupina strani deluje tudi ob slabi povezavi. NE predpomni API klicev (naročila, meni, cene
// morajo biti vedno sveži) — samo statične datoteke strani same.
const CACHE_NAME = 'mizica-shell-v1';
const SHELL_FILES = ['/', '/index.html', '/style.css', '/app.js', '/config.js', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Samo GET zahteve na naš izvor (lupina strani); vse ostalo (API, Supabase, zunanji viri) gre
  // vedno neposredno na splet, brez predpomnjenja — da so podatki vedno sveži.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((resp) => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
