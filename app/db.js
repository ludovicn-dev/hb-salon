// Stockage local (IndexedDB). La tablette reste la référence : tout y est enregistré d'abord,
// puis sync.js envoie à Supabase les enregistrements marqués `dirty` et les effacements.

const DB_NAME = 'hb-salon';
const DB_VERSION = 3;
const SYNCED = ['clients', 'visits', 'photos'];

let dbPromise;
let changed = () => {};

// Prévient la synchro qu'il y a quelque chose à envoyer.
export function onChange(fn) {
  changed = fn;
}

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const tx = req.transaction;
      if (!db.objectStoreNames.contains('clients')) {
        db.createObjectStore('clients', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('visits')) {
        const visits = db.createObjectStore('visits', { keyPath: 'id' });
        visits.createIndex('clientId', 'clientId');
      }
      if (!db.objectStoreNames.contains('photos')) {
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('visitId', 'visitId');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      // v2 : synchro. Les fiches d'avant n'ont jamais été envoyées : toutes marquées à envoyer.
      if (e.oldVersion < 2) {
        db.createObjectStore('deletions', { keyPath: 'id' });
        for (const name of SYNCED) {
          const s = tx.objectStore(name);
          s.createIndex('dirty', 'dirty');
          s.openCursor().onsuccess = (ev) => {
            const cur = ev.target.result;
            if (!cur) return;
            if (!cur.value.syncedAt) cur.update({ ...cur.value, dirty: 1 });
            cur.continue();
          };
        }
      }
      // v3 : agenda. Les rendez-vous ont leur propre magasin (ils survivent à l'effacement de la fiche).
      if (e.oldVersion < 3) {
        const appts = db.createObjectStore('appointments', { keyPath: 'id' });
        appts.createIndex('dirty', 'dirty');
        appts.createIndex('clientId', 'clientId');
        appts.createIndex('start', 'start');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const now = () => new Date().toISOString();

// --- Réglages ---

export async function getSetting(key) {
  const row = await promisify((await store('settings')).get(key));
  return row ? row.value : undefined;
}

export async function setSetting(key, value) {
  await promisify((await store('settings', 'readwrite')).put({ key, value }));
}

// --- Clients ---

export async function allClients() {
  return promisify((await store('clients')).getAll());
}

export async function getClient(id) {
  return promisify((await store('clients')).get(id));
}

export async function saveClient(client) {
  const record = {
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    allergies: '',
    consentAt: null,
    createdAt: now(),
    ...client,
    id: client.id || uid(),
    updatedAt: now(),
    syncedAt: null,
    dirty: 1
  };
  await promisify((await store('clients', 'readwrite')).put(record));
  changed();
  return record;
}

// Efface la fiche, ses visites et leurs photos (client sans accord RGPD).
// `tombstone` : garder trace de l'effacement pour le répercuter en ligne (faux quand il vient d'en ligne).
// Ses rendez-vous partent aussi : appeler detachAppointments avant pour garder ceux à venir.
export async function deleteClient(id, tombstone = true) {
  const db = await open();
  const tx = db.transaction(['clients', 'visits', 'photos', 'deletions', 'appointments'], 'readwrite');
  const appts = tx.objectStore('appointments');
  const visits = tx.objectStore('visits');
  const photos = tx.objectStore('photos');
  const dels = tx.objectStore('deletions');
  const mark = (kind, key) => tombstone && dels.put({ id: key, kind, at: now() });
  tx.objectStore('clients').delete(id);
  mark('client', id);
  // Un rendez-vous jamais envoyé n'a rien à effacer en ligne.
  for (const a of await promisify(appts.index('clientId').getAll(id))) {
    appts.delete(a.id);
    if (wasSent(a)) mark('appointment', a.id);
  }
  const visitIds = await promisify(visits.index('clientId').getAllKeys(id));
  for (const visitId of visitIds) {
    visits.delete(visitId);
    mark('visit', visitId);
    const keys = await promisify(photos.index('visitId').getAllKeys(visitId));
    keys.forEach((k) => {
      photos.delete(k);
      mark('photo', k);
    });
  }
  await done(tx);
  if (tombstone) changed();
}

// --- Visites ---

export async function allVisits() {
  return promisify((await store('visits')).getAll());
}

export async function visitsOf(clientId) {
  const s = await store('visits');
  const list = await promisify(s.index('clientId').getAll(clientId));
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getVisit(id) {
  return promisify((await store('visits')).get(id));
}

export async function saveVisit(visit) {
  const record = {
    services: [],
    formula: { brand: '', shade: '', oxidant: '', time: '' },
    note: '',
    status: 'pending',
    date: now(),
    createdAt: now(),
    ...visit,
    id: visit.id || uid(),
    updatedAt: now(),
    syncedAt: null,
    dirty: 1
  };
  await promisify((await store('visits', 'readwrite')).put(record));
  changed();
  return record;
}

export async function deleteVisit(id, tombstone = true) {
  const db = await open();
  const tx = db.transaction(['visits', 'photos', 'deletions'], 'readwrite');
  const photos = tx.objectStore('photos');
  const dels = tx.objectStore('deletions');
  tx.objectStore('visits').delete(id);
  if (tombstone) dels.put({ id, kind: 'visit', at: now() });
  const keys = await promisify(photos.index('visitId').getAllKeys(id));
  keys.forEach((k) => {
    photos.delete(k);
    if (tombstone) dels.put({ id: k, kind: 'photo', at: now() });
  });
  await done(tx);
  if (tombstone) changed();
}

// --- Photos (Blob JPEG + miniature, rattachées à une visite) ---

export async function addPhoto(visitId, blob, thumb = null) {
  const record = { id: uid(), visitId, blob, thumb, createdAt: now(), syncedAt: null, dirty: 1 };
  await promisify((await store('photos', 'readwrite')).put(record));
  changed();
  return record;
}

export async function photosOf(visitId) {
  const s = await store('photos');
  const list = await promisify(s.index('visitId').getAll(visitId));
  return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getPhoto(id) {
  return promisify((await store('photos')).get(id));
}

export async function photoCount(visitId) {
  return promisify((await store('photos')).index('visitId').count(visitId));
}

export async function deletePhoto(id, tombstone = true) {
  const db = await open();
  const tx = db.transaction(['photos', 'deletions'], 'readwrite');
  tx.objectStore('photos').delete(id);
  if (tombstone) tx.objectStore('deletions').put({ id, kind: 'photo', at: now() });
  await done(tx);
  if (tombstone) changed();
}

// --- Rendez-vous ---
// La copie du prénom et du téléphone sert quand la fiche n'existe plus.

// Déjà parti en ligne au moins une fois : `syncedAt` s'efface à chaque modification locale, `sent` reste,
// pour que son effacement soit répercuté en ligne même s'il a été modifié depuis le dernier envoi.
const wasSent = (a) => !!(a?.syncedAt || a?.sent);

export async function saveAppointment(appt) {
  const s = await store('appointments', 'readwrite');
  const id = appt.id || uid();
  const prev = appt.id ? await promisify(s.get(id)) : null;
  const { sent, ...rest } = appt; // seul l'enregistrement en base fait foi (un rendez-vous rétabli a un nouvel identifiant)
  const record = {
    clientId: null,
    firstName: '',
    phone: '',
    services: [],
    createdAt: now(),
    ...rest,
    id,
    updatedAt: now(),
    syncedAt: null,
    dirty: 1,
    ...(wasSent(prev) ? { sent: 1 } : {})
  };
  await promisify(s.put(record));
  changed();
  return record;
}

export async function getAppointment(id) {
  return promisify((await store('appointments')).get(id));
}

export async function allAppointments() {
  return promisify((await store('appointments')).getAll());
}

// Rendez-vous qui commencent dans [fromIso, toIso[, par heure de début.
export async function appointmentsBetween(fromIso, toIso) {
  const s = await store('appointments');
  return promisify(s.index('start').getAll(IDBKeyRange.bound(fromIso, toIso, false, true)));
}

export async function appointmentsOf(clientId) {
  return promisify((await store('appointments')).index('clientId').getAll(clientId));
}

export async function deleteAppointment(id, tombstone = true) {
  const db = await open();
  const tx = db.transaction(['appointments', 'deletions'], 'readwrite');
  const appts = tx.objectStore('appointments');
  const cur = await promisify(appts.get(id));
  appts.delete(id);
  // Un rendez-vous jamais envoyé n'a rien à effacer en ligne.
  if (tombstone && wasSent(cur)) tx.objectStore('deletions').put({ id, kind: 'appointment', at: now() });
  await done(tx);
  if (tombstone) changed();
}

// Client qui refuse l'accord RGPD : ses rendez-vous passés sont effacés, ceux à venir restent
// sur la tablette seulement (jamais envoyés ; effacés en ligne s'ils y étaient déjà).
// Retourne le nombre de rendez-vous gardés.
export async function detachAppointments(clientId, nowIso) {
  const db = await open();
  const tx = db.transaction(['appointments', 'deletions'], 'readwrite');
  const appts = tx.objectStore('appointments');
  const dels = tx.objectStore('deletions');
  let kept = 0;
  for (const a of await promisify(appts.index('clientId').getAll(clientId))) {
    if (a.start < nowIso) {
      appts.delete(a.id);
      if (wasSent(a)) dels.put({ id: a.id, kind: 'appointment', at: now() });
      continue;
    }
    if (wasSent(a)) dels.put({ id: a.id, kind: 'appointment', at: now() });
    const { dirty, sent, ...rest } = a;
    appts.put({ ...rest, clientId: null, localOnly: 1 });
    kept++;
  }
  await done(tx);
  changed();
  return kept;
}

// RGPD : un rendez-vous gardé après un refus (localOnly) est effacé une fois son jour passé.
// Il n'est plus en ligne : rien à y effacer.
export async function purgeLocalOnly(beforeIso) {
  const db = await open();
  const tx = db.transaction('appointments', 'readwrite');
  const appts = tx.objectStore('appointments');
  for (const a of await promisify(appts.index('start').getAll(IDBKeyRange.upperBound(beforeIso, true)))) {
    if (a.localOnly) appts.delete(a.id);
  }
  await done(tx);
}

// --- Synchro (utilisé par sync.js) ---

// Enregistrements modifiés sur la tablette et pas encore envoyés.
export async function dirty(name) {
  return promisify((await store(name)).index('dirty').getAll(1));
}

// Marque un envoi réussi, sauf si l'enregistrement a été modifié entre-temps (il repartira au prochain tour).
export async function markSynced(name, id, version, syncedAt) {
  const s = await store(name, 'readwrite');
  const cur = await promisify(s.get(id));
  if (!cur || (cur.updatedAt ?? cur.createdAt) !== version) return;
  delete cur.dirty;
  cur.syncedAt = syncedAt;
  await promisify(s.put(cur));
}

// Écrit un enregistrement reçu d'en ligne, sans le marquer à renvoyer.
export async function putRemote(name, record) {
  await promisify((await store(name, 'readwrite')).put(record));
}

export async function pendingDeletions() {
  return promisify((await store('deletions')).getAll());
}

export async function clearDeletion(id) {
  await promisify((await store('deletions', 'readwrite')).delete(id));
}
