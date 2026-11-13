import * as db from './db.js';
import * as sync from './sync.js';
import * as core from './agenda-core.js';
import { THEMES, DEFAULT_THEME } from './themes.js';

const SERVICES = ['Coupe & coiffage', 'Coloration', 'Lissage', 'Soin', 'Barbe', 'Massage', 'Visagiste', 'Diagnostic'];
const CLIENT_IDLE_MS = 2 * 60 * 1000;
const COIFFEUR_IDLE_MS = 10 * 60 * 1000; // verrouillage automatique de l'espace coiffeur
const IDLE_WARN_MS = 20000; // avertissement affiché avant le retour à l'accueil
const THANKS_MS = 10000;
const VALIDATED_MS = 5000; // ligne « X a validé sa fiche » à l'accueil du coiffeur
const MAX_PHOTOS = 3;
const PIN_MAX_TRIES = 5;
const PIN_LOCKOUT_MS = 30000;
// Code de déblocage (PIN oublié) : seule son empreinte est ici, le code est connu de l'installateur.
// PBKDF2 lent, car ce fichier est public : 8 chiffres se retrouveraient en quelques secondes avec un simple SHA-256.
const RECOVERY_LEN = 8;
const RECOVERY_SALT = '27faf786c65542d95332e3fdebbf6741';
const RECOVERY_ITER = 600000;
const RECOVERY_HASH = 'b73d8f71bf3199a7da440c6e2efe2a794fbe07f730a6b426b6002eaddf791b06';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const app = document.getElementById('app');

const S = {
  view: 'boot',
  theme: DEFAULT_THEME, // thème choisi dans les Réglages (applyTheme)
  pin: null, // { mode: 'unlock' | 'new' | 'confirm' | 'recover', entry, first, error, hint, recovered, next, cancel }
  pinFails: 0,
  pinLockedUntil: 0,
  query: '',
  clients: [],
  lastVisit: new Map(), // clientId -> date ISO
  pending: new Map(), // clientId -> nombre de visites non validées
  drafts: new Map(), // clientId -> { draft, stash } : visites en cours des autres clients
  savedDrafts: new Map(), // clientId -> brouillon du jour retrouvé sur la tablette après une fermeture de l'appli
  clientId: null,
  client: null,
  tab: 'visit',
  history: [],
  lastFormula: null, // { formula, date }
  draft: null, // { services: Set, formula, note, photos: [{ id?, blob, thumb, url }], editId?, editDate?, removed: [] }
  stash: null, // brouillon du jour mis de côté pendant la modification d'une visite
  draftError: '',
  photoBusy: false,
  saving: false, // visite en cours d'enregistrement : un second appui ne la double pas
  handedVisit: null, // visite entre les mains du client
  handedNext: null, // prochain rendez-vous de ce client (à partir de demain), montré sur son écran
  thanksNext: null, // le même, rappelé sur « Merci »
  checkout: null, // saisie du client, gardée si l'écran est redessiné
  thanksName: '',
  thanksNote: '',
  notices: [], // { text, visitId?, clientId?, sync?, action?, label? } : restent affichés au coiffeur jusqu'à « Compris »
  autoLocked: false,
  photoCache: new Map(), // visitId -> photos (miniatures de l'historique)
  idleReturn: null, // élément à refocaliser après « Je continue »
  validated: null, // { name, at } : dernier client qui a validé sa fiche, rappelé à l'accueil jusqu'à la fiche suivante
  upcoming: null, // prochain rendez-vous à venir, tous clients (accueil d'une journée sans rendez-vous)
  space: 'today', // espace coiffeur : 'today' | 'agenda' (gardé au verrouillage)
  week: null, // lundi de la semaine affichée dans l'agenda
  weekAppts: [], // rendez-vous de cette semaine
  moving: null, // { id, name, error } : rendez-vous à déplacer, en attente du nouveau créneau
  note: null, // { text, undo? } : dernier message de l'agenda, effacé à l'action suivante
  flash: null, // id du rendez-vous qui vient d'être noté ou déplacé (il luit un instant)
  refused: null, // sélecteur du créneau touché en vain pendant un déplacement (il luit en corail)
  nextAppt: null, // prochain rendez-vous du client affiché
  todayAppts: [], // rendez-vous du jour (accueil de l'espace coiffeur)
  todayVisits: new Map(), // clientId -> visite du jour (celle « à valider » d'abord, sinon la dernière validée)
  lockedModal: null, // fenêtre ouverte au verrouillage automatique, rouverte après le code
  modal: null, // { type: 'client' | 'backup' | 'confirm-delete' | 'photo' | 'appt' | ..., ... }
  modalReturn: null // élément à refocaliser à la fermeture
};

let timer = null;
let idleTicker = null;
let validatedTimer = null;
let lockTicker = null;
let toastTimer = null;
let announceTimer = null;
let pinnedUrls = [];

// ---------- Utilitaires ----------

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const digits = (s) => String(s ?? '').replace(/\D/g, '');

// Numéros calédoniens (6 chiffres) à la façon locale, 98.62.13 ; numéros de métropole en 06 12 34 56 78.
function fmtPhone(p) {
  const d = digits(p);
  if (d.length === 6) return d.replace(/(\d\d)(?=\d)/g, '$1.');
  if (d.length === 9 && d.startsWith('687')) return `+687 ${fmtPhone(d.slice(3))}`;
  if ([8, 10].includes(d.length)) return d.replace(/(\d\d)(?=\d)/g, '$1 ');
  return p || '';
}

const hasName = (c) => Boolean(c?.firstName || c?.lastName);
const fullName = (c) => [c?.firstName, c?.lastName].filter(Boolean).join(' ') || 'Client sans nom';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Nom tapé tout en minuscules dans la recherche : repris avec ses majuscules (« zoé dupont » -> « Zoé Dupont »).
const capName = (s) => (s === s.toLowerCase() ? s.replace(/(^|[\s'’-])\p{L}/gu, (x) => x.toUpperCase()) : s);
// Fin de ligne propre : « 11 novembre » et « il y a 3 sem. » ne se coupent pas, et le point médian
// reste au bout de la ligne au lieu d'ouvrir la suivante.
const nb = (s) => s.replaceAll(' ', '\u00a0');
const nbDay = (s) => s.replace(/(\d) (?=\p{L})/u, '$1\u00a0');
const SEP = '\u00a0· ';
const fmtToday = () => cap(nbDay(new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())));
// Forme courte (« Mer. 30 sept. ») quand la barre du haut manque de place.
const fmtTodayShort = () => cap(nbDay(new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date())));
const fmtDay = (iso) => nbDay(new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(new Date(iso)));
const fmtDayShort = (iso) => nbDay(new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(iso)));
const fmtDateMid = (iso) => nbDay(new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)));
const fmtDateLong = (iso) => cap(fmtDateMid(iso));
const fmtTime = (iso) => new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(':', ' h ');
const fmtClock = () => fmtTime(new Date().toISOString());

// Forme courte de la liste des clients, mêmes arrondis que la fiche (agenda-core).
function ago(iso) {
  const start = new Date(iso);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return nb(core.agoText(Math.round((today - start) / 86400000), true));
}

const hasFormula = (f) => f && Object.values(f).some((v) => String(v).trim());

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const hashPin = (pin) => sha256('hb-salon:' + pin);

async function hashRecovery(code) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(RECOVERY_SALT), iterations: RECOVERY_ITER },
    key,
    256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function objUrl(blob) {
  const url = URL.createObjectURL(blob);
  pinnedUrls.push(url);
  return url;
}

function toJpeg(bitmap, max) {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
}

// Photo pleine taille (1600 px) + miniature (320 px) pour l'historique.
async function readPhoto(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const [blob, thumb] = await Promise.all([toJpeg(bitmap, 1600), toJpeg(bitmap, 320)]);
    if (!blob) throw new Error('photo illisible');
    return { blob, thumb };
  } finally {
    bitmap.close?.();
  }
}

// Annonce aux lecteurs d'écran via une zone stable, hors des écrans redessinés.
// Le texte est vidé ensuite pour ne pas être relu hors de son contexte.
function announce(message) {
  const el = document.getElementById('announce');
  el.textContent = '';
  requestAnimationFrame(() => (el.textContent = message));
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => (el.textContent = ''), 1500);
}

function hideToast() {
  const el = document.getElementById('toast');
  el.classList.remove('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.textContent = ''), 300);
}

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 3200);
}

// Sélecteur stable d'un élément, pour lui rendre le focus après un nouveau rendu.
const KEY_ATTRS = ['id', 'name', 'data-bind', 'data-action', 'data-tab', 'data-service', 'data-id', 'data-key', 'data-visit', 'data-index', 'data-start'];
function selectorOf(el) {
  if (!el || el === document.body || !app.contains(el)) return null;
  const parts = KEY_ATTRS.filter((a) => el.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(el.getAttribute(a))}"]`);
  return parts.length ? parts.join('') : null;
}

// ---------- Icônes ----------

const ICONS = {
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  key: '<circle cx="8" cy="14" r="4"/><path d="M11 11l9-9M16 6l3 3"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  del: '<path d="M21 5H9l-6 7 6 7h12z"/><path d="M12 9l6 6M18 9l-6 6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  tablet: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M11 18h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10.5 3.75 3.75 0 0 1 17.25 18z"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M14 10h4M14 14h4M5.5 16.5c.8-1.4 2-2 3.5-2s2.7.6 3.5 2"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  cloudOff: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10.5 3.75 3.75 0 0 1 17.25 18z"/><path d="M4 4l16 16"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
};

const icon = (name, size = 20) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// Le vrai logo du salon, redessiné en vectoriel : logo.svg sert de masque, peint par le dégradé du thème.
const logo = (size = 'sm') => `<span class="logo logo-${size}" role="img" aria-label="H&amp;B Salon"></span>`;

// ---------- Thème ----------

// Pose le thème sur <html> (data-theme) et colore la barre d'Android. Un thème inconnu (retiré depuis) revient
// au thème par défaut (Barbier) et sort du stockage. Avec save, le choix est gardé : index.html le reprend au lancement.
function applyTheme(id, { save = false } = {}) {
  const known = THEMES.some((t) => t.id === id);
  const theme = known ? id : DEFAULT_THEME;
  document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  // Le service worker en fait la couleur de fond du manifeste (celle qu'Android peint sous l'appli).
  // Chrome la reprend à sa prochaine vérification de l'appli installée, pas dans l'instant.
  globalThis.caches?.open('hb-salon-prefs').then((c) => c.put('theme-bg', new Response(bg))).catch(() => {});
  try {
    if (save) {
      localStorage.setItem('hb-theme', theme);
      localStorage.setItem('hb-theme-bg', bg);
    } else if (!known) {
      localStorage.removeItem('hb-theme');
      localStorage.removeItem('hb-theme-bg');
    }
  } catch (e) {
    // Stockage indisponible : le thème vaut pour cette séance seulement.
  }
  S.theme = theme;
  return theme;
}

// Réglages : une vignette par thème ; son aperçu porte son propre data-theme et se peint avec ses couleurs.
function viewThemePicker() {
  const tile = (t) => {
    const on = t.id === S.theme;
    return `<button type="button" class="theme-tile" role="radio" aria-checked="${on}" data-action="set-theme" data-id="${t.id}"${on ? ' data-autofocus' : ''}>
        <span class="theme-prev" data-theme="${t.id}" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="theme-name">${on ? icon('check', 16) : ''}${esc(t.name)}</span>
      </button>`;
  };
  return `
        <section class="dlg-section dlg-section-first" aria-labelledby="sec-theme">
          <h3 id="sec-theme">Thème de l’appli</h3>
          <p class="muted small">Couleurs et ambiance de l’espace coiffeur et de l’écran client. Le changement se voit tout de suite.</p>
          <div class="theme-grid" role="radiogroup" aria-labelledby="sec-theme">${THEMES.map(tile).join('')}</div>
        </section>`;
}

// Champ de formulaire avec emplacement pour son message d'erreur.
const inputField = (cls, name, label, type, value, extra = '') =>
  `<label class="${cls}">${label}<input name="${name}" type="${type}" value="${esc(value)}" aria-describedby="err-${name}" ${extra}><span class="field-err" id="err-${name}" aria-hidden="true"></span></label>`;

// ---------- Navigation ----------

function go(view) {
  clearTimeout(timer);
  clearInterval(idleTicker);
  // Les messages de l'espace coiffeur ne suivent pas la tablette chez le client.
  if (view !== 'coiffeur') hideToast();
  S.view = view;
  S.modal = null;
  render();
  if (view === 'client' || view === 'coiffeur' || view === 'pin') bumpIdle();
  if (view === 'thanks') timer = setTimeout(() => go('welcome'), THANKS_MS);
}

// Fenêtre ouverte au moment du verrouillage automatique (fiche en cours de saisie, rendez-vous) :
// elle est rouverte telle quelle après le code, avec ce qui était tapé.
function heldModal() {
  const m = S.modal;
  if (m?.type === 'appt') return m;
  if (m?.type !== 'client') return null;
  const form = app.querySelector('[data-form="client"]');
  return { ...m, client: { ...m.client, ...(form ? Object.fromEntries(new FormData(form)) : {}) } };
}

function bumpIdle() {
  // « Changer le code » fait partie de l'espace coiffeur : son « Annuler » y ramène sans code,
  // il se verrouille donc au bout du même délai.
  if (S.view === 'coiffeur' || (S.view === 'pin' && S.pin?.inside)) {
    clearTimeout(timer);
    // La visite en cours est gardée.
    timer = setTimeout(() => {
      S.autoLocked = true;
      S.lockedModal = heldModal();
      go('welcome');
    }, COIFFEUR_IDLE_MS);
    return;
  }
  if (S.view !== 'client') return;
  clearTimeout(timer);
  clearInterval(idleTicker);
  const warn = app.querySelector('.idle-warn');
  if (warn) {
    warn.remove();
    const back = S.idleReturn && app.querySelector(S.idleReturn);
    (back || app.querySelector('h1'))?.focus({ preventScroll: true });
  }
  timer = setTimeout(warnIdle, CLIENT_IDLE_MS - IDLE_WARN_MS);
}

// Le décompte visible n'est pas relu chaque seconde : seule la phrase de départ est annoncée.
function warnIdle() {
  let left = IDLE_WARN_MS / 1000;
  S.idleReturn = selectorOf(document.activeElement);
  app.insertAdjacentHTML(
    'beforeend',
    `<div class="idle-warn">
      <span class="sr-only" role="alert">Toujours là ? L’écran va se fermer dans ${left} secondes.</span>
      <span aria-hidden="true">Toujours là ? L’écran va se fermer dans <span class="count">${left}</span> secondes.</span>
      <button type="button" class="btn btn-accent" data-action="stay">Je continue</button>
    </div>`
  );
  idleTicker = setInterval(() => {
    left--;
    const count = app.querySelector('.idle-warn .count');
    if (count && left > 0) count.textContent = left;
  }, 1000);
  timer = setTimeout(() => {
    clearInterval(idleTicker);
    go('welcome');
  }, IDLE_WARN_MS);
}

function askPin(next, cancel) {
  S.pin = { mode: 'unlock', entry: '', first: '', error: '', next, cancel };
  go('pin');
}

function openModal(modal) {
  hideToast();
  S.modalReturn = selectorOf(document.activeElement);
  S.modal = modal;
  render();
}

function closeModal() {
  const back = S.modalReturn;
  S.modal = null;
  S.modalReturn = null;
  render({ focus: back });
}

// ---------- Rendu ----------

const SCROLLERS = ['.detail', '.side', '.results', '.coiffeur-body', '.client', '.client-form', '.dialog', '.agenda', '.day-scroll', '.week-scroll'];

// Rendez-vous qui vient d'être noté, déplacé ou rétabli : ramené en vue s'il est caché dans la zone qui défile.
function revealFlash() {
  const el = app.querySelector('.appt-block.flash');
  const box = el?.closest('.week-scroll, .day-scroll');
  if (!box) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const margin = 12;
  if (r.top < b.top + margin) box.scrollTop -= b.top + margin - r.top;
  else if (r.bottom > b.bottom - margin) box.scrollTop += Math.min(r.bottom - b.bottom + margin, r.top - b.top - margin);
}

// Redessine l'écran en gardant la position de défilement et le focus (sauf changement d'écran).
function render({ top = false, focus = null } = {}) {
  const same = app.dataset.view === S.view;
  const fromBoot = !app.dataset.view; // premier rendu : index.html montrait déjà le logo
  // data-autofocus ne joue qu'à l'arrivée sur un écran ou à l'ouverture d'une fenêtre : redessiner la fenêtre
  // (prestation cochée…) ne doit pas refocaliser le champ, sinon le clavier Android revient masquer l'écran.
  const arriving = !same || (S.modal?.type || '') !== (app.dataset.modal || '');
  const scrolls = same ? SCROLLERS.map((sel) => app.querySelector(sel)?.scrollTop ?? 0) : null;
  const active = same && !focus ? selectorOf(document.activeElement) : null;
  if (S.modal?.type === 'photo') {
    URL.revokeObjectURL(S.modal.url);
    S.modal = null;
  }

  pinnedUrls.forEach((u) => URL.revokeObjectURL(u));
  pinnedUrls = [];
  const views = { welcome: viewWelcome, pin: viewPin, coiffeur: viewCoiffeur, client: viewClient, thanks: viewThanks };
  app.innerHTML = (views[S.view] || (() => ''))() + (S.modal ? viewModal() : '');
  app.dataset.view = S.view;
  // Fondu d'arrivée seulement à l'ouverture d'une fenêtre, pas quand on la redessine (erreur, état de la sauvegarde…).
  if (S.modal && S.modal.type !== app.dataset.modal) app.querySelector(':scope > .overlay')?.classList.add('enter');
  app.dataset.modal = S.modal?.type || '';
  // Bienvenue / Merci : apparition lente à l'arrivée seulement, pas quand l'écran est redessiné (sauvegarde…).
  if (!same) app.querySelector(':scope > .welcome')?.classList.add('enter', ...(fromBoot ? ['boot'] : []));
  if (S.refused) app.querySelector(S.refused)?.classList.add('refuse');
  if (S.view === 'coiffeur' || S.view === 'client') saveDraftsSoon();

  if (scrolls) {
    SCROLLERS.forEach((sel, i) => {
      const el = app.querySelector(sel);
      if (el && !(top && sel === '.detail')) el.scrollTop = scrolls[i];
    });
  }
  if (S.flash) revealFlash();
  if (S.modal) app.firstElementChild.inert = true;
  hydratePhotos();
  // Titres focalisables par script : à l'arrivée sur un écran, le focus va au titre.
  app.querySelectorAll('h1').forEach((h) => (h.tabIndex = -1));
  const wanted = focus || active;
  const target =
    (arriving && !focus ? app.querySelector('[data-autofocus]') : null) ||
    (wanted ? app.querySelector(wanted) : null) ||
    (same ? null : app.querySelector('h1')) ||
    // L'élément qui avait le focus a disparu de la fenêtre : on se rabat sur un bouton, jamais sur un champ.
    (S.modal ? app.querySelector('.overlay [data-autofocus]:not(input):not(textarea)') : null);
  target?.focus({ preventScroll: true });
}

function viewWelcome() {
  return `
  <main class="welcome">
    ${logo('xl')}
    <h1 class="serif">Bienvenue</h1>
    ${S.autoLocked ? `<p class="muted corner-left">${icon('lock', 16)} Espace coiffeur verrouillé après 10 minutes sans activité</p>` : ''}
    <button type="button" class="btn btn-ghost corner" data-action="unlock">${icon('lock', 18)} Espace coiffeur</button>
  </main>`;
}

