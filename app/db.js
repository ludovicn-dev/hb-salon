// Stockage local (IndexedDB). Chaque enregistrement porte `syncedAt` pour la synchro Supabase (étape 2).

const DB_NAME = 'hb-salon';
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
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
    syncedAt: null
  };
  await promisify((await store('clients', 'readwrite')).put(record));
  return record;
}

// Efface la fiche, ses visites et leurs photos (client sans accord RGPD).
export async function deleteClient(id) {
  const db = await open();
  const tx = db.transaction(['clients', 'visits', 'photos'], 'readwrite');
  tx.objectStore('clients').delete(id);
  const visits = tx.objectStore('visits');
  const photos = tx.objectStore('photos');
  const visitIds = await promisify(visits.index('clientId').getAllKeys(id));
  for (const visitId of visitIds) {
    visits.delete(visitId);
    const keys = await promisify(photos.index('visitId').getAllKeys(visitId));
    keys.forEach((k) => photos.delete(k));
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
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
    syncedAt: null
  };
  await promisify((await store('visits', 'readwrite')).put(record));
  return record;
}

export async function deleteVisit(id) {
  const db = await open();
  const tx = db.transaction(['visits', 'photos'], 'readwrite');
  tx.objectStore('visits').delete(id);
  const photos = tx.objectStore('photos');
  const keys = await promisify(photos.index('visitId').getAllKeys(id));
  keys.forEach((k) => photos.delete(k));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// --- Photos (Blob JPEG + miniature, rattachées à une visite) ---

export async function addPhoto(visitId, blob, thumb = null) {
  const record = { id: uid(), visitId, blob, thumb, createdAt: now(), syncedAt: null };
  await promisify((await store('photos', 'readwrite')).put(record));
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

export async function deletePhoto(id) {
  await promisify((await store('photos', 'readwrite')).delete(id));
}
