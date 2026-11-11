// Hors-ligne : l'appli est servie depuis le cache, puis mise à jour en arrière-plan.
// Changer CACHE à chaque nouvelle version pour forcer la mise à jour sur la tablette.

const CACHE = 'hb-salon-v21';
const FONTS = [
  'fonts/cormorant-latin-ext.woff2',
  'fonts/cormorant-latin.woff2',
  'fonts/manrope-latin-ext.woff2',
  'fonts/manrope-latin.woff2',
  'fonts/oswald-latin-ext.woff2',
  'fonts/oswald-latin.woff2',
  'fonts/work-sans-latin-ext.woff2',
  'fonts/work-sans-latin.woff2',
  'fonts/bodoni-moda-500i-latin-ext.woff2',
  'fonts/bodoni-moda-500i-latin.woff2',
  'fonts/bodoni-moda-latin-ext.woff2',
  'fonts/bodoni-moda-latin.woff2',
  'fonts/archivo-latin-ext.woff2',
  'fonts/archivo-latin.woff2',
  'fonts/dm-serif-display-latin-ext.woff2',
  'fonts/dm-serif-display-latin.woff2',
  'fonts/dm-sans-latin-ext.woff2',
  'fonts/dm-sans-latin.woff2',
  'fonts/marcellus-latin-ext.woff2',
  'fonts/marcellus-latin.woff2',
  'fonts/josefin-sans-latin-ext.woff2',
  'fonts/josefin-sans-latin.woff2',
  'fonts/space-grotesk-latin-ext.woff2',
  'fonts/space-grotesk-latin.woff2',
  'fonts/ibm-plex-sans-latin-ext.woff2',
  'fonts/ibm-plex-sans-latin.woff2',
  'fonts/barlow-condensed-latin-ext.woff2',
  'fonts/barlow-condensed-latin.woff2',
  'fonts/barlow-400-latin-ext.woff2',
  'fonts/barlow-500-latin-ext.woff2',
  'fonts/barlow-600-latin-ext.woff2',
  'fonts/barlow-700-latin-ext.woff2',
  'fonts/barlow-400-latin.woff2',
  'fonts/barlow-500-latin.woff2',
  'fonts/barlow-600-latin.woff2',
  'fonts/barlow-700-latin.woff2',
  'fonts/playfair-display-latin-ext.woff2',
  'fonts/playfair-display-latin.woff2',
  'fonts/source-sans-3-latin-ext.woff2',
  'fonts/source-sans-3-latin.woff2',
  'fonts/gilda-display-latin-ext.woff2',
  'fonts/gilda-display-latin.woff2',
  'fonts/figtree-latin-ext.woff2',
  'fonts/figtree-latin.woff2'
];
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'themes.css',
  'themes.js',
  'app.js',
  'db.js',
  'sync.js',
  'manifest.webmanifest',
  'fonts/fonts.css',
  'agenda-core.js',
  'logo.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  ...FONTS
];

// `cache: 'reload'` : chaque fichier vient du serveur, pas du cache HTTP du navigateur (GitHub Pages
// le garde 10 min), sinon la nouvelle version pouvait mêler un ancien db.js et un nouvel app.js.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
