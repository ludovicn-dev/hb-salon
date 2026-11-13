// Thèmes : chaque thème a son bloc de variables, toutes ses couleurs, et des contrastes lisibles.
// node --test "tests/*.test.js"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEMES, DEFAULT_THEME, BASE_THEME } from '../app/themes.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const STYLES = read('../app/styles.css');
const THEMES_CSS = read('../app/themes.css');

const selectorOf = (id) => (id === BASE_THEME ? `:root, [data-theme="${id}"]` : `[data-theme="${id}"]`);
const sourceOf = (id) => (id === BASE_THEME ? STYLES : THEMES_CSS);

// Déclarations « --nom: valeur; » du bloc dont le sélecteur est exactement `selector`, ou null sans bloc.
function tokensOf(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|[}\\n])\\s*${esc}\\s*\\{([^}]*)\\}`));
  if (!m) return null;
  const out = {};
  for (const [, name, value] of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => '#' + hex(a).map((v, i) => Math.round(v * (1 - t) + hex(b)[i] * t).toString(16).padStart(2, '0')).join('');
const lum = (h) => {
  const c = hex(h).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

// Couleurs d'un thème : Élégance, puis le bloc du thème par-dessus ; --appt-bg dérivé comme dans styles.css.
function paletteOf(id) {
  const t = { ...tokensOf(STYLES, selectorOf(BASE_THEME)), ...tokensOf(sourceOf(id), selectorOf(id)) };
  if (!t['--appt-bg']) t['--appt-bg'] = mix(t['--panel-2'], t['--line-2'], 0.25);
  return t;
}

const REQUIRED = [
  '--bg', '--panel', '--panel-2', '--line', '--line-2', '--control-line', '--control-line-2',
  '--text', '--text-2', '--muted', '--placeholder', '--accent', '--accent-hi', '--accent-fill',
  '--accent-fill-hi', '--on-accent', '--warn-bg', '--error', '--scrim', '--logo-1', '--logo-2', '--welcome-bg',
];

// [texte, fond, seuil] : textes à 4,5:1 (7:1 pour le texte principal), bords et pictogrammes à 3:1.
const PAIRS = [
  ...['--bg', '--panel', '--panel-2', '--appt-bg', '--warn-bg'].map((b) => ['--text', b, 7]),
  ...['--bg', '--panel', '--appt-bg'].map((b) => ['--text-2', b, 4.5]),
  ...['--bg', '--panel', '--panel-2'].map((b) => ['--muted', b, 4.5]),
  ...['--bg', '--panel', '--panel-2'].map((b) => ['--accent', b, 4.5]),
  ['--accent', '--appt-bg', 3],
  ['--on-accent', '--accent-fill', 4.5],
  ...['--bg', '--warn-bg', '--panel'].map((b) => ['--error', b, 4.5]),
  ['--error', '--appt-bg', 3],
  ['--bg', '--error', 4.5],
  ['--line-2', '--bg', 3],
  ['--control-line', '--bg', 3],
  ['--control-line', '--panel', 3],
  ['--control-line-2', '--panel-2', 3],
  ['--placeholder', '--panel', 3],
  ['--placeholder', '--bg', 3],
];

test('la liste commence par le thème par défaut, sans doublon', () => {
  assert.equal(THEMES[0].id, DEFAULT_THEME);
  assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
});

// Le thème par défaut vaut dès le premier affichage : posé sur <html>, et ses couleurs dans la barre
// d'Android et le manifeste (fond peint par Android au lancement, sous le clavier).
test('le thème par défaut est posé d’office, couleurs comprises', () => {
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('../app/manifest.webmanifest', import.meta.url), 'utf8'));
  const bg = paletteOf(DEFAULT_THEME)['--bg'].toLowerCase();
  assert.match(html, new RegExp(`<html[^>]*data-theme="${DEFAULT_THEME}"`));
  assert.equal(html.match(/name="theme-color" content="([^"]+)"/)[1].toLowerCase(), bg);
  assert.equal(manifest.background_color.toLowerCase(), bg);
  assert.equal(manifest.theme_color.toLowerCase(), bg);
});

test('chaque thème de THEMES a son bloc', () => {
  for (const { id } of THEMES) assert.ok(tokensOf(sourceOf(id), selectorOf(id)), `bloc ${selectorOf(id)} absent`);
});

test('chaque bloc de thème déclare toutes ses couleurs', () => {
  for (const { id } of THEMES) {
    const own = tokensOf(sourceOf(id), selectorOf(id)) || {};
    const missing = REQUIRED.filter((name) => !own[name]);
    assert.deepEqual(missing, [], `${id} : jetons manquants`);
  }
});

for (const { id } of THEMES) {
  test(`contrastes de ${id}`, () => {
    const t = paletteOf(id);
    const fails = PAIRS.filter(([a, b]) => /^#[0-9a-f]{6}$/i.test(t[a]) && /^#[0-9a-f]{6}$/i.test(t[b]))
      .map(([a, b, min]) => [a, b, min, ratio(t[a], t[b])])
      .filter(([, , min, r]) => r < min)
      .map(([a, b, min, r]) => `${a} sur ${b} : ${r.toFixed(2)} (< ${min})`);
    const notHex = PAIRS.flat().filter((x) => typeof x === 'string' && !/^#[0-9a-f]{6}$/i.test(t[x] || ''));
    assert.deepEqual([...new Set(notHex)], [], `${id} : couleurs à écrire en #rrggbb`);
    assert.deepEqual(fails, [], `${id} : contrastes insuffisants`);
  });
}

