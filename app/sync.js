// Sauvegarde en ligne (Supabase), sans bibliothèque : appels REST directs.
// La tablette garde tout ; ici on envoie ce qui est marqué `dirty` et les effacements, puis on récupère
// les nouveautés d'en ligne (restauration sur une autre tablette).
// Un client qui n'a pas encore donné son accord RGPD n'est jamais envoyé.
// La clé ci-dessous est publique par nature : les règles d'accès (supabase/schema.sql) protègent les données.

import * as db from './db.js';

const URL_ = 'https://jewznzouivkamvxzfuox.supabase.co';
const KEY = 'sb_publishable_rJvG2uZM3sep2txSuyfRjw_6sLGLDcr';
const DEBOUNCE_MS = 5000;
const EVERY_MS = 5 * 60 * 1000;
const PAGE = 500;

// state : 'off' (pas connecté) | 'idle' | 'syncing' | 'offline' | 'error' | 'auth' (à reconnecter)
// failures : échecs d'affilée (pour signaler une panne qui dure).
const status = { state: 'off', email: '', lastAt: null, pending: 0, error: '', failures: 0 };
let session = null;
let running = null;
let queued = null;
let debounce = null;
let listeners = [];
let onPulled = () => {};

export const getStatus = () => ({ ...status });

export function subscribe(fn) {
  listeners.push(fn);
  return () => (listeners = listeners.filter((l) => l !== fn));
}

function set(patch) {
  Object.assign(status, patch);
  listeners.forEach((fn) => fn(getStatus()));
}

class HttpError extends Error {
  constructor(status, body) {
    super(body?.msg || body?.message || body?.error_description || body?.error || `HTTP ${status}`);
    this.status = status;
    this.code = body?.error_code || body?.code || body?.error;
  }
}

// ---------- Connexion ----------

async function authCall(path, body) {
  const res = await fetch(`${URL_}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, data);
  return data;
}

async function keep(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + data.expires_in,
    user: { id: data.user.id, email: data.user.email }
  };
  await db.setSetting('supaSession', session);
}

export async function signIn(email, password) {
  await keep(await authCall('token?grant_type=password', { email, password }));
  set({ state: 'idle', email: session.user.email, error: '' });
  syncNow();
}

export async function signOut() {
  const token = session?.access_token;
  session = null;
  await db.setSetting('supaSession', null);
  await db.setSetting('syncCursor', null);
  set({ state: 'off', email: '', error: '', failures: 0 });
  if (token) fetch(`${URL_}/auth/v1/logout`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${token}` } }).catch(() => {});
}

async function refresh() {
  try {
    await keep(await authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token }));
  } catch (err) {
    // Jeton refusé (mot de passe changé, compte supprimé) : il faut se reconnecter. Sinon, réseau : on réessaiera.
    if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
      set({ state: 'auth', error: '' });
      throw Object.assign(err, { auth: true });
    }
    throw err;
  }
}

async function token() {
  if (session.expires_at - 60 < Date.now() / 1000) await refresh();
  return session.access_token;
}