const PIN_TEXT = {
  unlock: ['Espace coiffeur', 'Entrez votre code'],
  new: ['Nouveau code', 'Choisissez un code à 4 chiffres'],
  confirm: ['Nouveau code', 'Confirmez le code'],
  recover: ['Code oublié', 'Entrez le code de déblocage à 8 chiffres. Demandez-le à la personne qui a installé l’appli.']
};

const lockLeft = () => Math.ceil((S.pinLockedUntil - Date.now()) / 1000);
const lockMsg = (s) => `Clavier bloqué après trop d’essais. Réessayez dans ${s} s.`;

function viewPin() {
  const p = S.pin;
  const [title, defaultSub] = PIN_TEXT[p.mode];
  const sub = p.recovered && p.mode === 'new' ? 'Code de déblocage accepté. Choisissez votre nouveau code à 4 chiffres.' : defaultSub;
  const len = p.mode === 'recover' ? RECOVERY_LEN : 4;
  const locked = Date.now() < S.pinLockedUntil;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const dis = locked || p.checking ? ' disabled' : '';
  const dots = Array.from({ length: len }, (_, i) => `<span class="dot${i < p.entry.length ? ' on' : ''}"></span>`).join('');
  const showCancel = p.cancel || p.mode === 'recover';
  return `
  <main class="pin">
    ${logo('md')}
    <h1 class="serif">${title}</h1>
    <p class="muted pin-sub">${sub}</p>
    ${p.hint && p.mode !== 'recover' ? `<p class="muted small pin-sub">${p.hint}</p>` : ''}
    ${p.mode === 'recover' ? '<p class="muted small pin-sub">Vos fiches et votre agenda ne bougent pas : seul le code change.</p>' : ''}
    <div class="dots${len > 4 ? ' dots-long' : ''}" aria-hidden="true">${dots}</div>
    <p class="err${p.checking ? ' is-busy' : ''}">${p.checking ? 'Vérification du code…' : esc(locked ? lockMsg(lockLeft()) : p.error)}</p>
    <div class="keypad">
      ${keys.map((k) => `<button type="button" class="key" data-action="pin-key" data-key="${k}"${dis}>${k}</button>`).join('')}
      ${showCancel ? `<button type="button" class="key key-text" data-action="pin-cancel">Annuler</button>` : '<span></span>'}
      <button type="button" class="key" data-action="pin-key" data-key="0"${dis}>0</button>
      <button type="button" class="key key-text" data-action="pin-back" aria-label="Effacer"${dis}>${icon('del', 26)}</button>
    </div>
    ${p.mode === 'unlock' ? `<button type="button" class="link" data-action="pin-forgot">Code oublié ?</button>` : ''}
  </main>`;
}

function viewCoiffeur() {
  return `
  <div class="coiffeur">
    <header class="topbar">
      <div class="brand">${logo('sm')}<span class="muted brand-label">Espace coiffeur</span>
        <div class="space-switch" role="group" aria-label="Affichage">
          <button type="button" class="space-btn" data-action="space" data-space="today" aria-pressed="${S.space === 'today'}">${icon('home', 22)} Aujourd’hui</button>
          <button type="button" class="space-btn" data-action="space" data-space="agenda" aria-pressed="${S.space === 'agenda'}">${icon('calendar', 22)} Agenda</button>
        </div>
      </div>
      <p class="today"><span class="today-date"><span class="date-long">${fmtToday()}</span><span class="date-short">${fmtTodayShort()}</span></span><span class="clock" id="clock">${fmtClock()}</span></p>
      <div class="top-actions">
        <button type="button" class="${backupClass()}" data-action="backup" id="backup-btn">${backupLabel()}</button>
        <button type="button" class="btn btn-ghost btn-icon" data-action="settings" aria-label="Réglages" title="Réglages">${icon('gear', 22)}</button>
        <button type="button" class="btn btn-ghost lock-btn" data-action="lock" title="Verrouiller">${icon('lock', 18)}<span class="lock-label"> Verrouiller</span></button>
      </div>
    </header>
    ${
      S.space === 'agenda'
        ? `<main class="agenda">${viewAgenda()}</main>`
        : `<div class="coiffeur-body">
      <aside class="side">
        <label for="search" class="label">Client</label>
        <div class="search">
          ${icon('search', 18)}
          <input id="search" type="search" data-search placeholder="Nom ou téléphone…" value="${esc(S.query)}" autocomplete="off">
          <button type="button" class="search-clear" data-action="clear-search" aria-label="Effacer la recherche">${icon('x', 18)}</button>
        </div>
        <div id="results" class="results">${viewResults()}</div>
        <button type="button" class="btn-new" data-action="new-client">${icon('plus', 18)} Nouveau client</button>
      </aside>
      <main class="detail">${viewNotices()}${S.client ? viewClientDetail() : viewTodayPlan()}</main>
    </div>`
    }
  </div>`;
}

// ---------- Agenda ----------

const fmtDayTitle = (iso) => cap(nbDay(new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso))));
const hasLetters = (s) => /\p{L}/u.test(s);
const MAX_CHOICES = 4;

async function loadToday() {
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  S.todayAppts = await db.appointmentsBetween(from.toISOString(), addDays(from, 1).toISOString());
  // Journée sans rendez-vous : l'accueil annonce le prochain (les deux mois qui viennent).
  const soon = S.todayAppts.length ? [] : await db.appointmentsBetween(d.toISOString(), addDays(from, 60).toISOString());
  S.upcoming = soon.sort((a, b) => a.start.localeCompare(b.start))[0] || null;
}
const refreshAppts = () => Promise.all([loadWeek(), loadToday(), loadNextAppt()]);
const findAppt = (id) => S.weekAppts.find((a) => a.id === id) || S.todayAppts.find((a) => a.id === id);

// Rendez-vous connus du jour de `iso` (semaine affichée et liste du jour).
function dayAppts(iso) {
  const day = new Date(iso).toDateString();
  const out = new Map();
  for (const a of [...S.weekAppts, ...S.todayAppts]) if (new Date(a.start).toDateString() === day) out.set(a.id, a);
  return [...out.values()];
}
const freeOf = (m) => core.freeUntil({ id: m.id, start: m.start }, dayAppts(m.start));

// Durée proposée : dernier rendez-vous passé du client aux mêmes prestations, sinon durée habituelle ;
// sans prestation, un trou plus court que la demi-heure est pris tel quel. Plus recalculée dès que
// le coiffeur l'a réglée lui-même.
function prefill(m) {
  if (m.durationSet) return;
  const nowIso = new Date().toISOString();
  const p = core.prefillDuration(apptServices(m), m.prev.filter((a) => a.id !== m.id && a.start < nowIso));
  m.duration = p.duration;
  m.from = p.from;
  m.fit = false;
  if (!m.id && !m.services.size) {
    const gap = freeOf(m).until - core.minutesOf(new Date(m.start));
    if (gap >= core.STEP_MIN && gap < m.duration) {
      m.duration = gap;
      m.fit = true;
    }
  }
}
const apptServices = (m) => SERVICES.filter((s) => m.services.has(s));

function newApptModal(startIso) {
  const m = { type: 'appt', start: startIso, duration: 30, durationSet: false, from: null, services: new Set(), query: '', clientId: null, other: false, firstName: '', prev: [], error: '', whoError: '' };
  prefill(m);
  return m;
}

async function openApptModal(a) {
  openModal({
    type: 'appt',
    id: a.id,
    start: a.start,
    duration: a.duration,
    durationSet: true,
    from: null,
    services: new Set(a.services),
    clientId: a.clientId,
    prev: a.clientId ? await db.appointmentsOf(a.clientId) : [],
    error: '',
    changed: false
  });
}

// Heure de fin et place libre, recalculées à chaque réglage ; en corail dès que ça ne tient plus.
function apptSpan(m) {
  const s = core.minutesOf(new Date(m.start));
  const end = s + m.duration;
  const { until, next, inside } = freeOf(m);
  let tail;
  let over = true;
  let late = false;
  if (inside) tail = `chevauche le rendez-vous de ${apptName(next)} à ${fmtTime(next.start)}`;
  else if (end > until && next) tail = `trop long, ${apptName(next)} arrive à ${fmtTime(next.start)}`;
  else if (end > core.CLOSE_MIN) {
    over = false;
    late = true;
    tail = 'après la fermeture de 18 h';
  }
  else {
    over = false;
    // Pile à la limite : on dit ce qui suit plutôt que « libre jusqu'à » l'heure de fin elle-même.
    if (until >= core.CLOSE_MIN) tail = end === core.CLOSE_MIN ? 'pile à la fermeture' : 'libre jusqu’à la fermeture';
    else tail = end === until ? `juste avant ${apptName(next)}` : `libre jusqu’à ${fmtMin(until)}`;
  }
  return { text: `Fin à ${fmtMin(end)} · ${tail}`, over, late };
}
const viewApptSpan = (m) => {
  const { text, over, late } = apptSpan(m);
  return `<p class="appt-span${over ? ' over' : late ? ' late' : ''}" id="appt-span">${esc(text)}</p>`;
};
// Annonce le réglage qui vient d'être fait, et le dépassement s'il y en a un.
function announceSpan(m, what) {
  const a = m.id && findAppt(m.id);
  const span = a && core.endOf(a) <= new Date() ? null : apptSpan(m);
  announce(span?.over || span?.late ? `${what}. ${span.text}` : what);
}

// Fiches trouvées annoncées quand la frappe se pose (pas à chaque chiffre).
let matchTimer = null;
function announceMatches(m) {
  clearTimeout(matchTimer);
  matchTimer = setTimeout(() => {
    if (S.modal !== m || digits(m.query).length < 2) return;
    const list = phoneMatches(m.query).slice(0, MAX_CHOICES);
    announce(
      list.length
        ? `${list.length > 1 ? `${list.length} fiches` : '1 fiche'} : ${list.map(fullName).join(', ')}. Touchez la bonne, ou Autre personne.`
        : 'Aucune fiche à ce numéro : tapez le prénom, une fiche sera créée.'
    );
  }, 800);
}

// Fiches au numéro tapé (dès 2 chiffres), les plus récentes d'abord ; +687 devant est ignoré.
const localDigits = (p) => {
  const d = digits(p);
  return d.length === 9 && d.startsWith('687') ? d.slice(3) : d;
};
function phoneMatches(query) {
  const qd = localDigits(query);
  if (qd.length < 2) return [];
  return S.clients.filter((c) => localDigits(c.phone).includes(qd)).sort(byRecent);
}
const phoneComplete = (query) => digits(query).length >= 6 && digits(query).length <= 15;

// Sous le téléphone et le prénom : fiches trouvées au numéro (et « Autre personne »), puis ce qui sera
// fait (fiche créée avec le numéro, ou rendez-vous au prénom seul, sans fiche), et l'allergie du client choisi.
function viewApptWho(m) {
  const matches = phoneMatches(m.query).slice(0, MAX_CHOICES);
  const chosen = m.clientId && S.clients.find((c) => c.id === m.clientId);
  const chip = (c) => `<button type="button" class="chip" data-action="appt-who" data-id="${c.id}" role="radio" aria-checked="${c.id === m.clientId}">
      <span>${esc(fullName(c))}</span>${c.phone ? `<small>${esc(fmtPhone(c.phone))}</small>` : ''}</button>`;
  let hint = '';
  if (!chosen && (m.other || !matches.length)) {
    if (!digits(m.query)) hint = 'Sans numéro, le rendez-vous est noté au prénom seul, sans créer de fiche.';
    else if (phoneComplete(m.query)) hint = 'Une fiche sera créée avec ce prénom et ce numéro ; le client la complétera à sa visite.';
  }
  return `
    ${
      matches.length
        ? `<div class="chips" role="radiogroup" aria-label="Fiches à ce numéro">
            ${matches.map(chip).join('')}
            <button type="button" class="chip chip-add" data-action="appt-other" role="radio" aria-checked="${Boolean(m.other)}">${icon('plus', 16)} Autre personne</button>
          </div>`
        : ''
    }
    ${hint ? `<p class="muted small">${hint}</p>` : ''}
    ${chosen?.allergies ? `<div class="allergy allergy-mini">${icon('alert', 18)}<p><strong>Allergies</strong> <span>${esc(chosen.allergies)}</span></p></div>` : ''}`;
}

function viewApptDur(m) {
  const hint = m.durationSet ? '' : m.fit ? 'tout le temps libre' : m.from ? `comme le ${fmtDayShort(m.from)}` : 'durée habituelle';
  return `
    <button type="button" class="btn btn-ghost btn-icon" data-action="appt-dur" data-step="-15" aria-label="Raccourcir de 15 minutes"${m.duration <= core.STEP_MIN ? ' disabled' : ''}>${icon('minus', 20)}</button>
    <output class="step-value">${core.fmtDuration(m.duration)}</output>
    <button type="button" class="btn btn-ghost btn-icon" data-action="appt-dur" data-step="15" aria-label="Allonger de 15 minutes">${icon('plus', 20)}</button>
    ${hint ? `<span class="muted small">${hint}</span>` : ''}`;
}

// Chaque action à côté de ce qu'elle touche : Déplacer près de l'heure, la fiche près du nom ;
// l'annulation seule à gauche, loin d'Enregistrer. Un rendez-vous terminé ne se déplace plus :
// on corrige ses prestations et sa durée réelle (elle sert de modèle pour les suivants), ou on le
// supprime (client pas venu), avec « Rétablir » comme pour une annulation.
function viewApptDialog(m) {
  const a = m.id ? findAppt(m.id) : null;
  const now = new Date();
  const done = a && core.endOf(a) <= now;
  const start = new Date(m.start);
  const min = core.minutesOf(start);
  const c = a && apptClient(a);
  const person = a
    ? `<div class="appt-person">
        <strong>${esc(apptName(a, true))}</strong>
        ${c?.phone || a.phone ? `<span class="muted">${esc(fmtPhone(c?.phone || a.phone))}</span>` : ''}
        <button type="button" class="btn btn-ghost btn-sm appt-open" data-action="appt-open">${icon(c ? 'card' : 'plus', 16)} ${c ? 'Ouvrir la fiche' : 'Créer la fiche'}</button>
      </div>
      ${c?.allergies ? `<div class="allergy allergy-mini">${icon('alert', 18)}<p><strong>Allergies</strong> <span>${esc(c.allergies)}</span></p></div>` : ''}`
    : `<div class="appt-ident">
        <label class="field">Téléphone
          <input name="apptQuery" type="tel" inputmode="tel" value="${esc(m.query)}" autocomplete="off" data-autofocus>
        </label>
        <label class="field">Prénom
          <input name="apptFirst" type="text" value="${esc(apptFirstName(m))}" autocomplete="off" autocapitalize="words">
        </label>
      </div>
      <p class="err err-inline" id="appt-who-err" role="alert">${esc(m.whoError)}</p>
      <div id="appt-who" class="appt-who">${viewApptWho(m)}</div>`;
  const when = done
    ? `<span class="step-value appt-done-time">${fmtMin(min)} – ${fmtMin(min + m.duration)}</span>`
    : `<div class="appt-time-row">
        <div class="stepper" role="group" aria-label="Heure">
          <button type="button" class="btn btn-ghost btn-icon" data-action="appt-time" data-step="-15" aria-label="15 minutes plus tôt"${min <= core.OPEN_MIN ? ' disabled' : ''}>${icon('minus', 20)}</button>
          <output class="step-value">${fmtMin(min)}</output>
          <button type="button" class="btn btn-ghost btn-icon" data-action="appt-time" data-step="15" aria-label="15 minutes plus tard"${min >= core.CLOSE_MIN - core.STEP_MIN ? ' disabled' : ''}>${icon('plus', 20)}</button>
        </div>
        ${a ? `<button type="button" class="btn btn-ghost btn-sm" data-action="appt-move">${icon('move', 16)} Déplacer</button>` : ''}
      </div>`;
  const closeLabel = !a ? 'Annuler' : m.changed ? 'Fermer sans enregistrer' : 'Fermer';
  return `
    <form data-form="appt" class="dialog appt-dialog" novalidate>
      <h2 class="serif" id="dlg-title" tabindex="-1"${a ? ' data-autofocus' : ''}>${!a ? 'Nouveau rendez-vous' : done ? 'Rendez-vous passé' : 'Rendez-vous'}</h2>
      <div class="appt-when">
        <span class="appt-day">${fmtDayTitle(m.start)}</span>
        ${when}
      </div>
      ${done ? '' : viewApptSpan(m)}
      ${person}
      <div class="services services-compact" role="group" aria-label="Prestations prévues">
        ${SERVICES.map((s) => `<button type="button" class="service" aria-pressed="${m.services.has(s)}" data-action="appt-service" data-service="${esc(s)}">${icon('check', 16)}<span>${esc(s)}</span></button>`).join('')}
      </div>
      <div class="stepper" role="group" aria-label="Durée" id="appt-dur"><span class="label">Durée</span>${viewApptDur(m)}</div>
      <p class="err err-inline${m.warn && m.error ? ' is-warn' : ''}" id="appt-err" role="alert">${esc(m.error)}</p>
      <div class="form-actions split-actions">
        ${a ? `<button type="button" class="btn btn-danger-outline btn-sm" data-action="appt-cancel">${icon('trash', 16)} ${done ? 'Supprimer le rendez-vous' : 'Annuler le rendez-vous'}</button>` : ''}
        <div class="actions-main">
          <button type="button" class="btn btn-ghost" data-action="close-modal">${closeLabel}</button>
          <button type="submit" class="btn ${a && !m.changed ? 'btn-ghost' : 'btn-accent'}" id="appt-submit"${a && !m.changed ? ' disabled' : ''}>${m.lateOk ? 'Enregistrer quand même' : 'Enregistrer'}</button>
        </div>
      </div>
    </form>`;
}

// Prénom affiché : celui de la fiche choisie, sinon celui qui a été tapé.
function apptFirstName(m) {
  const chosen = m.clientId && S.clients.find((c) => c.id === m.clientId);
  return chosen ? chosen.firstName : m.firstName;
}

// Problème d'un horaire : { reason: 'past' | 'overlap' | 'close', text }, ou null s'il convient.
// Finir après 18 h n'est qu'un avertissement : le coiffeur peut le forcer (client en retard, couleur qui déborde).
async function slotIssue(candidate, isNew) {
  if (isNew && new Date(candidate.start) < new Date()) return { reason: 'past', text: 'Ce créneau est déjà passé.' };
  const day = new Date(candidate.start);
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const list = await db.appointmentsBetween(from.toISOString(), addDays(from, 1).toISOString());
  const pb = core.checkSlot(candidate, list);
  if (!pb) return null;
  if (pb.reason === 'close') return { reason: 'close', text: `Il finit à ${fmtMin(core.minutesOf(core.endOf(candidate)))}, après la fermeture de 18 h.` };
  return { reason: 'overlap', text: `Chevauche le rendez-vous de ${apptName(pb.other)} à ${fmtTime(pb.other.start)}.` };
}

// Un second appui pendant l'enregistrement est ignoré (sinon deux fiches et deux rendez-vous).
async function saveApptForm() {
  const m = S.modal;
  if (m.saving) return;
  m.saving = true;
  try {
    await saveAppt(m);
  } finally {
    m.saving = false;
  }
}

