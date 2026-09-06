// Service Worker mínim: no fem cache ni res especial, només cal que n'hi hagi
// un de registrat amb un handler de "fetch" perquè Chrome consideri l'app
// instal·lable (criteri de PWA installability).
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
