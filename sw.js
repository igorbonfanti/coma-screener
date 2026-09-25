/* ============================================================================
 * Service worker coma-screener.
 *
 * v10: NETWORK-FIRST su tutto cio che sta sulla nostra origine, con la cache
 * come rete di sicurezza quando si e offline.
 *
 * Perche il cambio. Fino alla v9 la shell era cache-first: quando index.html,
 * css/ e js/ cambiano tutti insieme, un client gia installato puo ritrovarsi a
 * mescolare pezzi vecchi e nuovi (markup di una versione, CSS e JS di un'altra)
 * e l'app sembra rotta pur essendo corretta in produzione. Alzare VERSION non
 * basta: fra il momento in cui il browser scarica il nuovo sw.js e quello in
 * cui la nuova cache e pronta, la pagina aperta resta servita dalla vecchia.
 * Con network-first questo caso non puo piu accadere: online si vede sempre la
 * versione pubblicata, offline si vede l'ultima vista. Su un'app di poche
 * centinaia di kilobyte il costo in velocita e trascurabile.
 * ========================================================================== */
const VERSION = 'coma-v10';
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
  // se un file della shell manca, l'installazione non deve fallire in blocco:
  // meglio una cache incompleta che restare bloccati sulla versione precedente
  e.waitUntil(caches.open(VERSION)
    .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // CDN esterni: lascia passare

  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r && r.ok) {
          const copia = r.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copia)).catch(() => {});
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((c) => c || caches.match('./index.html')))
  );
});