async function saveAppt(m) {
  const a = m.id ? findAppt(m.id) : null;
  const fail = (msg, warn = false) => {
    m.error = msg;
    m.warn = warn;
    const slot = app.querySelector('#appt-err');
    if (slot) {
      slot.textContent = msg;
      slot.classList.toggle('is-warn', warn);
    }
    announce(msg);
  };
  // Ce qui manque pour savoir qui vient : écrit juste sous le téléphone et le prénom, là où est le doigt
  // (en bas de la fenêtre, le message restait caché derrière le clavier).
  const failWho = (msg, field = null) => {
    m.whoError = msg;
    const slot = app.querySelector('#appt-who-err');
    if (slot) slot.textContent = msg;
    announce(msg);
    if (field) app.querySelector(`[name="${field}"]`)?.focus();
    slot?.scrollIntoView({ block: 'nearest' });
  };
  let client = a ? apptClient(a) : m.clientId && S.clients.find((c) => c.id === m.clientId);
  const firstName = capName((m.firstName || '').trim());
  const phone = m.query?.trim() || '';
  if (!a && !client) {
    const matches = m.other ? [] : phoneMatches(phone);
    if (digits(phone) && !phoneComplete(phone)) {
      return failWho(matches.length ? 'Numéro incomplet : finissez-le, ou touchez la fiche du client.' : 'Numéro incomplet : vérifiez les chiffres.', 'apptQuery');
    }
    if (matches.length) {
      // Même prénom qu'une fiche à ce numéro : c'est elle. Sinon, pas de nouvelle fiche par surprise
      // (elle n'aurait pas l'allergie) : on touche la bonne, ou « Autre personne ».
      const same = matches.filter((c) => firstName && norm(c.firstName) === norm(firstName));
      if (same.length === 1) client = same[0];
      else {
        return failWho(
          matches.length === 1
            ? `Touchez la fiche de ${fullName(matches[0])}, ou « Autre personne » pour une nouvelle fiche.`
            : 'Touchez la bonne fiche, ou « Autre personne » pour une nouvelle fiche.'
        );
      }
    }
    if (!client && !firstName) return failWho('Tapez le prénom du client.', 'apptFirst');
  }
  const issue = await slotIssue({ id: m.id, start: m.start, duration: m.duration }, !a || m.start !== a.start);
  // Chevauchement et fin après 18 h sont déjà écrits sur la ligne « Fin à … » : elle luit et elle est lue,
  // sans répéter le même problème une seconde fois sous la durée.
  const spanLine = app.querySelector('#appt-span');
  const flagSpan = () => {
    spanLine.classList.remove('refuse');
    void spanLine.offsetWidth; // relance l'animation à chaque appui
    spanLine.classList.add('refuse');
  };
  const forceHint = 'Touchez « Enregistrer quand même » pour le noter.';
  if (issue?.reason === 'close' && !m.lateOk) {
    // Premier appui : on prévient ; le second (« Enregistrer quand même ») force le dépassement.
    m.lateOk = true;
    const btn = app.querySelector('#appt-submit');
    if (btn) btn.textContent = 'Enregistrer quand même';
    if (!spanLine?.classList.contains('late')) return fail(`${issue.text} ${forceHint}`, true);
    flagSpan();
    fail(forceHint, true);
    announce(`${issue.text} ${forceHint}`);
    return;
  }
  if (issue?.reason === 'overlap' && spanLine?.classList.contains('over')) {
    flagSpan();
    fail('');
    announce(`${issue.text} Changez l’heure ou la durée.`);
    return;
  }
  if (issue && issue.reason !== 'close') return fail(issue.text);
  // Un numéro : la fiche est créée en même temps. Sans numéro, le rendez-vous est noté au prénom seul ;
  // la fiche se crée plus tard depuis le rendez-vous (« Créer la fiche »).
  if (!a && !client && phoneComplete(phone)) {
    client = await db.saveClient({ firstName, phone });
    await loadClients();
  }
  const saved = await db.saveAppointment({
    ...(a || {}),
    clientId: a ? a.clientId : client?.id || null,
    firstName: client ? client.firstName : a ? a.firstName : firstName,
    phone: client ? client.phone : a ? a.phone : '',
    start: m.start,
    duration: m.duration,
    services: apptServices(m)
  });
  await refreshAppts();
  // Sous le titre, une ligne courte (prénom, fin après 18 h) ; le lecteur d'écran entend la phrase complète.
  const what = `${a ? 'Rendez-vous modifié' : 'Rendez-vous noté'} : `;
  const when = `${fmtDayTitle(saved.start).toLowerCase()} à ${fmtTime(saved.start)}.`;
  const late = issue?.reason === 'close'; // dépassement de 18 h forcé : rappelé
  agendaNote(`${what}${apptName(saved)}, ${when}${late ? ` Fin à ${fmtTime(core.endOf(saved).toISOString())}, après 18 h.` : ''}`);
  // Rendez-vous noté par erreur (mauvais jour, mauvais client) : il s'efface d'un appui, comme une annulation.
  if (!a) S.note.undo = { kind: 'created', id: saved.id, label: 'Annuler ce rendez-vous' };
  S.flash = saved.id;
  S.modalReturn = `.appt-block[data-id="${saved.id}"]`; // le focus va au rendez-vous noté
  closeModal();
  S.flash = null;
  announce(`${what}${apptName(saved, true)}, ${when}${late ? ` ${issue.text}` : ''}`);
}

// Message de l'agenda, sous le titre de la semaine (à la place de la consigne) : il reste jusqu'à
// la prochaine action, avec au besoin de quoi revenir en arrière.
function agendaNote(text, undo = null) {
  S.note = { text, undo };
}

// Annulation sans fenêtre de confirmation : elle se défait d'un appui (« Rétablir » sous le titre).
async function cancelAppt(a) {
  const past = core.endOf(a) <= new Date(); // client pas venu, rendez-vous noté par erreur
  await db.deleteAppointment(a.id);
  await refreshAppts();
  S.modal = null;
  S.modalReturn = null;
  const text = (name) => `Rendez-vous de ${name} ${past ? 'supprimé' : 'annulé'} (${fmtDayTitle(a.start).toLowerCase()} à ${fmtTime(a.start)}).`;
  agendaNote(text(apptName(a)), { kind: 'cancel', appt: a, label: 'Rétablir' });
  render({ focus: '[data-action="undo"]' });
  announce(text(apptName(a, true)));
}

// Ouvre la fiche du rendez-vous, prestations prévues cochées si la visite du jour est encore vide.
async function openApptClient(a) {
  S.space = 'today';
  S.modal = null;
  S.modalReturn = null;
  if (apptClient(a)) {
    await selectClient(a.clientId);
    render({ top: true, focus: '.client-head h1' });
    return;
  }
  // Pas de fiche (effacée après un refus RGPD) : la nouvelle fiche sera rattachée à ce rendez-vous.
  render();
  openModal({ type: 'client', apptId: a.id, client: { firstName: a.firstName, lastName: '', phone: fmtPhone(a.phone), email: '', allergies: '' } });
}

// Rendez-vous sans fiche rattaché à la fiche créée ou retrouvée : il suit désormais la fiche
// (et ses règles de sauvegarde), il n'est plus gardé « sur la tablette seulement ».
async function linkAppt(apptId, client) {
  const a = apptId && (await db.getAppointment(apptId));
  if (!a || a.clientId) return;
  // Nouvel identifiant : l'effacement en ligne posé par detachAppointments vise l'ancien.
  const { localOnly, id, syncedAt, dirty, updatedAt, ...rest } = a;
  await db.saveAppointment({ ...rest, clientId: client.id, firstName: client.firstName, phone: client.phone });
  await db.deleteAppointment(id, false);
  await refreshAppts();
}

// Le refus reste écrit sous le titre (en corail) jusqu'au prochain essai ; la réussite se défait d'un appui.
async function moveTo(startIso, tapped = null) {
  const a = await db.getAppointment(S.moving.id); // peut être dans une autre semaine que celle affichée
  if (!a) {
    S.moving = null;
    render();
    return;
  }
  const issue = await slotIssue({ id: a.id, start: startIso, duration: a.duration }, true);
  if (issue && issue.reason !== 'close') {
    S.moving.error = `${issue.text} Touchez un autre créneau.`;
    S.refused = tapped; // le créneau touché luit un instant en corail, là où est le doigt
    render();
    S.refused = null;
    announce(S.moving.error);
    return;
  }
  await db.saveAppointment({ ...a, start: startIso });
  S.moving = null;
  await refreshAppts();
  const text = `${apptName(a)} : déplacé au ${fmtDayTitle(startIso).toLowerCase()} à ${fmtTime(startIso)}.`;
  // Seul un dépassement de 18 h passe ; on le rappelle, en court sous le titre.
  const end = fmtTime(core.endOf({ start: startIso, duration: a.duration }).toISOString());
  agendaNote(`${text}${issue ? ` Fin à ${end}, après 18 h.` : ''}`, { kind: 'move', id: a.id, start: a.start, label: 'Remettre comme avant' });
  S.flash = a.id;
  render({ focus: '[data-action="undo"]' });
  S.flash = null;
  announce(`${text}${issue ? ` ${issue.text}` : ''}`);
}

// Défaire le dernier déplacement ou la dernière annulation. Un rendez-vous rétabli repart sous un
// nouvel identifiant : l'effacement de l'ancien, peut-être déjà envoyé en ligne, ne le touchera pas.
async function undoAgenda() {
  const u = S.note?.undo;
  if (!u) return;
  if (u.kind === 'created') {
    const a = await db.getAppointment(u.id);
    if (!a) return;
    await cancelAppt(a);
    return;
  }
  let record;
  if (u.kind === 'move') {
    const a = await db.getAppointment(u.id);
    if (!a) return;
    record = { ...a, start: u.start };
  } else {
    const { id, syncedAt, dirty, updatedAt, ...rest } = u.appt;
    record = rest;
  }
  const issue = await slotIssue(record, false);
  const problem = issue && issue.reason !== 'close' ? issue.text : '';
  if (problem) {
    agendaNote(`Impossible de revenir en arrière : ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`);
    render();
    announce(S.note.text);
    return;
  }
  const saved = await db.saveAppointment(record);
  await refreshAppts();
  const when = `${fmtDayTitle(saved.start).toLowerCase()} à ${fmtTime(saved.start)}.`;
  const text = (name) => (u.kind === 'move' ? `${name} : remis au ${when}` : `Rendez-vous de ${name} rétabli, ${when}`);
  agendaNote(text(apptName(saved)));
  S.flash = saved.id;
  render({ focus: S.space === 'agenda' ? '.agenda-head h1' : '.today-plan h1' });
  S.flash = null;
  announce(text(apptName(saved, true)));
}

const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const SHORT_SERVICE = { 'Coupe & coiffage': 'Coupe', Coloration: 'Couleur' };
const OPEN_SPAN = core.CLOSE_MIN - core.OPEN_MIN;
const pct = (min) => `${(((min - core.OPEN_MIN) / OPEN_SPAN) * 100).toFixed(3)}%`;
const span = (min) => `${((min / OPEN_SPAN) * 100).toFixed(3)}%`;
const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const atMinutes = (day, min) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, min);
const fmtMin = (min) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
const hourLabel = (min) => (min % 60 ? fmtMin(min) : `${min / 60} h`);

// Le nom actuel de la fiche (complété par le client entre-temps) ; la copie du rendez-vous sinon.
const apptClient = (a) => (a.clientId ? S.clients.find((c) => c.id === a.clientId) : null);
// Nom court : le prénom, avec l'initiale du nom quand une autre fiche porte le même prénom.
function apptName(a, full = false) {
  const c = apptClient(a);
  if (!c) return a.firstName || 'Sans nom';
  if (full || !c.firstName) return fullName(c);
  const twin = c.lastName && S.clients.some((o) => o.id !== c.id && norm(o.firstName) === norm(c.firstName));
  return twin ? `${c.firstName} ${c.lastName.charAt(0)}.` : c.firstName;
}
const apptAllergy = (a) => apptClient(a)?.allergies || '';
const shortServices = (a) => a.services.map((s) => SHORT_SERVICE[s] || s).join(', ');

async function loadWeek() {
  if (!S.week) S.week = core.defaultWeek(new Date());
  S.weekAppts = await db.appointmentsBetween(S.week.toISOString(), addDays(S.week, 7).toISOString());
}

// Un quart d'heure n'a que la moitié d'une demi-heure : sa zone tactile déborde de 8 px sur ses voisins plus grands,
// jamais sur un autre quart d'heure (chacun garde au moins sa propre case).
const REACH_PX = 8;
function reachOf(spans) {
  const shorts = spans.filter((x) => x.end - x.start < core.SLOT_MIN);
  return (start, end) => {
    if (end - start >= core.SLOT_MIN) return '';
    const up = shorts.some((o) => o.end === start) ? 0 : REACH_PX;
    const down = shorts.some((o) => o.start === end) ? 0 : REACH_PX;
    return `;--reach-up:${up}px;--reach-down:${down}px`;
  };
}

// Les créneaux et les rendez-vous sont écrits dans l'ordre des heures (lecture d'écran) ; le temps
// écoulé est voilé et n'offre plus de créneau.
function viewDayColumn(day, appts, now, today = null) {
  const isToday = day.toDateString() === now.toDateString();
  const lanes = core.lanes(appts);
  const dayName = `${DAY_NAMES[(day.getDay() + 6) % 7]} ${fmtDay(day)}`;
  const lines = [];
  for (let m = core.OPEN_MIN + 30; m < core.CLOSE_MIN; m += 30) lines.push(`<i class="hl${m % 60 ? ' half' : ''}" style="top:${pct(m)}"></i>`);
  const nowMin = core.minutesOf(now);
  const elapsed = now >= atMinutes(day, core.CLOSE_MIN) ? OPEN_SPAN : isToday ? Math.max(0, nowMin - core.OPEN_MIN) : 0;
  const veil = elapsed ? `<i class="past-veil" style="height:${span(elapsed)}"></i>` : '';
  const free = core.freeSlots(day, appts, now);
  const shown = (a) => Math.min(a.duration, core.CLOSE_MIN - core.minutesOf(new Date(a.start))); // coupé à 18 h
  const reach = reachOf([...free, ...appts.map((a) => ({ start: core.minutesOf(new Date(a.start)), end: core.minutesOf(new Date(a.start)) + shown(a) }))]);
  const items = free.map((f) => ({
    min: f.start,
    html: `<button type="button" class="slot${f.end - f.start < core.SLOT_MIN ? ' short' : ''}" style="top:${pct(f.start)};height:${span(f.end - f.start)}${reach(f.start, f.end)}" data-action="slot" data-start="${atMinutes(day, f.start).toISOString()}" aria-label="${esc(`${dayName}, ${fmtMin(f.start)}, libre`)}"></button>`
  }));
  for (const a of appts) {
    const start = new Date(a.start);
    const end = core.endOf(a);
    const done = end <= now;
    const live = !done && start <= now;
    const { lane, lanes: n } = lanes.get(a.id);
    const allergy = apptAllergy(a);
    const vis = shown(a);
    const late = vis < a.duration;
    const v = today ? visitOf(a) : null;
    const label = [
      `${apptName(a, true)}, ${dayName}, ${fmtTime(a.start)} à ${fmtTime(end.toISOString())}`,
      a.services.join(', '),
      allergy ? 'allergie' : '',
      done ? 'terminé' : live ? 'en cours' : '',
      today ? visitWords(a, v, done, today.next) : ''
    ]
      .filter(Boolean)
      .join(', ');
    const cls = [
      'appt-block',
      today && 'today-block',
      (done || v?.status === 'done') && 'past',
      live && 'live',
      today && a.id === today.next && 'next',
      vis < core.SLOT_MIN && 'short',
      late && 'late',
      S.moving?.id === a.id && 'moving',
      S.flash === a.id && 'flash'
    ]
      .filter(Boolean)
      .join(' ');
    const startMin = core.minutesOf(start);
    const svc = a.services.length ? shortServices(a) : '';
    const style = `top:${pct(startMin)};height:${span(vis)};left:calc(${(lane / n) * 100}% + 2px);width:calc(${100 / n}% - 4px)${reach(startMin, startMin + vis)}`;
    if (today) {
      // Planning du jour : le nom complet et l'état de la visite sur la première ligne, le détail
      // (prestations, durée, fin) dessous dès que le bloc a la hauteur de deux lignes.
      const tall = vis >= core.SLOT_MIN;
      const info = [a.services.join(', '), `${core.fmtDuration(a.duration)}, jusqu’à ${fmtTime(end.toISOString())}`].filter(Boolean).join(SEP);
      // Au bout du bloc, « Modifier » ouvre la fenêtre de l'agenda (annuler, déplacer, changer) ;
      // le reste du bloc ouvre la fiche. Côte à côte, il ne garde que son icône.
      const narrow = n > 1;
      const editStyle = `top:${pct(startMin)};height:${span(vis)};right:calc(${((n - lane - 1) / n) * 100}% + 2px)`;
      const edit = `<button type="button" class="today-edit${narrow ? ' is-narrow' : ''}${vis < core.SLOT_MIN ? ' is-short' : ''}" style="${editStyle}" data-action="today-edit" data-id="${a.id}" aria-label="${esc(`Rendez-vous de ${apptName(a, true)} à ${fmtTime(a.start)} : modifier ou annuler`)}"><span class="today-edit-pill">${icon('calendar', 16)}<span class="today-edit-label">Modifier</span></span></button>`;
      items.push({
        min: startMin,
        html: `<button type="button" class="${cls}${narrow ? ' edit-narrow' : ''}" style="${style}" data-action="today-appt" data-id="${a.id}" aria-label="${esc(label)}">
        <span class="today-line"><span class="appt-time">${hourLabel(startMin)}</span><span class="appt-n">${esc(apptName(a, true))}</span>${svc && !tall ? `<span class="appt-svc">${esc(svc)}</span>` : ''}<span class="today-tags">${allergy ? `<span class="today-allergy">${icon('alert', 16)}<span class="tag-label">Allergie</span></span>` : ''}${visitTag(v, done, live)}</span></span>
        ${tall ? `<span class="appt-sub">${esc(info)}</span>` : ''}
      </button>${edit}`
      });
      continue;
    }
    // Chaque bloc se lit comme une ligne de carnet : l'heure, le prénom, puis la prestation, sur la
    // ligne du dessous quand le bloc est assez haut, sinon à la suite du prénom.
    const tall = vis >= (late ? 60 : 45);
    items.push({
      min: startMin,
      html: `<button type="button" class="${cls}"
        style="${style}"
        data-action="appt" data-id="${a.id}" aria-label="${esc(label)}">
        <span class="appt-name">${allergy ? icon('alert', 14) : ''}<span class="appt-time">${hourLabel(startMin)}</span><span class="appt-n">${esc(apptName(a))}</span>${svc && !tall && vis >= core.SLOT_MIN ? `<span class="appt-svc">${esc(svc)}</span>` : ''}</span>
        ${svc && tall ? `<span class="appt-sub">${esc(svc)}</span>` : ''}
        ${late && vis >= 45 ? `<span class="appt-sub appt-end">jusqu’à ${fmtTime(end.toISOString())}</span>` : ''}
      </button>`
    });
  }
  items.sort((x, y) => x.min - y.min);
  const nowLine = isToday && nowMin > core.OPEN_MIN && nowMin < core.CLOSE_MIN ? `<i class="now-line" style="top:${pct(nowMin)}"></i>` : '';
  return `<div class="day-col${isToday ? ' is-today' : ''}" role="group" aria-label="${esc(dayName + (isToday ? ', aujourd’hui' : ''))}">
    ${veil}${lines.join('')}${items.map((x) => x.html).join('')}${nowLine}</div>`;
}

const HINT_SLOT = 'Touchez un créneau libre pour noter un rendez-vous.';

// Ligne sous le titre de la semaine : consigne, message du déplacement en cours, ou dernier message.
// Elle garde la même hauteur ; le bouton qui l'accompagne se range avec la navigation des semaines.
function viewAgendaLine(hint) {
  if (S.moving) {
    return S.moving.error
      ? `<p class="agenda-line is-error">${esc(S.moving.error)}</p>`
      : `<p class="agenda-line is-move">${icon('move', 18)}<span>Touchez le nouveau créneau de <strong>${esc(S.moving.name)}</strong> (prévu ${esc(S.moving.from)}).</span></p>`;
  }
  if (S.note) return `<p class="agenda-line is-note">${icon('check', 18)}<span title="${esc(S.note.text)}">${esc(S.note.text)}</span></p>`;
  return `<p class="agenda-line muted">${hint}</p>`;
}