async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}, retried = false) {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${await token()}`,
      ...(body && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401 && !retried) {
    await refresh();
    return api(path, { method, body, headers, raw }, true);
  }
  if (!res.ok) throw new HttpError(res.status, await res.json().catch(() => ({})));
  if (raw) return res;
  return res.status === 204 ? null : res.json().catch(() => null);
}

const rest = (table, query = '', opts) => api(`/rest/v1/${table}${query}`, opts);
const photoPath = (id, thumb) => `${session.user.id}/${id}${thumb ? '-thumb' : ''}.jpg`;

// ---------- Correspondance tablette ↔ en ligne ----------

const toRow = {
  clients: (c) => ({
    id: c.id,
    first_name: c.firstName,
    last_name: c.lastName,
    phone: c.phone,
    email: c.email,
    allergies: c.allergies,
    consent_at: c.consentAt,
    created_at: c.createdAt,
    updated_at: c.updatedAt
  }),
  visits: (v) => ({
    id: v.id,
    client_id: v.clientId,
    date: v.date,
    services: v.services,
    formula: v.formula,
    note: v.note,
    status: v.status,
    validated_at: v.validatedAt || null,
    created_at: v.createdAt,
    updated_at: v.updatedAt
  }),
  appointments: (a) => ({
    id: a.id,
    client_id: a.clientId,
    first_name: a.firstName,
    phone: a.phone,
    start_at: a.start,
    duration_min: a.duration,
    services: a.services,
    created_at: a.createdAt,
    updated_at: a.updatedAt
  })
};

const fromRow = {
  clients: (r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    email: r.email,
    allergies: r.allergies,
    consentAt: r.consent_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    syncedAt: r.synced_at
  }),
  visits: (r) => ({
    id: r.id,
    clientId: r.client_id,
    date: r.date,
    services: r.services,
    formula: r.formula,
    note: r.note,
    status: r.status,
    ...(r.validated_at ? { validatedAt: r.validated_at } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    syncedAt: r.synced_at
  }),
  appointments: (r) => ({
    id: r.id,
    clientId: r.client_id,
    firstName: r.first_name,
    phone: r.phone,
    start: new Date(r.start_at).toISOString(),
    duration: r.duration_min,
    services: r.services,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    syncedAt: r.synced_at
  })
};

// Seules les fiches avec accord RGPD partent en ligne, avec leurs visites, photos et rendez-vous.
// Un rendez-vous gardé après un refus (localOnly) ne part jamais.
async function consentedIds() {
  const clients = await db.allClients();
  return new Set(clients.filter((c) => c.consentAt).map((c) => c.id));
}

async function eligible() {
  const ok = await consentedIds();
  const visits = await db.allVisits();
  const visitOk = new Set(visits.filter((v) => ok.has(v.clientId)).map((v) => v.id));
  const apptOk = (a) => !a.localOnly && ok.has(a.clientId);
  return { ok, visitOk, apptOk };
}

// ---------- Envoi ----------

async function pushRecords(table, list) {
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const rows = await rest(table, '?on_conflict=id', {
      method: 'POST',
      body: chunk.map(toRow[table]),
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' }
    });
    const syncedAt = new Map(rows.map((r) => [r.id, r.synced_at]));
    for (const rec of chunk) await db.markSynced(table, rec.id, rec.updatedAt, syncedAt.get(rec.id));
  }
}

async function upload(path, blob) {
  await api(`/storage/v1/object/photos/${path}`, {
    method: 'POST',
    body: blob,
    headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }
  });
}

async function push() {
  const { ok, visitOk, apptOk } = await eligible();

  // Effacements d'abord : une fiche sans accord doit disparaître d'en ligne au plus vite.
  const dels = await db.pendingDeletions();
  if (dels.length) {
    await rest('deletions', '?on_conflict=id', {
      method: 'POST',
      body: dels.map((d) => ({ id: d.id, kind: d.kind, deleted_at: d.at })),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
    });
    const photos = dels.filter((d) => d.kind === 'photo');
    if (photos.length) {
      await api('/storage/v1/object/photos', {
        method: 'DELETE',
        body: { prefixes: photos.flatMap((d) => [photoPath(d.id), photoPath(d.id, true)]) }
      });
    }
    for (const kind of ['appointment', 'photo', 'visit', 'client']) {
      const ids = dels.filter((d) => d.kind === kind).map((d) => d.id);
      for (let i = 0; i < ids.length; i += 100) {
        await rest(`${kind}s`, `?id=in.(${ids.slice(i, i + 100).join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      }
    }
    for (const d of dels) await db.clearDeletion(d.id);
  }

  await pushRecords('clients', (await db.dirty('clients')).filter((c) => ok.has(c.id)));
  await pushRecords('visits', (await db.dirty('visits')).filter((v) => visitOk.has(v.id)));

  for (const p of await db.dirty('photos')) {
    if (!visitOk.has(p.visitId)) continue;
    await upload(photoPath(p.id), p.blob);
    if (p.thumb) await upload(photoPath(p.id, true), p.thumb);
    const [row] = await rest('photos', '?on_conflict=id', {
      method: 'POST',
      body: [{ id: p.id, visit_id: p.visitId, created_at: p.createdAt }],
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' }
    });
    await db.markSynced('photos', p.id, p.createdAt, row.synced_at);
  }

  await pushRecords('appointments', (await db.dirty('appointments')).filter(apptOk));
}

// ---------- Réception ----------

async function pullTable(table, apply) {
  const cursors = (await db.getSetting('syncCursor')) || {};
  let cursor = cursors[table] || '1970-01-01T00:00:00Z';
  let changed = false;
  for (;;) {
    const rows = await rest(table, `?synced_at=gt.${encodeURIComponent(cursor)}&order=synced_at.asc&limit=${PAGE}`);
    for (const r of rows) changed = (await apply(r)) || changed;
    if (rows.length) {
      cursor = rows[rows.length - 1].synced_at;
      await db.setSetting('syncCursor', { ...((await db.getSetting('syncCursor')) || {}), [table]: cursor });
    }
    if (rows.length < PAGE) return changed;
  }
}

