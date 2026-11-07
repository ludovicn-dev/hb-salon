import * as db from './db.js';
import * as sync from './sync.js';

const SERVICES = ['Coupe & coiffage', 'Coloration', 'Lissage', 'Soin', 'Barbe', 'Massage', 'Visagiste', 'Diagnostic'];
const CLIENT_IDLE_MS = 2 * 60 * 1000;
const COIFFEUR_IDLE_MS = 10 * 60 * 1000; // verrouillage automatique de l'espace coiffeur
const IDLE_WARN_MS = 20000; // avertissement affiché avant le retour à l'accueil
const THANKS_MS = 10000;
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
  pin: null, // { mode: 'unlock' | 'new' | 'confirm' | 'recover', entry, first, error, hint, recovered, next, cancel }
  pinFails: 0,
  pinLockedUntil: 0,
  query: '',
  clients: [],
  lastVisit: new Map(), // clientId -> date ISO
  pending: new Map(), // clientId -> nombre de visites non validées
  drafts: new Map(), // clientId -> { draft, stash } : visites en cours des autres clients
  clientId: null,
  client: null,
  tab: 'visit',
  history: [],
  lastFormula: null, // { formula, date }
  draft: null, // { services: Set, formula, note, photos: [{ id?, blob, thumb, url }], editId?, editDate?, removed: [] }
  stash: null, // brouillon du jour mis de côté pendant la modification d'une visite
  draftError: '',
  photoBusy: false,
  handedVisit: null, // visite entre les mains du client
  checkout: null, // saisie du client, gardée si l'écran est redessiné
  thanksName: '',
  thanksNote: '',
  notices: [], // { text, visitId?, clientId?, sync?, action?, label? } : restent affichés au coiffeur jusqu'à « Compris »
  autoLocked: false,
  photoCache: new Map(), // visitId -> photos (miniatures de l'historique)
  idleReturn: null, // élément à refocaliser après « Je continue »
  validated: '', // nom du dernier client qui a validé sa fiche
  modal: null, // { type: 'client' | 'backup' | 'confirm-delete' | 'photo', ... }
  modalReturn: null // élément à refocaliser à la fermeture
};

let timer = null;
let idleTicker = null;
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
const fmtToday = () => cap(new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()));
const fmtDay = (iso) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(new Date(iso));
const fmtDayShort = (iso) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(iso));
const fmtDateMid = (iso) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
const fmtDateLong = (iso) => cap(fmtDateMid(iso));
const fmtTime = (iso) => new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(':', ' h ');

function ago(iso) {
  const start = new Date(iso);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today - start) / 86400000);
  if (days <= 0) return 'aujourd’hui';
  if (days === 1) return 'hier';
  if (days < 14) return `il y a ${days} j`;
  if (days < 60) return `il y a ${Math.round(days / 7)} sem.`;
  if (days < 365) return `il y a ${Math.round(days / 30)} mois`;
  const y = Math.round(days / 365);
  return `il y a ${y} an${y > 1 ? 's' : ''}`;
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
const KEY_ATTRS = ['id', 'name', 'data-bind', 'data-action', 'data-tab', 'data-service', 'data-id', 'data-key', 'data-visit', 'data-index'];
function selectorOf(el) {
  if (!el || el === document.body || !app.contains(el)) return null;
  const parts = KEY_ATTRS.filter((a) => el.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(el.getAttribute(a))}"]`);
  return parts.length ? parts.join('') : null;
}

// ---------- Icônes ----------

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
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
  cloudOff: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10.5 3.75 3.75 0 0 1 17.25 18z"/><path d="M4 4l16 16"/>'
};

const icon = (name, size = 20) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// Le vrai logo du salon (détouré, reflets compris).
const logo = (size = 'sm') => `<img class="logo logo-${size}" src="logo.webp" alt="H&amp;B Salon" width="854" height="502">`;

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
  if (view === 'client' || view === 'coiffeur') bumpIdle();
  if (view === 'thanks') timer = setTimeout(() => go('welcome'), THANKS_MS);
}