// Repères d'heures de la colonne de gauche (les demi-heures en plus pour le planning du jour).
function hourMarks(halves = false) {
  const out = [];
  for (let m = core.OPEN_MIN; m <= core.CLOSE_MIN; m += 30) {
    if (halves || m === core.OPEN_MIN || m % 60 === 0) {
      const edge = m === core.OPEN_MIN ? ' first' : m === core.CLOSE_MIN ? ' last' : '';
      out.push(`<span class="hour${edge}${halves && m % 60 && m !== core.OPEN_MIN ? ' half' : ''}" style="top:${pct(m)}">${hourLabel(m)}</span>`);
    }
  }
  return out.join('');
}

function viewAgenda() {
  const now = new Date();
  const days = core.weekDays(S.week);
  const current = S.week.getTime() === core.defaultWeek(now).getTime();
  const pastWeek = atMinutes(days[5], core.CLOSE_MIN) <= now;
  const extra = S.moving
    ? `<button type="button" class="btn btn-ghost" data-action="move-cancel">${icon('x', 18)} Ne pas déplacer</button>`
    : S.note?.undo
      ? `<button type="button" class="btn btn-ghost" data-action="undo">${icon('undo', 18)} ${S.note.undo.label}</button>`
      : '';
  return `
  <div class="agenda-head">
    <div class="agenda-title">
      <h1 class="serif">${core.weekLabel(S.week)}</h1>
      ${viewAgendaLine(pastWeek ? 'Semaine passée : consultation seulement.' : HINT_SLOT)}
    </div>
    <div class="week-nav">
      ${extra}
      <button type="button" class="btn btn-ghost btn-icon" data-action="week-prev" aria-label="Semaine précédente">${icon('left', 20)}</button>
      ${
        // Sur la semaine de travail : une indication de position (en or, comme ce qui est choisi),
        // pas un bouton grisé qui se lirait comme une action indisponible.
        current
          ? `<span class="week-here">${core.defaultWeek(now) > core.weekStart(now) ? 'Semaine prochaine' : 'Cette semaine'}</span>`
          : `<button type="button" class="btn btn-ghost" data-action="week-now">${core.defaultWeek(now) > core.weekStart(now) ? 'Semaine prochaine' : 'Cette semaine'}</button>`
      }
      <button type="button" class="btn btn-ghost btn-icon" data-action="week-next" aria-label="Semaine suivante">${icon('right', 20)}</button>
    </div>
  </div>
  <div class="week">
    <div class="week-row week-days" aria-hidden="true">
      <span></span>
      ${days.map((d, i) => `<span class="day-head${d.toDateString() === now.toDateString() ? ' is-today' : ''}">${DAY_NAMES[i].slice(0, 3)} <strong>${d.getDate()}</strong></span>`).join('')}
    </div>
    <div class="week-scroll">
      <div class="week-row week-body">
        <div class="hours" aria-hidden="true">${hourMarks()}</div>
        ${days.map((d) => viewDayColumn(d, S.weekAppts.filter((a) => new Date(a.start).toDateString() === d.toDateString()), now)).join('')}
      </div>
    </div>
  </div>`;
}

const byRecent = (a, b) => (S.lastVisit.get(b.id) || b.createdAt).localeCompare(S.lastVisit.get(a.id) || a.createdAt);

// Fiches dont le nom ou le téléphone correspond, les plus récentes d'abord (rien pour une recherche vide).
function matchClients(query) {
  const q = norm(query);
  const qd = digits(query);
  if (!q) return [];
  return S.clients
    .filter((c) => {
      const name = norm(`${c.firstName} ${c.lastName}`);
      const rev = norm(`${c.lastName} ${c.firstName}`);
      return name.includes(q) || rev.includes(q) || (qd.length >= 2 && digits(c.phone).includes(qd));
    })
    .sort(byRecent);
}

function searchClients() {
  if (!norm(S.query)) return [...S.clients].sort(byRecent).slice(0, 12);
  return matchClients(S.query);
}

function viewResults() {
  const list = searchClients();
  if (!S.clients.length) return `<p class="muted small pad">Aucune fiche pour l’instant.</p>`;
  if (!list.length) {
    // Le numéro ou le nom tapé sert à créer la fiche, sans le retaper.
    const q = S.query.trim();
    const label = hasLetters(q) ? `Créer la fiche « ${esc(capName(q))} »` : digits(q).length >= 6 ? `Créer la fiche ${esc(fmtPhone(q))}` : '';
    return `<p class="muted small pad">Aucune fiche ne correspond.</p>
      ${label ? `<button type="button" class="btn-new btn-new-found" data-action="new-client-search">${icon('plus', 18)} <span>${label}</span></button>` : ''}`;
  }
  return (
    (S.query ? '' : `<p class="label small-label">Récents</p>`) +
    list
      .map((c) => {
        const last = S.lastVisit.get(c.id);
        const sub = [
          hasName(c) ? '' : `fiche du ${fmtDayShort(c.createdAt)}`,
          fmtPhone(c.phone),
          last ? `dernière visite ${ago(last)}` : 'aucune visite'
        ]
          .filter(Boolean)
          .join(SEP);
        const tags = [
          S.pending.get(c.id) ? `<span class="tag tag-pending">${icon('clock', 13)} À valider</span>` : '',
          S.drafts.has(c.id) || S.savedDrafts.has(c.id) ? '<span class="tag">Visite en cours</span>' : '',
          c.consentAt ? '' : CONSENT_TAG
        ].join('');
        return `<button type="button" class="result${c.id === S.clientId ? ' active' : ''}${hasName(c) ? '' : ' unnamed'}" data-action="select" data-id="${c.id}">
          <span class="result-name">${esc(fullName(c))}</span>
          <span class="result-sub">${esc(sub)}</span>
          ${tags ? `<span class="tags">${tags}</span>` : ''}
        </button>`;
      })
      .join('')
  );
}

// Après la validation d'un client : qui, et quand, en tête de l'accueil, quelques secondes (hideValidated).
const viewValidated = () =>
  S.validated
    ? `<p class="done-line validated-line">${icon('check', 18)}<span><strong>${esc(S.validated.name)}</strong> a validé sa fiche à ${fmtTime(S.validated.at)}.</span></p>`
    : '';

// Le planning du jour et la semaine défilent dans leur propre zone (titre, messages et bandeaux restent
// en vue) ; à l'arrivée, ils se calent une demi-heure avant maintenant. Une autre semaine part de l'ouverture.
function scrollPlanToNow() {
  const box = app.querySelector('.day-scroll, .week-scroll');
  if (!box) return;
  const col = box.querySelector('.day-col.is-today') || (box.matches('.day-scroll') ? box.querySelector('.day-col') : null);
  if (!col) {
    box.scrollTop = 0;
    return;
  }
  // Position de la colonne dans la zone qui défile (marge haute du planning comprise), puis quelques pixels
  // de marge : le libellé d'heure centré sur la ligne et le haut du rendez-vous restent entiers.
  const colTop = col.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  const line = ((core.planStartMin(new Date(), S.todayAppts) - core.OPEN_MIN) / OPEN_SPAN) * col.offsetHeight;
  box.scrollTop = Math.max(0, colTop + line - 6);
}

// Visite du jour du client d'un rendez-vous (celle « à valider » d'abord, sinon la dernière validée).
const visitOf = (a) => (a.clientId ? S.todayVisits.get(a.clientId) : null);

// État de la visite sur un rendez-vous du jour : à valider, validée, oubliée, ou en cours.
function visitTag(v, done, live) {
  if (v?.status === 'pending') return `<span class="tag tag-pending">${icon('clock', 13)}<span class="tag-label">À valider</span></span>`;
  if (v) return `<span class="today-state">${icon('check', 16)}<span class="tag-label">Validée${v.validatedAt ? ` à ${fmtTime(v.validatedAt)}` : ''}</span></span>`;
  if (done) return '<span class="today-state is-none"><span class="tag-label">Pas de visite notée</span></span>';
  return live ? `<span class="today-live">${icon('clock', 16)}<span class="tag-label">En cours</span></span>` : '';
}
const visitWords = (a, v, done, next) =>
  v?.status === 'pending' ? 'visite à valider' : v ? 'visite validée' : done ? 'pas de visite notée' : a.id === next ? 'prochain rendez-vous' : '';

// Accueil de l'espace coiffeur : la journée en planning (terminés grisés, le prochain entouré d'or) ;
// un créneau libre note un rendez-vous, un rendez-vous ouvre la fiche du client.
function viewTodayPlan() {
  const now = new Date();
  const u = S.upcoming;
  const nextLink = u
    ? `<button type="button" class="link next-appt" data-action="show-appt" data-id="${u.id}">${icon('calendar', 16)}<span>Prochain rendez-vous : ${fmtDayTitle(u.start).toLowerCase()} à ${fmtTime(u.start)}, ${esc(apptName(u))}</span></button>`
    : '';
  if (!core.isOpenDay(now)) {
    return `
  <div class="empty">
    ${viewValidated()}
    <h1 class="serif">Salon fermé aujourd’hui</h1>
    ${nextLink || `<button type="button" class="link" data-action="space" data-space="agenda">${icon('calendar', 16)} Ouvrir l’agenda</button>`}
  </div>`;
  }
  const list = S.todayAppts;
  const next = core.nextOfDay(list.filter((a) => visitOf(a)?.status !== 'done'), now);
  const n = list.length;
  const over = core.minutesOf(now) >= core.CLOSE_MIN;
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return `
  <div class="today-plan">
    ${viewValidated()}
    <div class="agenda-head">
      <div class="agenda-title">
        <h1 class="serif">Aujourd’hui</h1>
        <p class="muted"><span class="plan-date">${fmtDayTitle(now.toISOString())}${SEP}</span><span class="plan-count">${n ? `${n} rendez-vous` : 'aucun rendez-vous'}</span></p>
        ${viewAgendaLine(over ? 'Journée terminée.' : HINT_SLOT)}
      </div>
      ${S.note?.undo ? `<div class="week-nav"><button type="button" class="btn btn-ghost" data-action="undo">${icon('undo', 18)} ${S.note.undo.label}</button></div>` : ''}
    </div>
    ${n ? '' : nextLink}
    <div class="day-scroll">
      <div class="day-plan">
        <div class="hours" aria-hidden="true">${hourMarks(true)}</div>
        ${viewDayColumn(day, list, now, { next })}
      </div>
    </div>
  </div>`;
}

// Annoncé une seule fois à l'ajout ; le bandeau redessiné n'est pas une zone annoncée.
function addNotice(notice) {
  S.notices.push(notice);
  announce(notice.text);
}

// Bandeaux dans leur contexte : celui d'une visite est masqué sur la fiche du même client (l'encart
// « attend la validation » le dit déjà) ; les simples informations ne s'affichent qu'hors fiche.
// Sur la fiche d'un autre client, la visite en attente n'est qu'un rappel discret, au bouton nommé :
// le client présent ne doit pas recevoir par erreur la visite (et les coordonnées) d'un autre.
const rehandLabel = (n, short) => (n.name ? `${short ? 'Repasser à' : 'Repasser la tablette à'} ${esc(n.name)}` : 'Repasser la tablette');
const viewNotices = () =>
  S.notices
    .map((n, i) => {
      if (n.visitId ? n.clientId === S.clientId : S.client) return '';
      const aside = n.visitId && S.client;
      return `<div class="notice${aside ? ' notice-aside' : ''}">${icon(n.visitId ? 'clock' : n.sync ? 'cloudOff' : 'info', aside ? 18 : 20)}<span>${esc(n.text)}</span>
        ${n.action ? `<button type="button" class="btn btn-sm btn-ghost" data-action="${n.action}">${n.label}</button>` : ''}
        ${n.visitId ? `<button type="button" class="btn btn-sm ${aside ? 'btn-ghost' : 'btn-accent'}" data-action="rehand-notice" data-index="${i}">${icon('tablet', 16)} ${rehandLabel(n, aside)}</button>` : ''}
        <button type="button" class="btn btn-sm btn-ghost" data-action="dismiss-notice" data-index="${i}">Compris</button></div>`;
    })
    .join('');

// Après « Compris » : le bandeau suivant, sinon le titre de l'écran. Jamais la recherche : le clavier
// d'Android s'ouvrirait sans qu'on l'ait demandé.
const CALM_FOCUS = '.detail [data-action="dismiss-notice"], .detail h1';

// Un bandeau qui parle d'une visite disparaît dès que la visite est validée ou effacée.
const dropNotices = (pred) => (S.notices = S.notices.filter((n) => !pred(n)));

const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();
const latestPending = () => S.history.find((v) => v.status === 'pending');
const whenOf = (v) => (isToday(v.date) ? `de ${fmtTime(v.date)}` : `du ${fmtDayShort(v.date)}`);

const consentLine = (c) => (c.consentAt ? `accord RGPD le ${fmtDayShort(c.consentAt)}` : '');
// Fiche que le client n'a jamais validée : gardée sur la tablette seulement, effacée s'il refuse.
const CONSENT_TAG = '<span class="tag tag-consent">Accord RGPD à demander</span>';

const keptText = (n) =>
  !n ? '' : n > 1 ? ` Ses ${n} rendez-vous à venir sont gardés sur la tablette.` : ' Son rendez-vous à venir est gardé sur la tablette.';

function lastColorLine() {
  const lc = core.lastColor(S.history, new Date());
  return lc ? `<span>Dernière couleur ${nb(core.agoText(lc.days))} (${fmtDayShort(lc.date)})</span>` : '';
}

// « C'est quand, mon rendez-vous ? » : la réponse est sur la fiche ; la toucher ouvre la semaine.
function nextApptLine() {
  const a = S.nextAppt;
  if (!a) return '';
  const label = isToday(a.start)
    ? `Rendez-vous aujourd’hui à ${fmtTime(a.start)}${new Date(a.start) <= new Date() ? ' (en cours)' : ''}`
    : `Prochain rendez-vous : ${fmtDayTitle(a.start).toLowerCase()} à ${fmtTime(a.start)}`;
  return `<button type="button" class="link next-appt" data-action="show-appt" data-id="${a.id}">${icon('calendar', 16)}<span>${label}<span class="sr-only">, voir dans l’agenda</span></span></button>`;
}

function viewClientDetail() {
  const c = S.client;
  // Coordonnées puis accord : chaque élément reste entier, et le point médian disparaît en début de ligne (.dot-list).
  const meta = [fmtPhone(c.phone), c.email].filter(Boolean);
  if (!meta.length) meta.push('Coordonnées à compléter par le client');
  if (c.consentAt) meta.push(consentLine(c));
  // En-tête ramassé : qui (coordonnées, accord), puis ce qui sert au travail (couleur, rendez-vous).
  const facts = [lastColorLine(), nextApptLine()].filter(Boolean);
  // Sortie visible de la fiche (le bouton « Aujourd'hui » du haut fait la même chose, mais rien ne le dit).
  return `
  <button type="button" class="link back-link" data-action="space" data-space="today">${icon('left', 18)} Planning du jour</button>
  <div class="client-head">
    <div class="client-id">
      <h1 class="serif${fullName(c).length > 28 ? ' is-long' : ''}">${esc(fullName(c))}</h1>
      <p class="client-meta"><span class="dot-list">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}${c.consentAt ? '' : CONSENT_TAG}</span></p>
      ${facts.length ? `<div class="client-facts">${facts.join('')}</div>` : ''}
    </div>
    <button type="button" class="btn btn-ghost" data-action="edit-client">${icon('edit', 18)} Modifier la fiche</button>
  </div>
  ${c.allergies ? `<div class="allergy">${icon('alert', 20)}<div><strong>Allergies / sensibilités</strong><span>${esc(c.allergies)}</span></div></div>` : ''}
  <div class="tabs" role="tablist" aria-label="Fiche client">
    ${[
      ['visit', S.draft.editId ? 'Modification' : 'Visite du jour'],
      ['history', `Historique (${S.history.length}${pendingCount() ? ` · ${pendingCount()} à valider` : ''})`]
    ]
      .map(
        ([key, label]) =>
          `<button type="button" role="tab" id="tab-${key}" aria-controls="tab-panel" aria-selected="${S.tab === key}" tabindex="${S.tab === key ? 0 : -1}" data-action="tab" data-tab="${key}">${label}</button>`
      )
      .join('')}
  </div>
  <div role="tabpanel" id="tab-panel" aria-labelledby="tab-${S.tab}">
    ${S.tab === 'visit' ? viewDraft() : viewHistory()}
  </div>`;
}

function viewDraft() {
  const d = S.draft;
  const f = d.formula;
  const showFormula = d.services.has('Coloration') || hasFormula(f);
  const lastVisit = S.history[0];
  // Visite déjà passée au client (en attente ou validée aujourd'hui) : rappelée au-dessus des prestations.
  // Le rappel ne disparaît pas quand on coche : rien ne saute sous le doigt, seul le bouton or change de place.
  const fresh = !d.editId && !draftHasContent(d);
  const waiting = d.editId ? null : latestPending();
  // Client reparti sans valider un autre jour : plus rien à repasser maintenant, ce sera à sa prochaine visite.
  const stale = waiting && !isToday(waiting.date);
  const doneToday = d.editId || waiting ? null : S.history.find((v) => v.status === 'done' && isToday(v.date));
  const field = (key, label, ph) =>
    `<label class="field">${label}<input data-bind="formula.${key}" value="${esc(f[key])}" placeholder="${ph}" autocomplete="off"></label>`;
  return `
  <div class="draft">
    ${
      d.editId
        ? `<div class="edit-banner">
            <span>Modification de la visite du <strong>${fmtDateMid(d.editDate)} à ${fmtTime(d.editDate)}</strong></span>
            <button type="button" class="link" data-action="cancel-edit">Annuler la modification</button>
          </div>`
        : ''
    }
    ${
      waiting
        ? `<div class="waiting">
            <span>${icon('clock', 18)} La visite <strong>${whenOf(waiting)}</strong> (${esc(waiting.services.join(', '))}) ${stale ? 'n’a pas été validée : repassez la tablette au client à sa prochaine visite.' : 'attend la validation du client.'}</span>
            <button type="button" class="btn ${fresh && !stale ? 'btn-accent' : 'btn-ghost'}" data-action="rehand" data-visit="${waiting.id}">${icon('tablet', 18)} Repasser la tablette</button>
          </div>`
        : doneToday
          ? `<p class="done-line visit-done">${icon('check', 18)}<span>Visite d’aujourd’hui (${esc(doneToday.services.join(', '))}) validée${doneToday.validatedAt ? ` à ${fmtTime(doneToday.validatedAt)}` : ''}.</span>
              <button type="button" class="link" data-action="edit-visit" data-visit="${doneToday.id}">${icon('edit', 16)} Modifier</button></p>`
        : lastVisit && !d.editId && !isToday(lastVisit.date)
          ? `<button type="button" class="link link-start" data-action="reuse-services"${d.services.size ? ' disabled' : ''}>${icon('undo', 16)} Mêmes prestations que le ${fmtDayShort(lastVisit.date)} (${esc(lastVisit.services.join(', '))})</button>`
          : ''
    }
    <div class="services" role="group" aria-label="Prestations" aria-describedby="services-err">
      ${SERVICES.map((s) => {
        const on = d.services.has(s);
        return `<button type="button" class="service" aria-pressed="${on}" data-action="toggle-service" data-service="${esc(s)}">${icon('check', 18)}<span>${esc(s)}</span></button>`;
      }).join('')}
    </div>
    <p class="err err-inline" id="services-err">${esc(S.draftError)}</p>
    ${
      showFormula
        ? `<section class="card">
      <div class="card-head">
        <h2 class="label">Formule couleur</h2>
        ${S.lastFormula && !d.editId ? `<button type="button" class="link" data-action="reuse-formula">${icon('undo', 16)} Reprendre la formule du ${fmtDayShort(S.lastFormula.date)}</button>` : ''}
      </div>
      ${
        // Rappel au plus près de la formule : l'encadré du haut sort de l'écran dès qu'on fait défiler jusqu'ici.
        S.client?.allergies
          ? `<div class="allergy allergy-mini allergy-formula">${icon('alert', 18)}<p><strong>Allergies</strong> <span>${esc(S.client.allergies)}</span></p></div>`
          : ''
      }
      <div class="grid4 grid-formula">
        ${field('brand', 'Marque', 'ex. Majirel')}
        ${field('shade', 'Nuance', 'ex. 6.34 + 7.3')}
        ${field('oxidant', 'Oxydant', 'ex. 20 vol · 1/1,5')}
        ${field('time', 'Temps de pose', 'ex. 35 min')}
      </div>
    </section>`
        : ''
    }
    <label class="field">Note interne (le client ne la voit pas)
      <textarea data-bind="note" rows="2" autocomplete="off" placeholder="ex. Préfère une frange courte">${esc(d.note)}</textarea>
    </label>
    <section class="photos">
      <h2 class="label" tabindex="-1">Photos (${d.photos.length}/${MAX_PHOTOS})</h2>
      <div class="photo-row">
        ${d.photos
          .map(
            (p, i) => `<div class="photo">
              <img src="${p.url}" alt="Photo ${i + 1}">
              <button type="button" class="photo-del" data-action="remove-photo" data-index="${i}" aria-label="Retirer la photo ${i + 1}">${icon('x', 16)}</button>
            </div>`
          )
          .join('')}
        ${
          d.photos.length < MAX_PHOTOS
            ? `<button type="button" class="photo-add" data-action="add-photo"${S.photoBusy ? ' disabled aria-busy="true"' : ''}>${icon('camera', 24)}<span>${S.photoBusy ? 'Préparation…' : 'Ajouter une photo'}</span></button>
              <input type="file" accept="image/*" data-photo hidden>`
            : ''
        }
      </div>
    </section>
    <div class="draft-foot">
      ${
        // Avant de passer la tablette : ce qu'un refus effacerait, tant que le client n'a rien accepté.
        !d.editId && !S.client.consentAt
          ? `<p class="foot-note">Pas encore d’accord RGPD : si le client refuse, sa fiche et cette visite seront effacées.</p>`
          : ''
      }
      ${
        d.editId
          ? `<button type="button" class="btn btn-accent btn-lg" data-action="save-edit"${S.photoBusy ? ' disabled' : ''}>${icon('check', 20)} Enregistrer les modifications</button>`
          : ((waiting && !stale) || doneToday) && fresh
            ? `<button type="button" class="btn btn-ghost btn-lg" data-action="handover"${S.photoBusy ? ' disabled' : ''}>Nouvelle visite : passer la tablette ${icon('arrow', 20)}</button>`
            : `<button type="button" class="btn btn-accent btn-lg" data-action="handover"${S.photoBusy ? ' disabled' : ''}>Passer la tablette au client ${icon('arrow', 20)}</button>`
      }
    </div>
  </div>`;
}

