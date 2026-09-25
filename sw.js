/* Service worker coma-screener — app shell cache-first, dati network-first. */
// v9: design system "Terminale ambra" (terminale.css + font IBM Plex locali).
// Alzare SEMPRE la versione quando cambia un file in SHELL: la shell e'
// cache-first, quindi senza un nome nuovo i client gia' installati
// continuerebbero a vedere la versione precedente.
const VERSION = 'coma-v9';
const SHELL = [
  './', './index.html', './entry.html', './manifest.json', './icon.svg',
  './css/terminale.css', './css/coma.css',
  './fonts/ibm-plex-mono-latin-400-normal.woff2',
  './fonts/ibm-plex-mono-latin-500-normal.woff2',
  './fonts/ibm-plex-mono-latin-600-normal.woff2',
  './fonts/ibm-plex-sans-condensed-latin-400-normal.woff2',
  './fonts/ibm-plex-sans-condensed-latin-500-normal.woff2',
  './fonts/ibm-plex-sans-condensed-latin-600-normal.woff2',
  './fonts/ibm-plex-sans-condensed-latin-700-normal.woff2',
  './scripts/engine.js', './scripts/entry.js',
  './js/fmt.js', './js/ui.js', './js/charts.js', './js/live.js',
  './js/store.js', './js/export.js', './js/app.js', './js/entry-app.js',
  './auth-opzionale.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // dati: network-first (sempre freschi), fallback cache
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request).then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, cp)); return r; })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // CDN esterni: lascia passare
  if (url.origin !== self.location.origin) return;
  // shell: cache-first
  e.respondWith(caches.match(e.request).then((cached) => cached || fetch(e.request)));
});