function bumpIdle() {
  if (S.view === 'coiffeur') {
    clearTimeout(timer);
    // La visite en cours est gardée.
    timer = setTimeout(() => {
      S.autoLocked = true;
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

const SCROLLERS = ['.detail', '.results', '.coiffeur-body', '.client', '.client-form', '.dialog'];

// Redessine l'écran en gardant la position de défilement et le focus (sauf changement d'écran).
function render({ top = false, focus = null } = {}) {
  const same = app.dataset.view === S.view;
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

  if (scrolls) {
    SCROLLERS.forEach((sel, i) => {
      const el = app.querySelector(sel);
      if (el && !(top && sel === '.detail')) el.scrollTop = scrolls[i];
    });
  }
  if (S.modal) app.firstElementChild.inert = true;
  hydratePhotos();
  // Titres focalisables par script : à l'arrivée sur un écran, le focus va au titre.
  app.querySelectorAll('h1').forEach((h) => (h.tabIndex = -1));
  const wanted = focus || active;
  const target =
    app.querySelector('[data-autofocus]') || (wanted ? app.querySelector(wanted) : null) || (same ? null : app.querySelector('h1'));
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
  const dis = locked ? ' disabled' : '';
  const dots = Array.from({ length: len }, (_, i) => `<span class="dot${i < p.entry.length ? ' on' : ''}"></span>`).join('');
  const showCancel = p.cancel || p.mode === 'recover';
  return `
  <main class="pin">
    ${logo('md')}
    <h1 class="serif">${title}</h1>
    <p class="muted pin-sub">${sub}</p>
    ${p.hint && p.mode !== 'recover' ? `<p class="muted small pin-sub">${p.hint}</p>` : ''}
    <div class="dots${len > 4 ? ' dots-long' : ''}" aria-hidden="true">${dots}</div>
    <p class="err">${esc(locked ? lockMsg(lockLeft()) : p.error)}</p>
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
      <div class="brand">${logo('sm')}<span class="muted">Espace coiffeur</span></div>
      <div class="top-actions">
        <span class="muted today">${fmtToday()}</span>
        <button type="button" class="btn btn-quiet" data-action="change-pin">${icon('key', 18)} Changer le code</button>
        <button type="button" class="${backupClass()}" data-action="backup" id="backup-btn">${backupLabel()}</button>
        <button type="button" class="btn btn-ghost" data-action="lock">${icon('lock', 18)} Verrouiller</button>
      </div>
    </header>
    <div class="coiffeur-body">
      <aside class="side">
        <label for="search" class="label">Client</label>
        <div class="search">
          ${icon('search', 18)}
          <input id="search" type="search" data-search placeholder="Nom ou téléphone…" value="${esc(S.query)}" autocomplete="off">
        </div>
        <div id="results" class="results">${viewResults()}</div>
        <button type="button" class="btn-new" data-action="new-client">${icon('plus', 18)} Nouveau client</button>
      </aside>
      <main class="detail">${viewNotices()}${S.client ? viewClientDetail() : viewEmpty()}</main>
    </div>
  </div>`;
}

function searchClients() {
  const q = norm(S.query);
  const qd = digits(S.query);
  const byRecent = (a, b) => (S.lastVisit.get(b.id) || b.createdAt).localeCompare(S.lastVisit.get(a.id) || a.createdAt);
  if (!q) return [...S.clients].sort(byRecent).slice(0, 12);
  return S.clients
    .filter((c) => {
      const name = norm(`${c.firstName} ${c.lastName}`);
      const rev = norm(`${c.lastName} ${c.firstName}`);
      return name.includes(q) || rev.includes(q) || (qd.length >= 2 && digits(c.phone).includes(qd));
    })
    .sort(byRecent);
}

function viewResults() {
  const list = searchClients();
  if (!S.clients.length) return `<p class="muted small pad">Aucune fiche pour l’instant.</p>`;
  if (!list.length) return `<p class="muted small pad">Aucun client trouvé.</p>`;
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
          .join(' · ');
        const tags = [
          S.pending.get(c.id) ? `<span class="tag tag-pending">${icon('clock', 13)} À valider</span>` : '',
          S.drafts.has(c.id) ? '<span class="tag">Visite en cours</span>' : ''
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

function viewEmpty() {
  return `
  <div class="empty">
    <h1 class="serif">Prochain client</h1>
    <p class="muted">Recherchez sa fiche à gauche, ou créez-en une nouvelle.</p>
    <button type="button" class="btn btn-accent" data-action="new-client">${icon('plus', 18)} Nouveau client</button>
  </div>`;
}

// Annoncé une seule fois à l'ajout ; le bandeau redessiné n'est pas une zone annoncée.
function addNotice(notice) {
  S.notices.push(notice);
  announce(notice.text);
}

// Bandeaux dans leur contexte : celui d'une visite est masqué sur la fiche du même client (l'encart
// « attend la validation » le dit déjà) ; les simples informations ne s'affichent qu'hors fiche.
const viewNotices = () =>
  S.notices
    .map((n, i) => {
      if (n.visitId ? n.clientId === S.clientId : S.client) return '';
      return `<div class="notice">${icon(n.visitId ? 'clock' : n.sync ? 'cloudOff' : 'info', 20)}<span>${esc(n.text)}</span>
        ${n.action ? `<button type="button" class="btn btn-sm btn-ghost" data-action="${n.action}">${n.label}</button>` : ''}
        ${n.visitId ? `<button type="button" class="btn btn-sm btn-accent" data-action="rehand-notice" data-index="${i}">${icon('tablet', 16)} Repasser la tablette</button>` : ''}
        <button type="button" class="btn btn-sm btn-ghost" data-action="dismiss-notice" data-index="${i}">Compris</button></div>`;
    })
    .join('');

// Un bandeau qui parle d'une visite disparaît dès que la visite est validée ou effacée.
const dropNotices = (pred) => (S.notices = S.notices.filter((n) => !pred(n)));

const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();
const latestPending = () => S.history.find((v) => v.status === 'pending');
const whenOf = (v) => (isToday(v.date) ? `de ${fmtTime(v.date)}` : `du ${fmtDayShort(v.date)}`);

const consentLine = (c) => (c.consentAt ? `Accord RGPD donné le ${fmtDayShort(c.consentAt)}` : '');

function viewClientDetail() {
  const c = S.client;
  const contact = [fmtPhone(c.phone), c.email].filter(Boolean).join(' · ') || 'Coordonnées à compléter par le client';
  const consent = consentLine(c);
  return `
  <div class="client-head">
    <div>
      <h1 class="serif">${esc(fullName(c))}</h1>
      <p class="muted">${esc(contact)}</p>
      ${consent ? `<p class="consent-line">${consent}</p>` : ''}
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
  const waiting = !d.editId && !draftHasContent(d) ? latestPending() : null;
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
            <span>${icon('clock', 18)} La visite <strong>${whenOf(waiting)}</strong> (${esc(waiting.services.join(', '))}) attend la validation du client.</span>
            <button type="button" class="btn btn-accent" data-action="rehand" data-visit="${waiting.id}">${icon('tablet', 18)} Repasser la tablette</button>
          </div>`
        : lastVisit && !d.editId && !d.services.size && !isToday(lastVisit.date)
          ? `<button type="button" class="link link-start" data-action="reuse-services">${icon('undo', 16)} Mêmes prestations que le ${fmtDayShort(lastVisit.date)} (${esc(lastVisit.services.join(', '))})</button>`
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
        // Rappel au plus près de la formule : l'encadré du haut sort de l'écran quand le clavier est ouvert.
        S.client?.allergies
          ? `<div class="allergy allergy-mini">${icon('alert', 18)}<p><strong>Allergies</strong> <span>${esc(S.client.allergies)}</span></p></div>`
          : ''
      }
      <div class="grid4">
        ${field('brand', 'Marque', 'ex. Majirel')}
        ${field('shade', 'Nuance', 'ex. 6.34 + 7.3')}
        ${field('oxidant', 'Oxydant', 'ex. 20 vol · 1/1,5')}
        ${field('time', 'Temps de pose', 'ex. 35 min')}
      </div>
    </section>`
        : ''
    }
    <label class="field">Note interne (le client ne la voit pas)
      <textarea data-bind="note" rows="2" placeholder="ex. Préfère une frange courte">${esc(d.note)}</textarea>
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
        d.editId
          ? `<button type="button" class="btn btn-accent btn-lg" data-action="save-edit">${icon('check', 20)} Enregistrer les modifications</button>`
          : waiting
            ? `<button type="button" class="btn btn-ghost btn-lg" data-action="handover">Nouvelle visite : passer la tablette ${icon('arrow', 20)}</button>`
            : `<button type="button" class="btn btn-accent btn-lg" data-action="handover">Passer la tablette au client ${icon('arrow', 20)}</button>`
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
        ${hasFormula(f) ? `<p class="visit-line"><span class="muted">Couleur :</span> ${esc([f.brand, f.shade, f.oxidant, f.time].filter(Boolean).join(' · '))}</p>` : ''}
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
      <button type="button" class="btn btn-quiet aside-foot" data-action="client-to-coiffeur">${icon('lock', 16)} Coiffeur</button>
    </aside>
    <section class="client-form">
      <form data-form="checkout" novalidate>
        <div class="form-head">
          <h2 class="serif">${lead}</h2>
          <p class="muted">Votre coiffeur vous confie la tablette : ${help}</p>
        </div>
        <div class="grid2">
          ${inputField('field field-lg', 'firstName', 'Prénom', 'text', c.firstName, 'autocomplete="given-name" required')}
          ${inputField('field field-lg', 'lastName', 'Nom', 'text', c.lastName, 'autocomplete="family-name" required')}
        </div>
        <div class="grid-contact">
          ${inputField('field field-lg', 'phone', 'Téléphone (facultatif)', 'tel', c.phone, 'autocomplete="tel" inputmode="tel"')}
          ${inputField('field field-lg', 'email', 'E-mail (facultatif)', 'email', c.email, 'autocomplete="email" inputmode="email"')}
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
  return `btn btn-quiet${a ? ` backup-${a}` : ''}`;
}

function backupLabel(st = sync.getStatus()) {
  const a = syncAttention(st);
  const hint = { error: 'à vérifier', wait: 'envoi en attente' }[a];
  return `${icon(a === 'error' ? 'cloudOff' : a === 'wait' ? 'clock' : 'cloud', 18)} Sauvegarde${hint ? `<span class="sr-only"> : ${hint}</span>` : ''}`;
}

function loginError(err) {
  if (err instanceof TypeError || !navigator.onLine) return 'Pas de connexion Internet. Réessayez une fois connecté.';
  if (err.code === 'email_not_confirmed') return 'Ce compte n’est pas encore confirmé.';
  if (err.status === 400) return 'E-mail ou mot de passe incorrect.';
  return 'Connexion impossible pour l’instant. Réessayez dans quelques minutes.';
}

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
          ${input('firstName', 'Prénom', 'text', 'data-autofocus autocomplete="off"')}
          ${input('lastName', 'Nom', 'text', 'autocomplete="off"')}
          ${input('phone', 'Téléphone', 'tel', 'inputmode="tel" autocomplete="off"')}
          ${input('email', 'E-mail', 'email', 'inputmode="email" autocomplete="off"')}
        </div>
        <label class="field">Allergies / sensibilités
          <textarea name="allergies" rows="2" placeholder="ex. Réaction à la PPD, cuir chevelu sensible">${esc(c.allergies)}</textarea>
        </label>
        ${c.id ? '' : '<p class="muted small">Un prénom ou un téléphone suffit : le client complètera ses coordonnées lui-même.</p>'}
        <div class="dup-slot"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
          <button type="submit" class="btn btn-accent" id="client-submit">${c.id ? 'Enregistrer' : 'Créer la fiche'}</button>
        </div>
      </form>`;
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
        <section class="dlg-section" aria-labelledby="sec-export">
          <h3 id="sec-export">Exporter en CSV</h3>
          <p class="muted small">Fiches clients et historique, à ouvrir dans Excel. Les fichiers arrivent dans « Téléchargements » ; les photos n’y sont pas.</p>
          <div class="export-btns">
            <button type="button" class="btn btn-ghost" data-action="export-clients">${icon('download', 18)} Fiches clients</button>
            <button type="button" class="btn btn-ghost" data-action="export-visits">${icon('download', 18)} Historique des visites</button>
          </div>
        </section>
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
        <div class="choice-pair">
          <button type="button" class="btn btn-ghost btn-lg" data-action="back-to-consent" data-autofocus>Revenir à la case</button>
          <button type="button" class="btn btn-danger-outline btn-lg" data-action="confirm-no-consent">Ne pas conserver</button>
        </div>
      </div>`;
  } else if (m.type === 'confirm-delete') {
    const v = S.history.find((x) => x.id === m.visitId);
    body = `
      <div class="dialog dialog-sm">
        <h2 class="serif" id="dlg-title">Supprimer cette visite ?</h2>
        <p class="muted">Visite du ${v ? `${fmtDateMid(v.date)} à ${fmtTime(v.date)}` : ''}, avec sa formule, sa note et ses photos. C’est définitif.</p>
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
  for (const v of visits) {
    const cur = S.lastVisit.get(v.clientId);
    if (!cur || v.date > cur) S.lastVisit.set(v.clientId, v.date);
    if (v.status === 'pending') S.pending.set(v.clientId, (S.pending.get(v.clientId) || 0) + 1);
  }
}

const pendingCount = () => S.history.filter((v) => v.status === 'pending').length;

const emptyDraft = () => ({ services: new Set(), formula: { brand: '', shade: '', oxidant: '', time: '' }, note: '', photos: [], removed: [] });
const dropDraft = (d) => d?.photos.forEach((p) => URL.revokeObjectURL(p.url));
const draftHasContent = (d) => Boolean(d && (d.editId || d.services.size || d.note.trim() || d.photos.length || hasFormula(d.formula)));

// Met de côté la visite en cours du client affiché, pour la retrouver en revenant sur sa fiche.
function parkDraft() {
  if (!S.clientId || !S.draft) return;
  if (draftHasContent(S.draft) || S.stash) S.drafts.set(S.clientId, { draft: S.draft, stash: S.stash });
  else S.drafts.delete(S.clientId);
}

async function loadHistory() {
  S.history = await db.visitsOf(S.clientId);
  const withFormula = S.history.find((v) => hasFormula(v.formula));
  S.lastFormula = withFormula ? { formula: withFormula.formula, date: withFormula.date } : null;
}

async function selectClient(id) {
  parkDraft();
  dropNotices((n) => !n.visitId && !n.sync); // les simples informations ne suivent pas sur une fiche
  S.clientId = id;
  S.client = await db.getClient(id);
  await loadHistory();
  S.tab = 'visit';
  const saved = S.drafts.get(id);
  S.drafts.delete(id);
  S.draft = saved?.draft || emptyDraft();
  S.stash = saved?.stash || null;
  S.draftError = '';
}

async function enterCoiffeur() {
  // Tablette reprise (ou fermée pour inactivité) avant que le client ait validé.
  if (S.handedVisit) {
    dropNotices((n) => n.visitId === S.handedVisit.id);
    addNotice({
      text: hasName(S.client)
        ? `${fullName(S.client)} n’a pas validé sa visite.`
        : `Une visite (fiche du ${fmtDayShort(S.client.createdAt)}) n’a pas été validée.`,
      visitId: S.handedVisit.id,
      clientId: S.handedVisit.clientId
    });
    S.handedVisit = null;
    S.checkout = null;
  }
  S.autoLocked = false;
  await loadClients();
  if (S.clientId) await selectClient(S.clientId);
  go('coiffeur');
  if (S.validated) {
    toast(`${S.validated} a validé sa fiche`);
    S.validated = '';
  }
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

function handTo(visit) {
  parkDraft(); // une visite déjà commencée pour ce client est retrouvée au retour
  const c = S.client || {};
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
    const ok =
      p.mode === 'unlock'
        ? (await hashPin(p.entry)) === (await db.getSetting('pinHash'))
        : (await hashRecovery(p.entry)) === RECOVERY_HASH;
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
        p.error = p.mode === 'unlock' ? 'Code incorrect' : 'Code de déblocage incorrect';
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
      if (p.recovered) toast('Nouveau code enregistré');
      p.next();
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
    const s = String(v ?? '');
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

function validateContact(val, requireName) {
  const errors = {};
  if (requireName && !val('firstName')) errors.firstName = 'Indiquez votre prénom.';
  if (requireName && !val('lastName')) errors.lastName = 'Indiquez votre nom.';
  const phone = digits(val('phone'));
  if (val('phone') && (phone.length < 6 || phone.length > 15)) errors.phone = 'Numéro incomplet : vérifiez les chiffres.';
  if (val('email') && !EMAIL_RE.test(val('email'))) errors.email = 'Adresse incomplète, par exemple prenom@exemple.fr';
  return errors;
}

const sameName = (c, val) => Boolean(val('firstName') && val('lastName') && norm(c.firstName) === norm(val('firstName')) && norm(c.lastName) === norm(val('lastName')));

function findDuplicate(val) {
  const phone = digits(val('phone'));
  const first = norm(val('firstName'));
  const last = norm(val('lastName'));
  return S.clients.find(
    (c) => (phone.length >= 6 && digits(c.phone) === phone) || (first && last && norm(c.firstName) === first && norm(c.lastName) === last)
  );
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
    S.clientId = null;
    S.client = null;
    S.query = '';
    go('welcome');
  },
  'change-pin': () => {
    S.pin = { mode: 'new', entry: '', first: '', error: '', next: () => go('coiffeur'), cancel: () => go('coiffeur') };
    go('pin');
  },
  backup: () => openModal({ type: 'backup' }),
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
  'export-clients': exportClients,
  'export-visits': exportVisits,
  select: async (el) => {
    await selectClient(el.dataset.id);
    render({ top: true });
  },
  'new-client': () => openModal({ type: 'client', client: { firstName: '', lastName: '', phone: '', email: '', allergies: '' } }),
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
    if (s === 'Coloration') {
      render();
      return;
    }
    el.setAttribute('aria-pressed', S.draft.services.has(s));
    app.querySelector('#services-err').textContent = '';
  },
  'reuse-services': () => {
    S.draft.services = new Set(S.history[0].services);
    S.draftError = '';
    render({ focus: '.service' });
  },
  'dismiss-notice': (el) => {
    S.notices.splice(Number(el.dataset.index), 1);
    render({ focus: '#search' });
  },
  'rehand-notice': async (el) => {
    const notice = S.notices[Number(el.dataset.index)];
    await selectClient(notice.clientId);
    const visit = S.history.find((v) => v.id === notice.visitId);
    dropNotices((n) => n.visitId === notice.visitId);
    if (visit) handTo(visit);
    else render({ top: true });
  },
  'back-to-consent': () => {
    S.modal = null;
    S.modalReturn = null;
    render({ focus: '[name="consent"]' });
  },
  'open-dup': async (el) => {
    S.modal = null;
    S.modalReturn = null;
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
    if (!checkServices()) return;
    const d = S.draft;
    const visit = await db.saveVisit({
      clientId: S.clientId,
      services: SERVICES.filter((s) => d.services.has(s)),
      formula: { ...d.formula },
      note: d.note.trim(),
      status: 'pending'
    });
    for (const p of d.photos) await db.addPhoto(visit.id, p.blob, p.thumb);
    dropDraft(d);
    S.draft = emptyDraft();
    handTo(visit);
  },
  rehand: (el) => {
    const visit = S.history.find((v) => v.id === el.dataset.visit);
    if (S.draft.editId) endEdit();
    if (visit) handTo(visit);
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
    if (!checkServices()) return;
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
  },
  'delete-visit': (el) => openModal({ type: 'confirm-delete', visitId: el.dataset.visit }),
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
    await db.deleteClient(client.id);
    dropDraft(S.drafts.get(client.id)?.draft);
    S.drafts.delete(client.id);
    dropNotices((n) => n.clientId === client.id);
    const who = hasName(client) ? `de ${fullName(client)}` : `créée le ${fmtDayShort(client.createdAt)}${client.phone ? ` (${fmtPhone(client.phone)})` : ''}`;
    addNotice({ text: `Fiche ${who} effacée : le client n’a pas donné son accord.` });
    finishCheckout(S.checkout.firstName.trim(), 'Votre fiche n’a pas été conservée.');
  },
  'client-to-coiffeur': () => askPin(enterCoiffeur, () => go('client')),
  stay: () => {},
  welcome: () => go('welcome')
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
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
  if (el.type !== 'tel' || fmtPhone(el.value) === el.value) return;
  el.value = fmtPhone(el.value);
  bindCheckout(el);
});

app.addEventListener('input', (e) => {
  const el = e.target;
  if (el.matches('[data-search]')) {
    S.query = el.value;
    app.querySelector('#results').innerHTML = viewResults();
  } else if (el.matches('[data-bind]')) {
    const [a, b] = el.dataset.bind.split('.');
    if (b) S.draft[a][b] = el.value;
    else S.draft[a] = el.value;
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

  if (form.dataset.form === 'client') {
    const isNew = !S.modal.client.id;
    const errors = validateContact(val, false);
    if (isNew && !val('firstName') && !val('lastName') && !val('phone')) errors.firstName = 'Indiquez au moins un prénom, un nom ou un téléphone.';
    if (showErrors(form, errors)) return;
    // Doublon probable : on le signale une fois, un second appui crée quand même la fiche.
    const dup = isNew && !S.modal.dupChecked && findDuplicate(val);
    if (dup) {
      S.modal.dupChecked = true;
      form.querySelector('.dup-slot').innerHTML = `<div class="notice notice-inline" role="alert">${icon('info', 20)}
        <span>${sameName(dup, val) ? `Une fiche existe déjà : <strong>${esc(fullName(dup))}</strong>${dup.phone ? `, ${esc(fmtPhone(dup.phone))}` : ''}.` : `Le ${esc(fmtPhone(dup.phone))} est déjà sur la fiche de <strong>${esc(fullName(dup))}</strong>. Même famille ?`}</span>
        <button type="button" class="btn btn-sm btn-ghost" data-action="open-dup" data-id="${dup.id}">Ouvrir cette fiche</button></div>`;
      form.querySelector('#client-submit').textContent = 'Créer quand même';
      form.querySelector('[data-action="open-dup"]').focus();
      return;
    }
    const saved = await db.saveClient({
      ...S.modal.client,
      firstName: val('firstName'),
      lastName: val('lastName'),
      phone: val('phone'),
      email: val('email'),
      allergies: val('allergies')
    });
    S.modal = null;
    S.modalReturn = null;
    await loadClients();
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
    btn.disabled = true;
    msg.textContent = '';
    try {
      await sync.signIn(val('email'), data.password);
      toast('Sauvegarde en ligne activée');
    } catch (err) {
      btn.disabled = false;
      msg.textContent = loginError(err);
      form.elements.password.select();
    }
  }

  if (form.dataset.form === 'checkout') {
    // Sans accord RGPD, rien n'est conservé (après confirmation) : inutile d'exiger le nom.
    if (!data.consent) {
      showErrors(form, {});
      const visits = (await db.visitsOf(S.handedVisit.clientId)).length;
      openModal({ type: 'no-consent', visits });
      return;
    }
    if (showErrors(form, validateContact(val, true))) return;
    const stampNow = new Date().toISOString();
    const client = await db.getClient(S.handedVisit.clientId);
    await db.saveClient({
      ...client,
      firstName: val('firstName'),
      lastName: val('lastName'),
      phone: val('phone'),
      email: val('email'),
      consentAt: client.consentAt || stampNow
    });
    const visit = await db.getVisit(S.handedVisit.id);
    await db.saveVisit({ ...visit, status: 'done', validatedAt: stampNow });
    dropNotices((n) => n.visitId === visit.id);
    S.validated = [val('firstName'), val('lastName')].filter(Boolean).join(' ');
    finishCheckout(val('firstName'), 'Votre fiche est enregistrée.');
  }
});

function finishCheckout(firstName, note) {
  S.thanksName = firstName;
  S.thanksNote = note;
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
    else if (S.modal) closeModal();
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
  if (S.view === 'coiffeur' && !S.modal) render();
}

// ---------- Démarrage ----------

(async function boot() {
  if (navigator.storage?.persist) navigator.storage.persist();
  sync.start(onPulled);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
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