// Polices : chaque famille des thèmes est déclarée, et chaque fichier existe et part dans le cache hors ligne.
const FONTS_CSS = read('../app/fonts/fonts.css');
const SW = read('../app/sw.js');
const firstFamily = (stack) => stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '');

test('chaque police des thèmes est déclarée', () => {
  const declared = new Set([...FONTS_CSS.matchAll(/font-family:\s*['"]?([^;'"]+)['"]?;/g)].map((m) => m[1].trim()));
  const missing = new Set();
  for (const { id } of THEMES) {
    const t = paletteOf(id);
    for (const name of ['--serif', '--sans']) if (!declared.has(firstFamily(t[name]))) missing.add(firstFamily(t[name]));
  }
  assert.deepEqual([...missing], [], 'familles sans @font-face dans fonts.css');
});

test('chaque fichier de police existe et part en cache', () => {
  const files = [...FONTS_CSS.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/['"]/g, ''));
  assert.ok(files.length > 0);
  for (const f of files) {
    assert.doesNotThrow(() => readFileSync(new URL(`../app/fonts/${f}`, import.meta.url)), `fonts/${f} absent`);
    assert.ok(SW.includes(`'fonts/${f}'`), `fonts/${f} absent de la liste FONTS de sw.js`);
  }
});

// Le service worker s'exécute et sa liste d'installation contient l'appli, les thèmes et toutes les polices.
test('le service worker met en cache l’appli, les thèmes et les polices', async () => {
  const vm = await import('node:vm');
  const ctx = vm.createContext({ self: { addEventListener() {} } });
  vm.runInContext(readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8'), ctx);
  const shell = vm.runInContext('SHELL', ctx);
  for (const f of ['./', 'index.html', 'styles.css', 'themes.css', 'themes.js', 'app.js', 'fonts/fonts.css', 'logo.svg']) {
    assert.ok(shell.includes(f), `${f} absent de SHELL`);
  }
  const files = [...FONTS_CSS.matchAll(/url\(([^)]+)\)/g)].map((m) => `fonts/${m[1].replace(/['"]/g, '')}`);
  assert.deepEqual(files.filter((f) => !shell.includes(f)), [], 'polices absentes de SHELL');
});

// Icônes : celles du manifeste et du favicon existent et partent en cache sous la même adresse
// (une adresse à part, comme ?v=…, n'était pas dans SHELL et ne faisait pas changer l'icône).
test('les icônes du manifeste et du favicon existent et sont dans SHELL', async () => {
  const vm = await import('node:vm');
  const ctx = vm.createContext({ self: { addEventListener() {} } });
  vm.runInContext(readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8'), ctx);
  const shell = vm.runInContext('SHELL', ctx);
  const manifest = JSON.parse(readFileSync(new URL('../app/manifest.webmanifest', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const srcs = [...manifest.icons.map((i) => i.src), ...[...html.matchAll(/<link rel="(?:icon|apple-touch-icon)" href="([^"]+)"/g)].map((m) => m[1])];
  assert.ok(manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512'));
  for (const src of srcs) {
    assert.doesNotThrow(() => readFileSync(new URL(`../app/${src}`, import.meta.url)), `${src} absent`);
    assert.ok(shell.includes(src), `${src} absent de SHELL`);
  }
});

// Relecture finale : un thème déclare aussi son ton (color-scheme), le bouton enfoncé reste lisible,
// chaque fichier de l'installation hors ligne existe, et les polices redistribuées ont leur licence.
test('chaque bloc de thème déclare son ton clair ou sombre', () => {
  for (const { id } of THEMES) {
    const css = sourceOf(id).replace(/\r/g, '');
    const esc = selectorOf(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = css.match(new RegExp(`(?:^|[}\\n])\\s*${esc}\\s*\\{([^}]*)\\}`))?.[1] || '';
    assert.match(block, /color-scheme:\s*(light|dark);/, `${id} : color-scheme absent`);
  }
});

test('le texte du bouton principal enfoncé reste lisible', () => {
  for (const { id } of THEMES) {
    const t = paletteOf(id);
    assert.ok(ratio(t['--on-accent'], t['--accent-fill-hi']) >= 4.5, `${id} : --on-accent sur --accent-fill-hi ${ratio(t['--on-accent'], t['--accent-fill-hi']).toFixed(2)}`);
  }
});

test('chaque fichier de l’installation hors ligne existe', async () => {
  const vm = await import('node:vm');
  const ctx = vm.createContext({ self: { addEventListener() {} } });
  vm.runInContext(readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8'), ctx);
  for (const f of vm.runInContext('SHELL', ctx).filter((x) => x !== './')) {
    assert.doesNotThrow(() => readFileSync(new URL(`../app/${f}`, import.meta.url)), `${f} absent du disque`);
  }
});

test('les polices redistribuées ont leur licence', () => {
  const lic = readFileSync(new URL('../app/fonts/LICENCES.txt', import.meta.url), 'utf8');
  const families = new Set([...FONTS_CSS.matchAll(/font-family:\s*['"]?([^;'"]+)['"]?;/g)].map((m) => m[1].trim()));
  for (const f of families) assert.ok(lic.includes(`== ${f} ==`), `${f} : licence absente`);
  assert.match(lic, /SIL OPEN FONT LICENSE/);
});
