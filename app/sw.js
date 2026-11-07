// Hors-ligne : l'appli est servie depuis le cache, puis mise à jour en arrière-plan.
// Changer CACHE à chaque nouvelle version pour forcer la mise à jour sur la tablette.

const CACHE = 'hb-salon-v10';
const FONTS = ['cormorant', 'manrope'].flatMap((f) => [
  `fonts/${f}-latin.woff2`,
  `fonts/${f}-latin-ext.woff2`
]);
const SHELL = [
  './',
  'index.html',
  'styles.css',
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

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