function viewHistory() {
  if (!S.history.length) return `<p class="muted pad">Pas encore de visite enregistrée.</p>`;
  return `<h2 class="sr-only">Historique des visites</h2><ol class="history">${S.history
    .map((v) => {
      const f = v.formula;
      const pending = v.status === 'pending';
      return `<li class="visit${S.draft.editId === v.id ? ' editing' : ''}${pending ? ' pending' : ''}">
        <div class="visit-title">
          <h3>${fmtDateLong(v.date)} <span class="muted">· ${fmtTime(v.date)}</span></h3>
          ${pending ? `<span class="badge badge-pending">${icon('clock', 14)} Non validée par le client</span>` : ''}
        </div>
        <div class="chips">${v.services.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>
        ${hasFormula(f) ? `<p class="visit-line"><span class="muted">Couleur :</span> ${esc([f.brand, f.shade, f.oxidant, f.time].filter(Boolean).join(SEP))}</p>` : ''}
        ${v.note ? `<p class="visit-line"><span class="muted">Note :</span> ${esc(v.note)}</p>` : ''}
        <div class="photo-row small" data-photos-for="${v.id}"></div>
        <div class="visit-actions">
          ${pending ? `<button type="button" class="btn btn-sm btn-ghost" data-action="rehand" data-visit="${v.id}">${icon('tablet', 16)} Repasser la tablette</button>` : ''}
          <button type="button" class="btn btn-sm btn-ghost" data-action="edit-visit" data-visit="${v.id}">${icon('edit', 16)} Modifier</button>
          <button type="button" class="btn btn-sm btn-quiet" data-action="delete-visit" data-visit="${v.id}">${icon('trash', 16)} Supprimer</button>
        </div>
      </li>`;
    })
    .join('')}</ol>`;
}

const isFilled = (c) => Boolean(c.firstName || c.lastName || c.phone || c.email);
// Titre de l'écran client : suit le prénom pendant que le client le corrige.
const leadOf = (c) =>
  c.firstName?.trim() ? `${c.firstName.trim()}, vérifiez vos coordonnées` : isFilled(c) ? 'Vérifiez vos coordonnées' : 'Vos coordonnées';

const fmtNext = (a) => `${fmtDayTitle(a.start)} à ${fmtTime(a.start)}`;
const viewClientNext = (a) =>
  a
    ? `<div class="client-next">${icon('calendar', 22)}<p><span>Votre prochain rendez-vous</span><strong>${fmtNext(a)}</strong></p></div>`
    : '';

function viewClient() {
  const c = S.checkout || {};
  const visit = S.handedVisit;
  const lead = esc(leadOf(c));
  const help = isFilled(c) ? 'corrigez ou complétez si besoin, puis validez.' : 'indiquez vos coordonnées, puis validez.';
  return `
  <main class="client">
    <aside class="client-aside">
      ${logo('lg')}
      <div class="thanks-head">
        <h1 class="serif">Votre visite</h1>
        <p class="muted">${visit ? fmtDateLong(visit.date) : ''}</p>
      </div>
      <ul class="done-list">
        ${(visit?.services || []).map((s) => `<li>${icon('check', 20)}${esc(s)}</li>`).join('')}
      </ul>
      ${viewClientNext(S.handedNext)}
      <button type="button" class="btn btn-quiet aside-foot" data-action="client-to-coiffeur">${icon('lock', 16)} Coiffeur</button>
    </aside>
    <section class="client-form">
      <form data-form="checkout" novalidate>
        <div class="form-head">
          <h2 class="serif">${lead}</h2>
          <p class="muted">Votre coiffeur vous confie la tablette : ${help}</p>
        </div>
        <div class="grid2">
          ${inputField('field field-lg', 'firstName', 'Prénom', 'text', c.firstName, 'autocomplete="off" autocapitalize="words" required')}
          ${inputField('field field-lg', 'lastName', 'Nom (facultatif)', 'text', c.lastName, 'autocomplete="off" autocapitalize="words"')}
        </div>
        <div class="grid-contact">
          ${inputField('field field-lg', 'phone', 'Téléphone', 'tel', c.phone, 'autocomplete="off" inputmode="tel" required')}
          ${inputField('field field-lg', 'email', 'E-mail (facultatif)', 'email', c.email, 'autocomplete="off" inputmode="email"')}
        </div>
        <label class="consent">
          <input type="checkbox" name="consent" ${c.consent ? 'checked' : ''}>
          <span class="box">${icon('check', 18)}</span>
          <span>J’accepte que H&amp;B Salon conserve ma fiche (coordonnées et historique de mes visites) pour mieux me conseiller.
          <small>Facultatif : sans votre accord, votre fiche n’est pas conservée. Vous pouvez demander à tout moment au salon de la modifier ou de la supprimer.</small></span>
        </label>
        <div class="form-actions form-actions-end">
          <button type="submit" id="checkout-submit" class="btn btn-accent btn-lg">Valider ${icon('check', 20)}</button>
        </div>
      </form>
      <button type="button" class="btn btn-quiet client-exit" data-action="client-to-coiffeur">${icon('lock', 16)} Coiffeur</button>
    </section>
  </main>`;
}

function viewThanks() {
  const name = S.thanksName ? ` ${esc(S.thanksName)}` : '';
  return `
  <main class="welcome thanks" data-action="welcome">
    ${logo('xl')}
    <div class="thanks-text">
      <h1 class="serif">Merci${name}, <br>à très bientôt !</h1>
      ${S.thanksNote ? `<p class="muted">${S.thanksNote}</p>` : ''}
      ${S.thanksNext ? `<p class="thanks-next">${icon('calendar', 20)} Prochain rendez-vous : ${fmtNext(S.thanksNext).replace(/^./, (ch) => ch.toLowerCase())}</p>` : ''}
      <p class="muted">Vous pouvez rendre la tablette à votre coiffeur.</p>
    </div>
  </main>`;
}

// ---------- Sauvegarde en ligne ----------

const DAY_MS = 24 * 60 * 60 * 1000;
const needsLogin = (st) => st.state === 'off' || st.state === 'auth';
const whenSynced = (iso) => (isToday(iso) ? `à ${fmtTime(iso)}` : `le ${fmtDayShort(iso)} à ${fmtTime(iso)}`);
const waiting = (n) => (n ? `${n} modification${n > 1 ? 's' : ''} en attente d’envoi` : '');
const lastLine = (st) => (st.lastAt ? `Dernière sauvegarde ${whenSynced(st.lastAt)}.` : '');

// Ce qu'on dit au coiffeur pour chaque état : ton (couleur), icône, titre, détail.
function syncView(st) {
  const pend = st.pending ? ` ${cap(waiting(st.pending))}.` : '';
  if (st.state === 'off') {
    return { tone: 'off', icon: 'cloudOff', title: 'Sauvegarde en ligne non activée', detail: 'Avec le compte du salon, les fiches des clients qui ont donné leur accord sont copiées en ligne et se retrouvent sur une autre tablette.' };
  }
  if (st.state === 'auth') {
    return { tone: 'error', icon: 'key', title: 'Connexion au compte expirée', detail: 'Retapez le mot de passe du compte du salon pour reprendre la sauvegarde. En attendant, les fiches restent sur la tablette.' };
  }
  if (st.state === 'syncing') return { tone: 'busy', icon: 'cloud', title: 'Sauvegarde en cours…', detail: lastLine(st) || 'Première copie de toutes les fiches.' };
  if (st.state === 'offline') {
    return { tone: 'wait', icon: 'clock', title: 'Hors ligne', detail: `Les fiches restent sur la tablette et partiront au retour du réseau.${pend} ${lastLine(st)}`.trim() };
  }
  if (st.state === 'error') {
    return { tone: 'error', icon: 'cloudOff', title: 'La sauvegarde ne passe pas', detail: `Les fiches sont bien sur la tablette et l’appli réessaie toute seule. Si ça dure plus d’un jour, prévenez la personne qui a installé l’appli.${pend}` };
  }
  if (st.pending) return { tone: 'wait', icon: 'clock', title: cap(waiting(st.pending)), detail: 'Envoi automatique dans quelques secondes.' };
  return { tone: 'ok', icon: 'check', title: 'Tout est sauvegardé', detail: lastLine(st) };
}

const syncStateInner = (v) =>
  `${icon(v.icon, 22)}<span class="sync-text"><span class="sync-title">${esc(v.title)}</span>${v.detail ? `<span class="sync-detail">${esc(v.detail)}</span>` : ''}</span>`;

// Le bouton de la barre du haut ne se signale que s'il faut agir ou s'inquiéter.
function syncAttention(st) {
  if (st.state === 'error' || st.state === 'auth') return 'error';
  if (st.state === 'offline' && (st.pending || !st.lastAt || Date.now() - new Date(st.lastAt) > DAY_MS)) return 'wait';
  return null;
}

function backupClass(st = sync.getStatus()) {
  const a = syncAttention(st);
  return `btn btn-ghost${a ? ` backup-${a}` : ''}`;
}

// Bouton bordé comme ses voisins ; une sauvegarde jamais activée se lit sans l'ouvrir.
function backupLabel(st = sync.getStatus()) {
  const a = syncAttention(st);
  const hint = { error: 'à vérifier', wait: 'envoi en attente' }[a];
  const off = st.state === 'off';
  const ic = a === 'error' || off ? 'cloudOff' : a === 'wait' ? 'clock' : 'cloud';
  if (off) return `${icon(ic, 18)}<span class="backup-text">Sauvegarde<span class="backup-off"> non activée</span></span>`;
  return `${icon(ic, 18)} Sauvegarde${hint ? `<span class="sr-only"> : ${hint}</span>` : ''}`;
}

function loginError(err) {
  if (err instanceof sync.NetworkError || !navigator.onLine) return 'Pas de connexion Internet. Réessayez une fois connecté.';
  if (err.code === 'email_not_confirmed') return 'Ce compte n’est pas encore confirmé.';
  if (err.status === 400) return 'E-mail ou mot de passe incorrect.';
  return 'Connexion impossible pour l’instant. Réessayez dans quelques minutes.';
}

// Export Excel : dans « Sauvegarde » (c'en est une copie) et dans « Réglages », où on le cherche aussi.
const viewExport = () => `
        <section class="dlg-section" aria-labelledby="sec-export">
          <h3 id="sec-export">Exporter pour Excel</h3>
          <p class="muted small">Fiches clients et historique, à ouvrir dans Excel. Les fichiers arrivent dans « Téléchargements » ; les photos n’y sont pas.</p>
          <div class="export-btns">
            <button type="button" class="btn btn-ghost" data-action="export-clients">${icon('download', 18)} Fiches clients</button>
            <button type="button" class="btn btn-ghost" data-action="export-visits">${icon('download', 18)} Historique des visites</button>
          </div>
        </section>`;

function viewModal() {
  const m = S.modal;
  let body = '';
  if (m.type === 'client') {
    const c = m.client;
    const input = (name, label, type, extra = '') => inputField('field', name, label, type, c[name], extra);
    body = `
      <form data-form="client" class="dialog" novalidate>
        <h2 class="serif" id="dlg-title">${c.id ? 'Modifier la fiche' : 'Nouveau client'}</h2>
        <div class="grid2">
          ${input('firstName', 'Prénom', 'text', 'data-autofocus autocomplete="off" autocapitalize="words" required')}
          ${input('lastName', 'Nom (facultatif)', 'text', 'autocomplete="off" autocapitalize="words"')}
          ${input('phone', 'Téléphone', 'tel', 'inputmode="tel" autocomplete="off" required')}
          ${input('email', 'E-mail (facultatif)', 'email', 'inputmode="email" autocomplete="off"')}
        </div>
        <label class="field">Allergies / sensibilités
          <textarea name="allergies" rows="2" autocomplete="off" placeholder="ex. Réaction à la PPD, cuir chevelu sensible">${esc(c.allergies)}</textarea>
        </label>
        ${c.id ? '' : '<p class="muted small">Le prénom et le téléphone suffisent : le client complètera le reste lui-même.</p>'}
        <div class="dup-slot"></div>
        <div class="form-actions split-actions">
          ${c.id ? `<button type="button" class="btn btn-danger-outline btn-sm" data-action="delete-client">${icon('trash', 16)} Supprimer la fiche</button>` : ''}
          <div class="actions-main">
            <button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
            <button type="submit" class="btn btn-accent" id="client-submit">${c.id ? 'Enregistrer' : 'Créer la fiche'}</button>
          </div>
        </div>
      </form>`;
  } else if (m.type === 'confirm-delete-client') {
    // Même franchise que la fenêtre RGPD : ce qui part, ce qui reste.
    const parts = [
      'ses coordonnées',
      m.draft ? 'la visite en cours' : '',
      m.visits ? (m.visits > 1 ? `ses ${m.visits} visites avec formules, notes et photos` : 'sa visite avec formule, note et photos') : '',
      m.past ? 'ses rendez-vous passés' : ''
    ].filter(Boolean);
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts.at(-1)}` : parts[0];
    body = `
      <div class="dialog dialog-sm">
        <h2 class="serif" id="dlg-title">Supprimer ${m.named ? `la fiche de ${esc(m.name)}` : 'cette fiche'} ?</h2>
        <p class="muted">La suppression efface ${list}, sur la tablette comme dans la sauvegarde en ligne. C’est définitif.</p>
        ${m.upcoming ? `<p class="muted">${m.upcoming > 1 ? `Ses ${m.upcoming} rendez-vous à venir restent` : 'Son rendez-vous à venir reste'} dans l’agenda, sur la tablette seulement.</p>` : ''}
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-action="keep-client" data-autofocus>Garder la fiche</button>
          <button type="button" class="btn btn-danger" data-action="confirm-delete-client">${icon('trash', 18)} Supprimer la fiche</button>
        </div>
      </div>`;
  } else if (m.type === 'backup') {
    const st = sync.getStatus();
    const v = syncView(st);
    const online = needsLogin(st)
      ? `<form data-form="login" class="backup-login" novalidate>
          <div class="grid2">
            ${inputField('field', 'email', 'E-mail du compte du salon', 'email', st.email, `inputmode="email" autocomplete="username"${st.email ? '' : ' data-autofocus'}`)}
            ${inputField('field', 'password', 'Mot de passe', 'password', '', `autocomplete="current-password"${st.email ? ' data-autofocus' : ''}`)}
          </div>
          <p class="err err-inline" id="login-err" role="alert"></p>
          <div class="form-actions"><button type="submit" class="btn btn-accent">Se connecter</button></div>
        </form>`
      : `<div class="sync-actions">
          <button type="button" class="btn btn-ghost" data-action="sync-now"${m.focusSignOut ? '' : ' data-autofocus'}>${icon('cloud', 18)} Synchroniser maintenant</button>
        </div>
        <div class="sync-account">
          <span>Compte du salon : <strong>${esc(st.email)}</strong></span>
          <button type="button" class="btn btn-quiet btn-sm" data-action="sign-out"${m.focusSignOut ? ' data-autofocus' : ''}>Se déconnecter</button>
        </div>`;
    body = `
      <div class="dialog">
        <h2 class="serif" id="dlg-title">Sauvegarde</h2>
        <div class="sync-state sync-${v.tone}" id="sync-state" role="status">${syncStateInner(v)}</div>
        ${online}
        ${viewExport()}
        <div class="form-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Fermer</button></div>
      </div>`;
  } else if (m.type === 'confirm-signout') {
    const n = m.pending;
    let pend = '';
    if (n && m.online) pend = `<p class="muted">${n > 1 ? `Les ${n} modifications en attente sont envoyées` : 'La modification en attente est envoyée'} avant l’arrêt.</p>`;
    else if (n) pend = `<p class="muted">Hors ligne : ${n > 1 ? `${n} modifications ne partiront pas` : 'une modification ne partira pas'} en ligne.</p>`;
    body = `
      <div class="dialog dialog-sm">
        <h2 class="serif" id="dlg-title">Arrêter la sauvegarde sur cette tablette ?</h2>
        <p class="muted">Les fiches restent sur la tablette, mais les prochaines modifications ne seront plus copiées en ligne.</p>
        ${pend}
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-action="cancel-signout" data-autofocus>Annuler</button>
          <button type="button" class="btn btn-danger-outline" data-action="confirm-signout">Arrêter la sauvegarde</button>
        </div>
      </div>`;
  } else if (m.type === 'no-consent') {
    const lost =
      m.visits > 1
        ? `vos coordonnées et l’historique de vos <strong>${m.visits} visites</strong>, avec leurs formules couleur et photos`
        : 'vos coordonnées et votre visite d’aujourd’hui';
    body = `
      <div class="dialog dialog-sm">
        <h2 class="serif" id="dlg-title">Ne pas conserver votre fiche ?</h2>
        <p class="muted">Sans votre accord, le salon efface ${lost}. Si vous préférez qu’il la garde, revenez cocher la case.</p>
        ${m.upcoming ? '<p class="muted">Vos prochains rendez-vous restent notés.</p>' : ''}
        <div class="choice-pair">
          <button type="button" class="btn btn-ghost btn-lg" data-action="back-to-consent" data-autofocus>Revenir à la case</button>
          <button type="button" class="btn btn-danger-outline btn-lg" data-action="confirm-no-consent">Ne pas conserver</button>
        </div>
      </div>`;
  } else if (m.type === 'settings') {
    body = `
      <div class="dialog dialog-settings">
        <div class="dlg-head">
          <h2 class="serif" id="dlg-title">Réglages</h2>
          <button type="button" class="btn btn-ghost btn-sm" data-action="close-modal">${icon('x', 18)} Fermer</button>
        </div>
        ${viewThemePicker()}
        <section class="dlg-section" aria-labelledby="sec-pin">
          <h3 id="sec-pin">Code de l’espace coiffeur</h3>
          <p class="muted small">Le code à 4 chiffres qui protège les fiches, les formules et l’agenda. L’espace se verrouille seul après 10 minutes sans activité.</p>
          <div><button type="button" class="btn btn-ghost" data-action="change-pin">${icon('key', 18)} Changer le code</button></div>
        </section>
        ${viewExport()}
      </div>`;
  } else if (m.type === 'appt') {
    body = viewApptDialog(m);
  } else if (m.type === 'confirm-delete') {
    const v = S.history.find((x) => x.id === m.visitId);
    // Ce qui part avec la visite, seulement ce qui existe.
    const parts = [
      v && hasFormula(v.formula) ? 'sa formule' : '',
      v?.note?.trim() ? 'sa note' : '',
      m.photos ? (m.photos > 1 ? `ses ${m.photos} photos` : 'sa photo') : ''
    ].filter(Boolean);
    const withParts = parts.length ? `, avec ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}` : parts[0]}` : '';
    body = `
      <div class="dialog dialog-sm">
        <h2 class="serif" id="dlg-title">Supprimer cette visite ?</h2>
        <p class="muted">Visite du ${v ? `${fmtDateMid(v.date)} à ${fmtTime(v.date)}` : ''}${withParts}. C’est définitif.</p>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-action="close-modal" data-autofocus>Annuler</button>
          <button type="button" class="btn btn-danger" data-action="confirm-delete">${icon('trash', 18)} Supprimer la visite</button>
        </div>
      </div>`;
  }
  return `<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="dlg-title">${body}</div>`;
}

