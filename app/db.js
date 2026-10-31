// Stockage local (IndexedDB). La tablette reste la référence : tout y est enregistré d'abord,
// puis sync.js envoie à Supabase les enregistrements marqués `dirty` et les effacements.

const DB_NAME = 'hb-salon';
const DB_VERSION = 2;
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
export async function deleteClient(id, tombstone = true) {
  const db = await open();
  const tx = db.transaction(['clients', 'visits', 'photos', 'deletions'], 'readwrite');
  const visits = tx.objectStore('visits');
  const photos = tx.objectStore('photos');
  const dels = tx.objectStore('deletions');
  const mark = (kind, key) => tombstone && dels.put({ id: key, kind, at: now() });
  tx.objectStore('clients').delete(id);
  mark('client', id);
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