// Le plus récent gagne ; une modification locale pas encore envoyée n'est pas écrasée par une plus ancienne.
const getters = { clients: db.getClient, visits: db.getVisit, appointments: db.getAppointment };
const applyRecord = (table) => async (r) => {
  const local = await getters[table](r.id);
  if (local?.localOnly) return false;
  if (local?.dirty && local.updatedAt > r.updated_at) return false;
  if (local && !local.dirty && local.syncedAt === r.synced_at) return false;
  await db.putRemote(table, fromRow[table](r));
  return true;
};

async function download(path) {
  try {
    return await (await api(`/storage/v1/object/authenticated/photos/${path}`, { raw: true })).blob();
  } catch (err) {
    if (err instanceof HttpError && (err.status === 400 || err.status === 404)) return null;
    throw err;
  }
}

async function applyPhoto(r) {
  if (await db.getPhoto(r.id)) return false;
  const blob = await download(photoPath(r.id));
  if (!blob) return false;
  const thumb = await download(photoPath(r.id, true));
  await db.putRemote('photos', { id: r.id, visitId: r.visit_id, blob, thumb, createdAt: r.created_at, syncedAt: r.synced_at });
  return true;
}

// Nos propres effacements reviennent aussi : rien à faire s'ils sont déjà appliqués.
async function applyDeletion(r) {
  const [get, del] = {
    client: [db.getClient, db.deleteClient],
    visit: [db.getVisit, db.deleteVisit],
    photo: [db.getPhoto, db.deletePhoto],
    appointment: [db.getAppointment, db.deleteAppointment]
  }[r.kind];
  const local = await get(r.id);
  // Rendez-vous gardé sur cette tablette après un refus RGPD : son effacement en ligne ne le concerne pas.
  if (!local || local.localOnly) return false;
  await del(r.id, false);
  return true;
}

// Dans l'ordre : effacements, puis fiches avant leurs visites, leurs photos et leurs rendez-vous.
async function pull() {
  let changed = false;
  changed = (await pullTable('deletions', applyDeletion)) || changed;
  changed = (await pullTable('clients', applyRecord('clients'))) || changed;
  changed = (await pullTable('visits', applyRecord('visits'))) || changed;
  changed = (await pullTable('photos', applyPhoto)) || changed;
  changed = (await pullTable('appointments', applyRecord('appointments'))) || changed;
  return changed;
}

// ---------- Cycle ----------

async function countPending() {
  const { ok, visitOk, apptOk } = await eligible();
  const [clients, visits, photos, appts, dels] = await Promise.all([
    db.dirty('clients'),
    db.dirty('visits'),
    db.dirty('photos'),
    db.dirty('appointments'),
    db.pendingDeletions()
  ]);
  const count = (list, okSet, key = 'id') => list.filter((r) => okSet.has(r[key])).length;
  return count(clients, ok) + count(visits, visitOk) + count(photos, visitOk, 'visitId') + appts.filter(apptOk).length + dels.length;
}

async function run() {
  if (!session) return;
  if (!navigator.onLine) {
    set({ state: 'offline', pending: await countPending() });
    return;
  }
  set({ state: 'syncing', error: '' });
  try {
    await push();
    const pulled = await pull();
    set({ state: 'idle', lastAt: new Date().toISOString(), pending: await countPending(), error: '', failures: 0 });
    await db.setSetting('syncLastAt', status.lastAt);
    if (pulled) onPulled();
  } catch (err) {
    const pending = await countPending().catch(() => status.pending);
    if (err.auth) set({ state: 'auth', pending });
    else if (err instanceof TypeError || !navigator.onLine) set({ state: 'offline', pending });
    else {
      console.warn('Sauvegarde en ligne :', err);
      set({ state: 'error', pending, error: err.message, failures: status.failures + 1 });
    }
  }
}

// Une demande pendant un tour en lance un autre juste après (une seule fois, quel que soit le nombre d'appels).
export function syncNow() {
  if (!session) return Promise.resolve();
  if (running) {
    queued ??= running.then(() => {
      queued = null;
      return syncNow();
    });
    return queued;
  }
  running = run().finally(() => (running = null));
  return running;
}

function schedule() {
  clearTimeout(debounce);
  debounce = setTimeout(syncNow, DEBOUNCE_MS);
}

// À appeler une fois au démarrage. `pulled` : prévenu quand des données arrivent d'en ligne.
export async function start(pulled) {
  onPulled = pulled;
  db.onChange(() => {
    if (!session) return;
    countPending().then((pending) => set({ pending }));
    schedule();
  });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => session && set({ state: 'offline' }));
  setInterval(syncNow, EVERY_MS);
  session = (await db.getSetting('supaSession')) || null;
  if (!session) return;
  set({ state: 'idle', email: session.user.email, lastAt: (await db.getSetting('syncLastAt')) || null });
  syncNow();
}