const viewLightbox = (src) => `
  <div class="overlay enter" role="dialog" aria-modal="true" aria-label="Photo agrandie">
    <div class="lightbox" data-action="close-photo"><img src="${src}" alt="Photo agrandie"></div>
    <button type="button" class="btn btn-ghost lightbox-close" data-action="close-photo">${icon('x', 18)} Fermer</button>
  </div>`;

// Photos de l'historique lues une fois par visite ; seule la miniature est affichée (la pleine taille au zoom).
async function photosOfVisit(visitId) {
  if (!S.photoCache.has(visitId)) {
    const photos = await db.photosOf(visitId);
    S.photoCache.set(visitId, photos.map((p) => ({ id: p.id, thumb: p.thumb || p.blob })));
  }
  return S.photoCache.get(visitId);
}

async function hydratePhotos() {
  const els = [...app.querySelectorAll('[data-photos-for]')];
  const lists = await Promise.all(els.map((el) => photosOfVisit(el.dataset.photosFor)));
  els.forEach((el, i) => {
    if (!el.isConnected) return;
    el.innerHTML = lists[i]
      .map(
        (p, j) =>
          `<button type="button" class="photo" data-action="zoom" data-visit="${el.dataset.photosFor}" data-index="${j}" aria-label="Agrandir la photo ${j + 1}"><img src="${objUrl(p.thumb)}" alt="" loading="lazy" decoding="async"></button>`
      )
      .join('');
  });
}

// ---------- Données ----------

async function loadClients() {
  const [clients, visits] = await Promise.all([db.allClients(), db.allVisits()]);
  S.clients = clients;
  S.lastVisit = new Map();
  S.pending = new Map();
  S.todayVisits = new Map();
  for (const v of visits) {
    if (isToday(v.date)) {
      const t = S.todayVisits.get(v.clientId);
      const better = !t || (v.status === 'pending') > (t.status === 'pending') || (v.status === t.status && v.date > t.date);
      if (better) S.todayVisits.set(v.clientId, v);
    }
    const cur = S.lastVisit.get(v.clientId);
    if (!cur || v.date > cur) S.lastVisit.set(v.clientId, v.date);
    if (v.status === 'pending') S.pending.set(v.clientId, (S.pending.get(v.clientId) || 0) + 1);
  }
}

const pendingCount = () => S.history.filter((v) => v.status === 'pending').length;

const emptyDraft = () => ({ services: new Set(), formula: { brand: '', shade: '', oxidant: '', time: '' }, note: '', photos: [], removed: [] });
const dropDraft = (d) => d?.photos.forEach((p) => URL.revokeObjectURL(p.url));
const draftHasContent = (d) => Boolean(d && (d.editId || d.services.size || d.note.trim() || d.photos.length || hasFormula(d.formula)));

// Brouillon qui ne contient que les prestations cochées d'avance depuis le rendez-vous du jour.
const isAuto = (d) =>
  Boolean(d?.auto && !d.editId && !d.note.trim() && !d.photos.length && !hasFormula(d.formula) && d.services.size === d.auto.length && d.auto.every((s) => d.services.has(s)));

// Visites du jour en cours (prestations, formule, note, photos) recopiées sur la tablette : si Android
// ferme l'appli (appareil photo, manque de mémoire), on les retrouve sur la fiche au retour. Rangées
// avec les réglages, qui ne partent jamais en ligne ; oubliées le lendemain.
const DRAFTS_KEY = 'drafts';
let draftsTimer = null;
const keptOf = (d) =>
  d && !d.editId && draftHasContent(d) && !isAuto(d)
    ? { services: [...d.services], formula: { ...d.formula }, note: d.note, photos: d.photos.filter((p) => !p.id).map(({ blob, thumb }) => ({ blob, thumb })) }
    : null;

// Jour des visites en cours : elles restent datées de ce jour-là même si l'appli reste ouverte la nuit.
let draftsDay = new Date().toDateString();
let draftsSig = null; // dernier contenu écrit : un simple redessin ne réécrit pas les photos

function saveDraftsSoon() {
  clearTimeout(draftsTimer);
  draftsTimer = setTimeout(saveDrafts, 500);
}

async function saveDrafts() {
  const out = Object.fromEntries(S.savedDrafts);
  const keep = (id, d) => {
    delete out[id];
    const k = keptOf(d);
    if (k) out[id] = { ...k, day: draftsDay };
  };
  for (const [id, x] of S.drafts) keep(id, x.draft.editId ? x.stash : x.draft);
  if (S.clientId && S.draft) keep(S.clientId, S.draft.editId ? S.stash : S.draft);
  // Les photos comptent par leur taille : la signature reste légère, et un ajout ou un retrait la change.
  const sig = JSON.stringify(out, (k, v) => (v instanceof Blob ? `blob:${v.size}` : v));
  if (sig === draftsSig) return;
  await db.setSetting(DRAFTS_KEY, out);
  draftsSig = sig;
}

// Le lendemain, les visites en cours de la veille sont oubliées (même appli restée ouverte la nuit) :
// la fiche ouverte se referme, l'accueil montre la nouvelle journée.
function forgetYesterdayDrafts() {
  const day = new Date().toDateString();
  if (day === draftsDay) return false;
  draftsDay = day;
  for (const x of S.drafts.values()) {
    dropDraft(x.draft);
    dropDraft(x.stash);
  }
  S.drafts.clear();
  S.savedDrafts.clear();
  dropDraft(S.draft);
  dropDraft(S.stash);
  S.draft = emptyDraft();
  S.stash = null;
  S.clientId = null;
  S.client = null;
  saveDraftsSoon();
  return true;
}

async function loadSavedDrafts() {
  const day = new Date().toDateString();
  const all = (await db.getSetting(DRAFTS_KEY)) || {};
  S.savedDrafts = new Map(Object.entries(all).filter(([, v]) => v.day === day));
}

function restoreDraft(id) {
  const v = S.savedDrafts.get(id);
  if (!v) return null;
  S.savedDrafts.delete(id);
  const draft = emptyDraft();
  draft.services = new Set(v.services);
  Object.assign(draft.formula, v.formula);
  draft.note = v.note || '';
  draft.photos = (v.photos || []).map((p) => ({ ...p, url: URL.createObjectURL(p.thumb || p.blob) }));
  return { draft, stash: null };
}

// Met de côté la visite en cours du client affiché, pour la retrouver en revenant sur sa fiche.
function parkDraft() {
  if (!S.clientId || !S.draft) return;
  if ((draftHasContent(S.draft) && !isAuto(S.draft)) || S.stash) S.drafts.set(S.clientId, { draft: S.draft, stash: S.stash });
  else S.drafts.delete(S.clientId);
}

async function loadHistory() {
  S.history = await db.visitsOf(S.clientId);
  const withFormula = S.history.find((v) => hasFormula(v.formula));
  S.lastFormula = withFormula ? { formula: withFormula.formula, date: withFormula.date } : null;
  await loadNextAppt();
}

async function loadNextAppt() {
  if (!S.clientId) return;
  const now = new Date();
  S.nextAppt = (await db.appointmentsOf(S.clientId)).filter((a) => core.endOf(a) > now).sort((a, b) => a.start.localeCompare(b.start))[0] || null;
}

async function selectClient(id) {
  parkDraft();
  S.validated = null; // la ligne « a validé sa fiche » de l'accueil a servi
  dropNotices((n) => !n.visitId && !n.sync); // les simples informations ne suivent pas sur une fiche
  // Brouillon échangé avant toute attente : un second appel (double appui) range le bon brouillon.
  const saved = S.drafts.get(id) || restoreDraft(id);
  S.drafts.delete(id);
  S.clientId = id;
  S.draft = saved?.draft || emptyDraft();
  S.stash = saved?.stash || null;
  S.draftError = '';
  S.tab = 'visit';
  const client = await db.getClient(id);
  if (S.clientId !== id) return; // une autre fiche a été ouverte entre-temps
  S.client = client;
  await loadHistory();
  if (S.clientId !== id) return;
  precheck(id);
}

// Prestations prévues au rendez-vous du jour, cochées d'avance tant que sa visite n'est pas faite.
// Un simple coup d'œil à la fiche ne laisse pas de « visite en cours » derrière lui (isAuto).
function precheck(clientId) {
  if (draftHasContent(S.draft) || S.todayVisits.has(clientId)) return;
  const now = new Date();
  const mine = S.todayAppts.filter((a) => a.clientId === clientId).sort((a, b) => a.start.localeCompare(b.start));
  const a = mine.find((x) => core.endOf(x) > now) || mine.at(-1);
  if (!a?.services.length) return;
  S.draft.services = new Set(a.services);
  S.draft.auto = [...a.services];
}

async function showWeek(monday, focus = null) {
  S.week = monday;
  await loadWeek();
  render({ focus });
}

async function enterCoiffeur() {
  // Tablette reprise (ou fermée pour inactivité) avant que le client ait validé.
  if (S.handedVisit) {
    // La fiche affichée a pu se refermer entre-temps (minuit passé) : on la relit.
    const c = S.client?.id === S.handedVisit.clientId ? S.client : await db.getClient(S.handedVisit.clientId);
    dropNotices((n) => n.visitId === S.handedVisit.id);
    addNotice({
      text: hasName(c)
        ? `${fullName(c)} n’a pas validé sa visite.`
        : c
          ? `Une visite (fiche du ${fmtDayShort(c.createdAt)}) n’a pas été validée.`
          : 'Une visite n’a pas été validée.',
      name: c?.firstName || c?.lastName || '',
      visitId: S.handedVisit.id,
      clientId: S.handedVisit.clientId
    });
    S.handedVisit = null;
    S.handedNext = null;
    S.checkout = null;
  }
  S.autoLocked = false;
  S.moving = null; // un déplacement laissé en plan au verrouillage n'attend plus à la reprise
  if (forgetYesterdayDrafts()) await purgePastLocalOnly();
  await loadClients();
  await refreshAppts();
  if (S.clientId) await selectClient(S.clientId);
  go('coiffeur');
  scrollPlanToNow();
  if (S.lockedModal) {
    const held = S.lockedModal;
    S.lockedModal = null;
    openModal(held);
  }
  // Une ligne à l'accueil referme la boucle (le toast passait inaperçu) ; le lecteur d'écran l'entend.
  if (S.validated) {
    announce(`${S.validated.name} a validé sa fiche.`);
    clearTimeout(validatedTimer);
    validatedTimer = setTimeout(hideValidated, VALIDATED_MS);
  }
}

// La ligne « a validé sa fiche » s'efface d'elle-même après quelques secondes, en fondu, sans redessiner
// l'écran (le coiffeur peut être en train de taper une recherche).
function hideValidated() {
  S.validated = null;
  const line = app.querySelector('.validated-line');
  if (!line) return;
  line.classList.add('leave');
  setTimeout(() => line.remove(), 200);
}

// Fin de la modification d'une visite : on retrouve le brouillon du jour.
function endEdit() {
  dropDraft(S.draft);
  S.draft = S.stash || emptyDraft();
  S.stash = null;
  S.draftError = '';
}

function checkServices() {
  if (S.draft.services.size) return true;
  S.draftError = 'Cochez au moins une prestation.';
  render();
  announce(S.draftError);
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  app.querySelector('.services')?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  app.querySelector('.service')?.focus({ preventScroll: true });
  return false;
}

// Prochain rendez-vous à partir de demain : celui d'aujourd'hui, c'est la visite en cours.
async function nextVisitOf(clientId) {
  const d = new Date();
  const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
  return (await db.appointmentsOf(clientId)).filter((a) => a.start >= tomorrow).sort((a, b) => a.start.localeCompare(b.start))[0] || null;
}

async function handTo(visit) {
  parkDraft(); // une visite déjà commencée pour ce client est retrouvée au retour
  const c = S.client || {};
  S.handedNext = await nextVisitOf(visit.clientId);
  S.handedVisit = visit;
  S.checkout = { firstName: c.firstName || '', lastName: c.lastName || '', phone: fmtPhone(c.phone), email: c.email || '', consent: Boolean(c.consentAt) };
  go('client');
}

// ---------- PIN ----------

function startLockTicker() {
  clearInterval(lockTicker);
  lockTicker = setInterval(() => {
    const left = lockLeft();
    if (left <= 0) {
      clearInterval(lockTicker);
      if (S.view === 'pin') {
        S.pin.error = '';
        render({ focus: '[data-key="1"]' });
        announce('Clavier débloqué');
      }
      return;
    }
    const el = S.view === 'pin' && app.querySelector('.pin .err');
    if (el) el.textContent = lockMsg(left);
  }, 1000);
}

async function pinDigit(k) {
  const p = S.pin;
  if (Date.now() < S.pinLockedUntil) return;
  const len = p.mode === 'recover' ? RECOVERY_LEN : 4;
  if (p.entry.length >= len) return;
  p.entry += k;
  p.error = '';
  render();
  announce(`${p.entry.length} chiffre${p.entry.length > 1 ? 's' : ''} sur ${len}`);
  if (p.entry.length < len) return;

  if (p.mode === 'unlock' || p.mode === 'recover') {
    // Le code de déblocage se vérifie lentement (exprès) : une à deux secondes sur la tablette.
    if (p.mode === 'recover') {
      p.checking = true;
      render();
      announce('Vérification du code');
    }
    const ok =
      p.mode === 'unlock'
        ? (await hashPin(p.entry)) === (await db.getSetting('pinHash'))
        : (await hashRecovery(p.entry)) === RECOVERY_HASH;
    p.checking = false;
    if (ok) {
      S.pinFails = 0;
      db.setSetting('pinLock', null);
      if (p.mode === 'unlock') {
        p.next();
        return;
      }
      p.mode = 'new';
      p.entry = '';
      p.recovered = true;
    } else {
      S.pinFails++;
      p.entry = '';
      if (S.pinFails >= PIN_MAX_TRIES) {
        S.pinFails = 0;
        S.pinLockedUntil = Date.now() + PIN_LOCKOUT_MS;
        startLockTicker();
        announce(lockMsg(PIN_LOCKOUT_MS / 1000));
      } else {
        const left = PIN_MAX_TRIES - S.pinFails;
        p.error = p.mode === 'unlock' ? 'Code incorrect' : 'Code de déblocage incorrect';
        if (left <= 2) p.error += `, encore ${left} essai${left > 1 ? 's' : ''}`;
        announce(p.error);
      }
      // Gardé en base : recharger la page ne remet pas le compteur à zéro.
      db.setSetting('pinLock', { fails: S.pinFails, until: S.pinLockedUntil });
    }
  } else if (p.mode === 'new') {
    p.first = p.entry;
    p.entry = '';
    p.mode = 'confirm';
  } else if (p.mode === 'confirm') {
    if (p.entry === p.first) {
      await db.setSetting('pinHash', await hashPin(p.entry));
      const first = !p.cancel && !p.recovered; // premier lancement
      p.next();
      toast(first ? 'Code enregistré' : 'Nouveau code enregistré');
      return;
    }
    p.entry = '';
    p.first = '';
    p.mode = 'new';
    p.error = 'Les deux codes ne correspondent pas. Choisissez à nouveau votre code, puis confirmez-le.';
    announce(p.error);
  }
  // Code complet traité (étape suivante, erreur ou blocage) : le focus revient au titre.
  setTimeout(() => render({ focus: '.pin h1' }), 150);
}

// ---------- Export CSV ----------

function csv(rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    // Texte saisi par un client qui commence comme une formule (=, +, -, @) : Excel l'exécuterait.
    // L'apostrophe en tête le garde en texte.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`Fichier ${name} téléchargé`);
}

const stamp = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ, heure locale
const dateFr = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const consentCsv = (c) => dateFr(c.consentAt);

async function exportClients() {
  await loadClients();
  const visits = await db.allVisits();
  const count = new Map();
  visits.forEach((v) => count.set(v.clientId, (count.get(v.clientId) || 0) + 1));
  const rows = [['Prénom', 'Nom', 'Téléphone', 'E-mail', 'Allergies / sensibilités', 'Consentement RGPD', 'Fiche créée le', 'Nb visites', 'Dernière visite']];
  [...S.clients]
    .sort((a, b) => norm(a.lastName + a.firstName).localeCompare(norm(b.lastName + b.firstName)))
    .forEach((c) =>
      rows.push([c.firstName, c.lastName, fmtPhone(c.phone), c.email, c.allergies, consentCsv(c), dateFr(c.createdAt), count.get(c.id) || 0, dateFr(S.lastVisit.get(c.id))])
    );
  download(`hb-salon-clients-${stamp()}.csv`, csv(rows));
}

async function exportVisits() {
  await loadClients();
  const byId = new Map(S.clients.map((c) => [c.id, c]));
  const visits = (await db.allVisits()).sort((a, b) => b.date.localeCompare(a.date));
  const rows = [['Date', 'Prénom', 'Nom', 'Téléphone', 'Prestations', 'Marque', 'Nuance', 'Oxydant', 'Temps de pose', 'Note interne', 'Validée par le client', 'Consentement RGPD', 'Nb photos']];
  for (const v of visits) {
    const c = byId.get(v.clientId) || {};
    const photoCount = await db.photoCount(v.id);
    rows.push([
      dateFr(v.date), c.firstName, c.lastName, fmtPhone(c.phone), v.services.join(', '),
      v.formula.brand, v.formula.shade, v.formula.oxidant, v.formula.time, v.note,
      v.status === 'done' ? 'oui' : 'non', consentCsv(c), photoCount
    ]);
  }
  download(`hb-salon-visites-${stamp()}.csv`, csv(rows));
}

