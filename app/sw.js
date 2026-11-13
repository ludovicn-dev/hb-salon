// Hors-ligne : l'appli est servie depuis le cache de sa version, installé d'un bloc.
// Changer CACHE à chaque nouvelle version : c'est la seule façon dont la tablette se met à jour.

const CACHE = 'hb-salon-v33';
// Réglages gardés d'une version à l'autre : fond du thème choisi, écrit par l'appli (applyTheme).
const PREFS = 'hb-salon-prefs';
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PREFS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Depuis le cache, jamais réécrit fichier par fichier : une mise à jour en arrière-plan mêlait deux
// versions (nouvel app.js, ancien db.js) si le réseau coupait avant l'installation de la suivante.
// Le réseau ne sert que pour ce qui n'est pas dans SHELL.
async function fromCache(request) {
  const cached = await (await caches.open(CACHE)).match(request, { ignoreSearch: true });
  return cached || fetch(request);
}

// Manifeste aux couleurs du thème choisi : Android peint sa couleur de fond sous l'appli (ouverture du
// clavier, geste qui ferme l'appli). Restée bleu nuit, elle apparaissait sous un thème clair.
async function themedManifest(request) {
  const res = await fromCache(request);
  const bg = await (await caches.open(PREFS)).match('theme-bg');
  if (!res?.ok || !bg) return res;
  try {
    const color = (await bg.text()).trim();
    const manifest = await res.clone().json();
    if (/^#[0-9a-f]{3,8}$/i.test(color)) Object.assign(manifest, { background_color: color, theme_color: color });
    return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/manifest+json' } });
  } catch (err) {
    return res;
  }
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(url.pathname.endsWith('/manifest.webmanifest') ? themedManifest(request) : fromCache(request));
});