// ---------- Formulaires ----------

// Prénom et téléphone obligatoires (nom et e-mail facultatifs) ; `you` : messages adressés au client.
function validateContact(val, strict, you = true) {
  const errors = {};
  if (strict && !val('firstName')) errors.firstName = you ? 'Indiquez votre prénom.' : 'Indiquez le prénom.';
  const phone = digits(val('phone'));
  if (strict && !val('phone')) errors.phone = you ? 'Indiquez votre numéro de téléphone.' : 'Indiquez le numéro de téléphone.';
  else if (val('phone') && (phone.length < 6 || phone.length > 15)) errors.phone = 'Numéro incomplet : vérifiez les chiffres.';
  if (val('email') && !EMAIL_RE.test(val('email'))) errors.email = 'Adresse incomplète, par exemple prenom@exemple.fr';
  return errors;
}

// Fiches qui ressemblent à celle qu'on crée. La même personne d'abord : même nom complet, ou même prénom
// au même numéro (parent et enfant partagent souvent un téléphone, comme dans l'agenda : la fiche du même
// prénom est la bonne). Sinon, toutes les fiches du numéro (la famille).
function findDuplicates(val) {
  const phone = digits(val('phone'));
  const first = norm(val('firstName'));
  const last = norm(val('lastName'));
  const atPhone = phone.length >= 6 ? S.clients.filter((c) => digits(c.phone) === phone) : [];
  const same = S.clients.filter(
    (c) => first && norm(c.firstName) === first && ((last && norm(c.lastName) === last) || atPhone.includes(c))
  );
  return same.length ? { same: same[0] } : atPhone.length ? { family: atPhone } : null;
}

const MAX_DUP = 3; // fiches de la famille proposées au plus (au-delà, la recherche les retrouve)

// Message de doublon, sous le formulaire : la même personne s'ouvre en action principale ; une famille
// au même numéro laisse « Créer quand même » en or (c'est souvent un enfant qu'on ajoute).
function viewDuplicate(dup) {
  if (dup.same) {
    const c = dup.same;
    return `<div class="notice notice-inline" role="alert">${icon('info', 20)}
      <span>Une fiche existe déjà : <strong>${esc(fullName(c))}</strong>${c.phone ? `, ${esc(fmtPhone(c.phone))}` : ''}.</span>
      <button type="button" class="btn btn-sm btn-accent" data-action="open-dup" data-id="${c.id}" data-link="1">Ouvrir cette fiche</button></div>`;
  }
  const list = dup.family.slice(0, MAX_DUP);
  const phone = esc(fmtPhone(list[0].phone));
  const names = list.map((c) => `<strong>${esc(fullName(c))}</strong>`);
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : names[0];
  const buttons = list
    .map((c) => `<button type="button" class="btn btn-sm btn-ghost" data-action="open-dup" data-id="${c.id}">${list.length > 1 ? `Ouvrir ${esc(c.firstName || fullName(c))}` : 'Ouvrir cette fiche'}</button>`)
    .join('');
  return `<div class="notice notice-inline notice-dup" role="alert">${icon('info', 20)}
    <span>Le ${phone} est déjà sur ${list.length > 1 ? 'les fiches de' : 'la fiche de'} ${who}. Même famille ?</span>
    <span class="dup-actions">${buttons}</span></div>`;
}

// Affiche chaque erreur sous son champ et place le focus sur le premier champ en erreur.
function showErrors(form, errors) {
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll('.field-err').forEach((el) => (el.textContent = ''));
  let first = null;
  for (const [name, message] of Object.entries(errors)) {
    const input = form.elements[name];
    input?.setAttribute('aria-invalid', 'true');
    const slot = form.querySelector(`#err-${name}`);
    if (slot) slot.textContent = message;
    first ??= input;
  }
  first?.focus();
  return Boolean(first);
}

// ---------- Actions ----------

// La visite et ses photos, puis la tablette au client. Une photo qui ne s'enregistre pas défait la visite :
// le brouillon reste, un nouvel appui ne crée pas de doublon.
async function handOver() {
  const d = S.draft;
  const visit = await db.saveVisit({
    clientId: S.clientId,
    services: SERVICES.filter((s) => d.services.has(s)),
    formula: { ...d.formula },
    note: d.note.trim(),
    status: 'pending'
  });
  try {
    for (const p of d.photos) await db.addPhoto(visit.id, p.blob, p.thumb);
  } catch (err) {
    await db.deleteVisit(visit.id, false);
    throw err;
  }
  dropDraft(d);
  S.draft = emptyDraft();
  await handTo(visit);
}

async function saveEdit() {
  const d = S.draft;
  const visit = await db.getVisit(d.editId);
  await db.saveVisit({ ...visit, services: SERVICES.filter((s) => d.services.has(s)), formula: { ...d.formula }, note: d.note.trim() });
  for (const id of d.removed) await db.deletePhoto(id);
  for (const p of d.photos) if (!p.id) await db.addPhoto(visit.id, p.blob, p.thumb);
  S.photoCache.delete(visit.id);
  endEdit();
  await loadHistory();
  S.tab = 'history';
  render({ top: true });
  toast('Visite modifiée');
}

const actions = {
  unlock: () => askPin(enterCoiffeur, () => go('welcome')),
  'pin-key': (el) => pinDigit(el.dataset.key),
  'pin-back': () => {
    if (Date.now() < S.pinLockedUntil) return;
    S.pin.entry = S.pin.entry.slice(0, -1);
    render();
  },
  'pin-cancel': () => {
    // Abandon du déblocage ou du nouveau code qui le suit : retour à la saisie du code habituel.
    if (S.pin.mode === 'recover' || S.pin.recovered) {
      Object.assign(S.pin, { mode: 'unlock', entry: '', first: '', error: '', recovered: false });
      render();
    } else S.pin.cancel?.();
  },
  'pin-forgot': () => {
    Object.assign(S.pin, { mode: 'recover', entry: '', error: '' });
    render();
  },
  lock: () => {
    parkDraft();
    S.moving = null;
    S.lockedModal = null;
    S.clientId = null;
    S.client = null;
    S.query = '';
    go('welcome');
  },
  'change-pin': () => {
    S.pin = { mode: 'new', entry: '', first: '', error: '', inside: true, next: () => go('coiffeur'), cancel: () => go('coiffeur') };
    go('pin');
  },
  backup: () => openModal({ type: 'backup' }),
  settings: () => openModal({ type: 'settings' }),
  // La fenêtre reste ouverte : on peut en essayer plusieurs de suite.
  'set-theme': (el) => {
    const id = applyTheme(el.dataset.id, { save: true });
    render({ focus: `.theme-tile[data-id="${id}"]` });
    announce(`Thème ${THEMES.find((t) => t.id === id).name} appliqué`);
  },
  'sync-now': () => {
    if (navigator.onLine) sync.syncNow();
    else toast('Pas de réseau pour l’instant : l’envoi partira tout seul au retour du réseau.');
  },
  // Pas d'openModal : on reste dans la fenêtre Sauvegarde, dont le retour de focus est déjà noté.
  'sign-out': () => {
    hideToast();
    S.modal ={ type: 'confirm-signout', pending: sync.getStatus().pending, online: navigator.onLine };
    render();
  },
  'cancel-signout': () => {
    S.modal = { type: 'backup', focusSignOut: true };
    render();
  },
  'confirm-signout': async (el) => {
    el.disabled = true;
    if (navigator.onLine) await sync.syncNow();
    await sync.signOut();
    S.modal = { type: 'backup' };
    render();
    toast('Sauvegarde en ligne arrêtée sur cette tablette');
  },
  // Depuis l'agenda, « Aujourd'hui » retrouve l'écran laissé (la fiche ouverte, s'il y en avait une) ;
  // sur « Aujourd'hui », il ramène au planning : la fiche se referme, sa visite en cours est mise de côté.
  // Un déplacement commencé dans l'agenda est abandonné.
  space: async (el) => {
    const was = S.space;
    S.space = el.dataset.space;
    S.moving = null;
    if (S.space === 'agenda') await loadWeek();
    else if (was === 'today') {
      parkDraft();
      Object.assign(S, { clientId: null, client: null, query: '' });
    }
    render({ focus: `[data-space="${S.space}"]` });
    scrollPlanToNow();
  },
  slot: (el) => {
    const start = el.dataset.start;
    if (S.moving) moveTo(start, selectorOf(el));
    else openModal(newApptModal(start));
  },
  appt: (el) => {
    if (S.moving) {
      S.moving.error = S.moving.id === el.dataset.id ? 'C’est son horaire actuel. Touchez un créneau libre.' : 'Ce créneau est déjà pris. Touchez un créneau libre.';
      S.refused = selectorOf(el);
      render();
      S.refused = null;
      announce(S.moving.error);
      return;
    }
    const a = findAppt(el.dataset.id);
    if (a) openApptModal(a);
  },
  // Fiche touchée : son prénom remplit le champ ; touchée à nouveau, elle est oubliée avec lui.
  'appt-who': async (el) => {
    const m = S.modal;
    const was = m.clientId;
    m.clientId = was === el.dataset.id ? null : el.dataset.id;
    m.firstName = m.clientId ? apptFirstName(m) : was ? '' : m.firstName;
    m.other = false;
    m.prev = m.clientId ? await db.appointmentsOf(m.clientId) : [];
    m.error = '';
    m.whoError = '';
    prefill(m);
    render();
  },
  'appt-other': () => {
    const m = S.modal;
    if (m.clientId) m.firstName = ''; // le prénom venait de la fiche touchée
    m.other = !m.other;
    m.clientId = null;
    m.prev = [];
    m.error = '';
    m.whoError = '';
    prefill(m);
    render({ focus: m.other ? '[name="apptFirst"]' : null });
  },
  'appt-service': (el) => {
    const m = S.modal;
    const s = el.dataset.service;
    m.services.has(s) ? m.services.delete(s) : m.services.add(s);
    m.error = '';
    m.changed = true;
    m.lateOk = false;
    prefill(m);
    render();
    announceSpan(m, `${s} ${m.services.has(s) ? 'cochée' : 'décochée'}, durée ${core.fmtDuration(m.duration)}`);
  },
  'appt-time': (el) => {
    const m = S.modal;
    const start = new Date(m.start);
    const min = Math.min(Math.max(core.minutesOf(start) + Number(el.dataset.step), core.OPEN_MIN), core.CLOSE_MIN - core.STEP_MIN);
    m.start = atMinutes(start, min).toISOString();
    m.error = '';
    m.changed = true;
    m.lateOk = false;
    render();
    announceSpan(m, fmtMin(min));
  },
  'appt-dur': (el) => {
    const m = S.modal;
    m.duration = Math.max(core.STEP_MIN, m.duration + Number(el.dataset.step));
    m.durationSet = true;
    m.error = '';
    m.changed = true;
    m.lateOk = false;
    render();
    announceSpan(m, `Durée ${core.fmtDuration(m.duration)}`);
  },
  'appt-move': () => {
    const a = findAppt(S.modal.id);
    // L'horaire de départ reste écrit sous le titre : le bloc d'origine peut être dans une autre semaine.
    S.moving = { id: a.id, name: apptName(a), from: `${fmtDayTitle(a.start).toLowerCase()} à ${fmtTime(a.start)}`, error: '' };
    S.space = 'agenda';
    S.modal = null;
    S.modalReturn = null;
    render({ focus: '[data-action="move-cancel"]' });
    announce(`Touchez le nouveau créneau de ${apptName(a)}.`);
  },
  'move-cancel': () => {
    S.moving = null;
    render({ focus: '.agenda-head h1' });
  },
  undo: undoAgenda,
  'show-appt': async (el) => {
    const a = await db.getAppointment(el.dataset.id);
    if (!a) return;
    S.space = 'agenda';
    S.week = core.weekStart(new Date(a.start));
    await loadWeek();
    S.flash = a.id;
    render({ focus: `[data-action="appt"][data-id="${a.id}"]` });
    S.flash = null;
  },
  'appt-open': () => openApptClient(findAppt(S.modal.id)),
  'today-appt': (el) => openApptClient(findAppt(el.dataset.id)),
  'today-edit': (el) => {
    const a = findAppt(el.dataset.id);
    if (a) openApptModal(a);
  },
  // Pas de fenêtre de confirmation : l'annulation se défait d'un appui (« Rétablir » sous le titre).
  'appt-cancel': () => cancelAppt(findAppt(S.modal.id)),
  'week-prev': () => showWeek(addDays(S.week, -7)),
  'week-next': () => showWeek(addDays(S.week, 7)),
  'week-now': async () => {
    await showWeek(core.defaultWeek(new Date()), '[data-action="week-next"]');
    scrollPlanToNow();
  },
  'export-clients': exportClients,
  'export-visits': exportVisits,
  select: async (el) => {
    await selectClient(el.dataset.id);
    render({ top: true });
  },
  // Le champ garde le focus : on efface pour taper autre chose.
  'clear-search': () => {
    S.query = '';
    const input = app.querySelector('#search');
    input.value = '';
    app.querySelector('#results').innerHTML = viewResults();
    input.focus();
  },
  'new-client': () => openModal({ type: 'client', client: { firstName: '', lastName: '', phone: '', email: '', allergies: '' } }),
  // Recherche sans résultat : la fiche part de ce qui a été tapé (numéro, ou prénom puis nom).
  'new-client-search': () => {
    const q = S.query.trim();
    const words = q.split(/\s+/);
    const named = hasLetters(q);
    openModal({
      type: 'client',
      client: { firstName: named ? capName(words[0]) : '', lastName: named ? capName(words.slice(1).join(' ')) : '', phone: named ? '' : fmtPhone(q), email: '', allergies: '' }
    });
  },
  'delete-client': async () => {
    const m = S.modal;
    const form = app.querySelector('[data-form="client"]');
    const typed = form ? Object.fromEntries(new FormData(form)) : {};
    const client = await db.getClient(m.client.id);
    const nowIso = new Date().toISOString();
    const appts = await db.appointmentsOf(client.id);
    const upcoming = appts.filter((a) => a.start >= nowIso).length;
    openModal({
      type: 'confirm-delete-client',
      id: client.id,
      named: hasName(client),
      name: fullName(client),
      visits: (await db.visitsOf(client.id)).length,
      draft: S.drafts.has(client.id) || S.savedDrafts.has(client.id) || (S.clientId === client.id && draftHasContent(S.draft) && !isAuto(S.draft)),
      past: appts.length - upcoming,
      upcoming,
      back: { modal: { ...m, client: { ...m.client, ...typed } }, ret: S.modalReturn } // la saisie en cours est retrouvée
    });
  },
  'keep-client': () => {
    const { modal, ret } = S.modal.back;
    S.modal = modal;
    S.modalReturn = ret;
    render({ focus: '[data-action="delete-client"]' });
  },
  // Comme après un refus RGPD : visites, photos et rendez-vous passés effacés (aussi en ligne),
  // rendez-vous à venir gardés sur la tablette seulement.
  'confirm-delete-client': async (el) => {
    el.disabled = true;
    const id = S.modal.id;
    const client = await db.getClient(id);
    const kept = await db.detachAppointments(id, new Date().toISOString());
    await db.deleteClient(id);
    const parked = S.drafts.get(id);
    dropDraft(parked?.draft);
    dropDraft(parked?.stash);
    S.drafts.delete(id);
    S.savedDrafts.delete(id);
    dropNotices((n) => n.clientId === id);
    if (S.clientId === id) {
      dropDraft(S.draft);
      dropDraft(S.stash);
      Object.assign(S, { clientId: null, client: null, draft: emptyDraft(), stash: null, history: [], nextAppt: null, tab: 'visit' });
    }
    S.photoCache.clear();
    await loadClients();
    await refreshAppts();
    S.modal = null;
    S.modalReturn = null;
    const who = hasName(client) ? `de ${fullName(client)}` : `créée le ${fmtDayShort(client.createdAt)}${client.phone ? ` (${fmtPhone(client.phone)})` : ''}`;
    addNotice({ text: `Fiche ${who} supprimée.${keptText(kept)}` });
    render({ focus: CALM_FOCUS });
  },
  'edit-client': () => openModal({ type: 'client', client: { ...S.client, phone: fmtPhone(S.client.phone) } }),
  'close-modal': closeModal,
  tab: (el) => {
    S.tab = el.dataset.tab;
    render({ top: true });
  },
  'toggle-service': (el) => {
    const s = el.dataset.service;
    S.draft.services.has(s) ? S.draft.services.delete(s) : S.draft.services.add(s);
    S.draftError = '';
    // Redessin complet si la formule apparaît, ou si le bouton or doit changer de place (visite déjà passée au client).
    if (s === 'Coloration' || app.querySelector('.waiting, .visit-done')) {
      render();
      return;
    }
    el.setAttribute('aria-pressed', S.draft.services.has(s));
    app.querySelector('#services-err').textContent = '';
    const reuse = app.querySelector('[data-action="reuse-services"]');
    if (reuse) reuse.disabled = S.draft.services.size > 0;
  },
  'reuse-services': () => {
    S.draft.services = new Set(S.history[0].services);
    S.draftError = '';
    render({ focus: '.service' });
  },
  'dismiss-notice': (el) => {
    S.notices.splice(Number(el.dataset.index), 1);
    render({ focus: CALM_FOCUS });
  },
  'rehand-notice': async (el) => {
    const notice = S.notices[Number(el.dataset.index)];
    await selectClient(notice.clientId);
    const visit = S.history.find((v) => v.id === notice.visitId);
    dropNotices((n) => n.visitId === notice.visitId);
    if (visit) await handTo(visit);
    else render({ top: true });
  },
  'back-to-consent': () => {
    S.modal = null;
    S.modalReturn = null;
    render({ focus: '[name="consent"]' });
  },
  'open-dup': async (el) => {
    const apptId = el.dataset.link ? S.modal.apptId : null; // même personne : le rendez-vous sans fiche la rejoint
    S.modal = null;
    S.modalReturn = null;
    if (apptId) await linkAppt(apptId, S.clients.find((c) => c.id === el.dataset.id));
    await selectClient(el.dataset.id);
    render({ top: true, focus: '.client-head h1' });
  },
  'reuse-formula': () => {
    S.draft.formula = { ...S.lastFormula.formula };
    render();
    toast(`Formule du ${fmtDayShort(S.lastFormula.date)} reprise`);
  },
  'add-photo': () => app.querySelector('[data-photo]')?.click(),
  'remove-photo': (el) => {
    const [p] = S.draft.photos.splice(Number(el.dataset.index), 1);
    if (p.id) S.draft.removed.push(p.id);
    URL.revokeObjectURL(p.url);
    render();
  },
  zoom: async (el) => {
    const cached = S.photoCache.get(el.dataset.visit)?.[Number(el.dataset.index)];
    const photo = cached && (await db.getPhoto(cached.id));
    if (!photo) return;
    S.modalReturn = selectorOf(el);
    S.modal = { type: 'photo', url: URL.createObjectURL(photo.blob) };
    // Pas de render() complet : la fenêtre photo est ajoutée par-dessus l'écran.
    app.firstElementChild.inert = true;
    app.insertAdjacentHTML('beforeend', viewLightbox(S.modal.url));
    app.querySelector('.lightbox-close').focus();
  },
  'close-photo': () => {
    if (S.modal?.url) URL.revokeObjectURL(S.modal.url);
    app.querySelector('.overlay')?.remove();
    app.firstElementChild.inert = false;
    S.modal = null;
    const back = S.modalReturn && app.querySelector(S.modalReturn);
    S.modalReturn = null;
    back?.focus({ preventScroll: true });
  },
  handover: async () => {
    if (S.photoBusy || S.saving || !checkServices()) return;
    S.saving = true;
    try {
      await handOver();
    } finally {
      S.saving = false;
    }
  },
  rehand: async (el) => {
    const visit = S.history.find((v) => v.id === el.dataset.visit);
    if (S.draft.editId) endEdit();
    if (visit) await handTo(visit);
  },
  'edit-visit': async (el) => {
    const visit = S.history.find((v) => v.id === el.dataset.visit);
    if (!visit) return;
    const photos = await db.photosOf(visit.id);
    if (S.draft.editId) dropDraft(S.draft);
    else S.stash = S.draft;
    S.draft = {
      services: new Set(visit.services),
      formula: { brand: '', shade: '', oxidant: '', time: '', ...visit.formula },
      note: visit.note,
      photos: photos.map((p) => ({ id: p.id, blob: p.blob, thumb: p.thumb, url: URL.createObjectURL(p.thumb || p.blob) })),
      removed: [],
      editId: visit.id,
      editDate: visit.date
    };
    S.draftError = '';
    S.tab = 'visit';
    render({ top: true, focus: '[data-action="cancel-edit"]' });
  },
  'cancel-edit': () => {
    endEdit();
    S.tab = 'history';
    render({ top: true, focus: '#tab-history' });
  },
  'save-edit': async () => {
    if (S.photoBusy || S.saving || !checkServices()) return;
    S.saving = true;
    try {
      await saveEdit();
    } finally {
      S.saving = false;
    }
  },
  'delete-visit': async (el) => openModal({ type: 'confirm-delete', visitId: el.dataset.visit, photos: await db.photoCount(el.dataset.visit) }),
  'confirm-delete': async () => {
    const id = S.modal.visitId;
    await db.deleteVisit(id);
    S.photoCache.delete(id);
    dropNotices((n) => n.visitId === id);
    if (S.draft.editId === id) endEdit();
    await Promise.all([loadHistory(), loadClients()]);
    S.modal = null;
    S.modalReturn = null;
    render({ focus: '#tab-history' });
    toast('Visite supprimée');
  },
  'confirm-no-consent': async () => {
    const client = await db.getClient(S.handedVisit.clientId);
    const kept = await db.detachAppointments(client.id, new Date().toISOString()); // rendez-vous à venir gardés sur la tablette
    await db.deleteClient(client.id);
    dropDraft(S.drafts.get(client.id)?.draft);
    S.drafts.delete(client.id);
    S.savedDrafts.delete(client.id);
    dropNotices((n) => n.clientId === client.id);
    const who = hasName(client) ? `de ${fullName(client)}` : `créée le ${fmtDayShort(client.createdAt)}${client.phone ? ` (${fmtPhone(client.phone)})` : ''}`;
    addNotice({ text: `Fiche ${who} effacée : le client n’a pas donné son accord.${keptText(kept)}` });
    finishCheckout(S.checkout.firstName.trim(), 'Votre fiche n’a pas été conservée.');
  },
  'client-to-coiffeur': () => askPin(enterCoiffeur, () => go('client')),
  stay: () => {},
  welcome: () => go('welcome')
};

const KEEP_NOTE = new Set(['undo', 'space', 'week-prev', 'week-next', 'week-now', 'slot', 'appt', 'close-modal']);
app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  // Un choix touché prend le focus : le champ de saisie le perd et le clavier Android se referme.
  if (el.tagName === 'BUTTON' && el.dataset.action !== 'stay' && document.activeElement !== el) el.focus({ preventScroll: true });
  // Le message de l'agenda ne vaut que jusqu'à l'action suivante. Tant qu'il offre « Rétablir », il survit aux
  // changements d'espace ou de semaine et aux appuis sans suite (créneau touché par erreur, fenêtre refermée) ;
  // une simple confirmation, elle, ne suit pas ailleurs.
  if (S.note && !(el.dataset.action === 'undo' || (S.note.undo && (S.modal || KEEP_NOTE.has(el.dataset.action))))) S.note = null;
  const fn = actions[el.dataset.action];
  if (fn) fn(el, e);
});

function bindCheckout(el) {
  if (el.form?.dataset.form !== 'checkout' || !S.checkout) return;
  S.checkout[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  if (el.name === 'firstName') app.querySelector('.form-head h2').textContent = leadOf(S.checkout);
}

// Toucher « Je continue » ne doit pas retirer le focus du champ en cours (le clavier Android resterait fermé).
app.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.idle-warn')) e.preventDefault();
});

// Téléphone mis en forme (98.62.13) en quittant le champ, comme partout ailleurs dans l'appli.
app.addEventListener('focusout', (e) => {
  const el = e.target;
  // Téléphone du nouveau rendez-vous : même mise en forme (la recherche ne regarde que les chiffres).
  if (el.name === 'apptQuery' && S.modal?.type === 'appt' && !hasLetters(el.value) && fmtPhone(el.value) !== el.value) {
    el.value = fmtPhone(el.value);
    S.modal.query = el.value;
    return;
  }
  if (el.type === 'tel' && fmtPhone(el.value) !== el.value) {
    el.value = fmtPhone(el.value);
    bindCheckout(el);
  }
  checkFieldOnLeave(el);
});

// Téléphone ou e-mail mal formé : l'erreur apparaît sous le champ dès qu'on le quitte, sans attendre
// « Valider ». Un champ vide n'est pas repris ici (le caractère obligatoire se dit à la validation).
function checkFieldOnLeave(el) {
  const form = el.form;
  if (!form || !['phone', 'email'].includes(el.name) || !['checkout', 'client'].includes(form.dataset.form) || !el.value.trim()) return;
  const data = Object.fromEntries(new FormData(form));
  const val = (k) => String(data[k] ?? '').trim();
  const message = validateContact(val, false, form.dataset.form === 'checkout')[el.name];
  const slot = form.querySelector(`#err-${el.name}`);
  if (!message) {
    el.removeAttribute('aria-invalid');
    if (slot) slot.textContent = '';
    return;
  }
  const fresh = slot && slot.textContent !== message;
  el.setAttribute('aria-invalid', 'true');
  if (slot) slot.textContent = message;
  if (fresh) announce(message);
}

app.addEventListener('input', (e) => {
  const el = e.target;
  if (el.matches('[data-search]')) {
    S.query = el.value;
    app.querySelector('#results').innerHTML = viewResults();
  } else if ((el.name === 'apptQuery' || el.name === 'apptFirst') && S.modal?.type === 'appt') {
    const m = S.modal;
    if (el.name === 'apptQuery') m.query = el.value;
    else m.firstName = el.value;
    m.error = '';
    m.whoError = '';
    // Une fiche choisie qui ne correspond plus au numéro, ou au prénom tapé, est oubliée.
    const chosen = m.clientId && S.clients.find((c) => c.id === m.clientId);
    const stale =
      chosen && (el.name === 'apptQuery' ? !phoneMatches(m.query).some((c) => c.id === m.clientId) : norm(m.firstName) !== norm(chosen.firstName));
    if (stale) {
      m.clientId = null;
      m.prev = [];
      prefill(m);
      app.querySelector('#appt-dur').innerHTML = `<span class="label">Durée</span>${viewApptDur(m)}`;
      app.querySelector('#appt-span').outerHTML = viewApptSpan(m);
    }
    app.querySelector('#appt-who').innerHTML = viewApptWho(m);
    app.querySelector('#appt-err').textContent = '';
    app.querySelector('#appt-who-err').textContent = '';
    if (el.name === 'apptQuery') announceMatches(m);
  } else if (el.matches('[data-bind]')) {
    const [a, b] = el.dataset.bind.split('.');
    if (b) S.draft[a][b] = el.value;
    else S.draft[a] = el.value;
    saveDraftsSoon();
  } else {
    bindCheckout(el);
  }
  if (el.getAttribute('aria-invalid')) {
    el.removeAttribute('aria-invalid');
    const slot = el.form?.querySelector(`#err-${el.name}`);
    if (slot) slot.textContent = '';
  }
});

app.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.type === 'checkbox') bindCheckout(el);
  if (!el.matches('[data-photo]') || !el.files.length) return;
  const file = el.files[0];
  const draft = S.draft;
  S.photoBusy = true;
  render({ focus: '.photos h2' });
  try {
    const photo = await readPhoto(file);
    if (draft.photos.length < MAX_PHOTOS) draft.photos.push({ ...photo, url: URL.createObjectURL(photo.thumb || photo.blob) });
    announce('Photo ajoutée');
  } catch {
    toast('Cette photo n’a pas pu être lue. Essayez avec une autre.');
  }
  S.photoBusy = false;
  render();
  (app.querySelector('[data-action="add-photo"]') || [...app.querySelectorAll('.photo-del')].pop())?.focus({ preventScroll: true });
});

app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  const val = (k) => String(data[k] ?? '').trim();

  if (form.dataset.form === 'appt') {
    await saveApptForm();
    return;
  }

  if (form.dataset.form === 'client') {
    if (S.modal.saving) return; // second appui pendant l'enregistrement : pas de seconde fiche
    const isNew = !S.modal.client.id;
    const errors = validateContact(val, true, false);
    if (showErrors(form, errors)) return;
    // Doublon probable : on le signale une fois, un second appui crée quand même la fiche.
    const dup = isNew && !S.modal.dupChecked && findDuplicates(val);
    if (dup) {
      S.modal.dupChecked = true;
      form.querySelector('.dup-slot').innerHTML = viewDuplicate(dup);
      const submit = form.querySelector('#client-submit');
      submit.textContent = 'Créer quand même';
      // Un seul bouton or : il passe à « Ouvrir cette fiche » quand c'est la même personne.
      if (dup.same) submit.classList.replace('btn-accent', 'btn-ghost');
      form.querySelector('[data-action="open-dup"]').focus();
      return;
    }
    const m = S.modal;
    m.saving = true;
    let saved;
    try {
      saved = await db.saveClient({
        ...m.client,
        firstName: capName(val('firstName')),
        lastName: capName(val('lastName')),
        phone: val('phone'),
        email: val('email'),
        allergies: val('allergies')
      });
    } finally {
      m.saving = false;
    }
    const apptId = isNew && m.apptId;
    S.modal = null;
    S.modalReturn = null;
    await loadClients();
    await linkAppt(apptId, saved);
    await selectClient(saved.id);
    render({ top: true, focus: '.client-head h1' });
    toast(isNew ? 'Fiche créée' : 'Fiche enregistrée');
  }

  if (form.dataset.form === 'login') {
    const errors = {};
    if (!EMAIL_RE.test(val('email'))) errors.email = 'Indiquez l’e-mail du compte du salon.';
    if (!data.password) errors.password = 'Indiquez le mot de passe.';
    if (showErrors(form, errors)) return;
    const btn = form.querySelector('[type="submit"]');
    const msg = form.querySelector('#login-err');
    // Le bouton dit qu'il travaille : la connexion peut prendre quelques secondes sur le réseau du salon.
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Connexion…';
    msg.textContent = '';
    try {
      await sync.signIn(val('email'), data.password);
      toast('Sauvegarde en ligne activée');
    } catch (err) {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.textContent = 'Se connecter';
      msg.textContent = loginError(err);
      form.elements.password.select();
    }
  }

  if (form.dataset.form === 'checkout') {
    // Sans accord RGPD, rien n'est conservé (après confirmation) : inutile d'exiger le nom.
    if (!data.consent) {
      showErrors(form, {});
      const visits = (await db.visitsOf(S.handedVisit.clientId)).length;
      const nowIso = new Date().toISOString();
      const upcoming = (await db.appointmentsOf(S.handedVisit.clientId)).filter((a) => a.start >= nowIso).length;
      openModal({ type: 'no-consent', visits, upcoming });
      return;
    }
    if (showErrors(form, validateContact(val, true))) return;
    const stampNow = new Date().toISOString();
    const client = await db.getClient(S.handedVisit.clientId);
    const firstName = capName(val('firstName'));
    const lastName = capName(val('lastName'));
    await db.saveClient({
      ...client,
      firstName,
      lastName,
      phone: val('phone'),
      email: val('email'),
      consentAt: client.consentAt || stampNow
    });
    const visit = await db.getVisit(S.handedVisit.id);
    await db.saveVisit({ ...visit, status: 'done', validatedAt: stampNow });
    dropNotices((n) => n.visitId === visit.id);
    S.validated = { name: [firstName, lastName].filter(Boolean).join(' '), at: stampNow };
    finishCheckout(firstName, 'Votre fiche est enregistrée.');
  }
});

function finishCheckout(firstName, note) {
  S.thanksName = firstName;
  S.thanksNote = note;
  S.thanksNext = S.handedNext;
  S.handedNext = null;
  S.handedVisit = null;
  S.checkout = null;
  S.clientId = null;
  S.client = null;
  S.query = '';
  go('thanks');
}

for (const type of ['pointerdown', 'keydown', 'input']) {
  document.addEventListener(type, bumpIdle, { passive: true });
}

// Tab reste dans la fenêtre ouverte : on boucle du dernier élément au premier.
function trapTab(e) {
  const items = [...app.querySelectorAll('.overlay button, .overlay input, .overlay textarea')].filter((el) => !el.disabled && !el.hidden);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

const TAB_KEYS = { ArrowLeft: 'toggle', ArrowRight: 'toggle', Home: 'visit', End: 'history' };

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (S.modal?.type === 'photo') actions['close-photo']();
    else if (S.modal?.type === 'confirm-delete-client') actions['keep-client']();
    else if (S.modal) closeModal();
    else if (S.moving && S.view === 'coiffeur') actions['move-cancel']();
    else if (S.view === 'pin' && (S.pin.cancel || S.pin.mode === 'recover')) actions['pin-cancel']();
    else if (S.view === 'thanks') go('welcome');
    return;
  }
  if (e.key === 'Tab' && S.modal) {
    trapTab(e);
    return;
  }
  if (S.view === 'thanks' && (e.key === 'Enter' || e.key === ' ')) {
    go('welcome');
    return;
  }
  // Onglets : flèches, Début et Fin (modèle ARIA).
  if (e.target.matches?.('[role=tab]') && TAB_KEYS[e.key]) {
    e.preventDefault();
    const to = TAB_KEYS[e.key];
    S.tab = to === 'toggle' ? (S.tab === 'visit' ? 'history' : 'visit') : to;
    render({ top: true, focus: `#tab-${S.tab}` });
    return;
  }
  if (S.view !== 'pin') return;
  if (/^\d$/.test(e.key)) pinDigit(e.key);
  else if (e.key === 'Backspace') actions['pin-back']();
});

// Le bouton « retour » d'Android ne doit pas faire quitter l'appli.
history.pushState(null, '', location.href);
window.addEventListener('popstate', () => {
  history.pushState(null, '', location.href);
  if (S.modal?.type === 'photo') actions['close-photo']();
  else if (S.modal?.type === 'confirm-delete-client') actions['keep-client']();
  else if (S.modal) closeModal();
});

// ---------- Synchro ----------

// Une panne qui dure (3 échecs d'affilée, une dizaine de minutes) ou une connexion expirée est
// signalée une fois par un bandeau, retiré dès qu'une sauvegarde repasse.
const FAILS_BEFORE_NOTICE = 3;
let syncNotice = null; // 'auth' | 'fail'

function syncProblem(st) {
  if (st.state === 'auth') return 'auth';
  const failing = st.state === 'error' && st.failures >= FAILS_BEFORE_NOTICE;
  const old = st.state === 'offline' && st.lastAt && Date.now() - new Date(st.lastAt) > DAY_MS;
  return failing || old ? 'fail' : null;
}

// Le bouton de la barre du haut et la fenêtre Sauvegarde ouverte suivent l'état.
sync.subscribe((st) => {
  const problem = syncProblem(st);
  if (problem !== syncNotice && (problem || st.state === 'idle' || st.state === 'off')) {
    syncNotice = problem;
    dropNotices((n) => n.sync);
    if (problem) {
      const last = st.lastAt ? ` (dernière réussie ${whenSynced(st.lastAt)})` : '';
      const notice =
        problem === 'auth'
          ? { sync: true, text: 'La sauvegarde en ligne est arrêtée : la connexion au compte a expiré.', action: 'backup', label: 'Se reconnecter' }
          : { sync: true, text: `La sauvegarde en ligne ne passe plus${last}. Les fiches sont bien sur la tablette.`, action: 'backup', label: 'Voir la sauvegarde' };
      if (S.view === 'coiffeur') addNotice(notice);
      else S.notices.push(notice);
    }
    if (S.view === 'coiffeur' && !S.modal) render();
  }
  const btn = app.querySelector('#backup-btn');
  if (btn) {
    btn.className = backupClass(st);
    btn.innerHTML = backupLabel(st);
  }
  if (S.modal?.type !== 'backup') return;
  if (Boolean(app.querySelector('[data-form="login"]')) !== needsLogin(st)) {
    render();
    return;
  }
  const box = app.querySelector('#sync-state');
  if (box) {
    const v = syncView(st);
    box.className = `sync-state sync-${v.tone}`;
    box.innerHTML = syncStateInner(v);
  }
});

// Données arrivées d'en ligne (restauration sur une autre tablette) : liste et fiche affichée remises à jour.
async function onPulled() {
  await loadClients();
  S.photoCache.clear();
  if (S.clientId) {
    S.client = await db.getClient(S.clientId);
    if (S.client) await loadHistory();
    else S.clientId = null;
  }
  await refreshAppts();
  if (S.view === 'coiffeur' && !S.modal) render();
}

// Heure de la barre du haut, trait « maintenant » et voile du temps écoulé, mis à jour chaque minute
// sans redessiner l'écran (un rendu en plein appui ferait perdre le toucher).
function tickClock() {
  // Minuit passé devant l'espace coiffeur ouvert : les visites de la veille s'effacent, l'écran suit.
  // Les rendez-vous gardés après un refus RGPD s'effacent aussi, même appli jamais relancée.
  if (forgetYesterdayDrafts()) {
    const purged = purgePastLocalOnly();
    if (S.view === 'coiffeur') {
      S.modal = null;
      purged
        .then(loadClients)
        .then(refreshAppts)
        .then(() => {
          render({ top: true });
          scrollPlanToNow();
        });
    }
  }
  const clock = document.getElementById('clock');
  if (clock) clock.textContent = fmtClock();
  const min = core.minutesOf(new Date());
  const col = app.querySelector('.day-col.is-today');
  if (col && min > core.OPEN_MIN && min < core.CLOSE_MIN) {
    const line = col.querySelector('.now-line');
    const veil = col.querySelector('.past-veil');
    if (line) line.style.top = pct(min);
    if (veil) veil.style.height = span(min - core.OPEN_MIN);
  }
  setTimeout(tickClock, 60000 - (Date.now() % 60000) + 50);
}

// RGPD : un rendez-vous gardé sur la tablette après un refus (localOnly) part une fois son jour passé.
function purgePastLocalOnly() {
  const today = new Date();
  return db.purgeLocalOnly(new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString());
}

// ---------- Démarrage ----------

(async function boot() {
  applyTheme(document.documentElement.dataset.theme);
  if (navigator.storage?.persist) navigator.storage.persist();
  await purgePastLocalOnly();
  await loadSavedDrafts();
  sync.start(onPulled);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
  tickClock();
  const pinLock = await db.getSetting('pinLock');
  if (pinLock) {
    S.pinFails = pinLock.fails || 0;
    S.pinLockedUntil = pinLock.until || 0;
    if (Date.now() < S.pinLockedUntil) startLockTicker();
  }
  const pinHash = await db.getSetting('pinHash');
  if (pinHash) {
    go('welcome');
  } else {
    S.pin = {
      mode: 'new',
      entry: '',
      first: '',
      error: '',
      hint: 'Ce code protège l’espace coiffeur (fiches, formules, notes). Le client n’y a pas accès.',
      next: enterCoiffeur,
      cancel: null
    };
    go('pin');
  }
})();
