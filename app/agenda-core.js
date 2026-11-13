// Calculs de l'agenda, sans écran ni stockage (testés par node --test tests/*.test.js).
// Heures en fuseau de la tablette ; un rendez-vous a `start` (ISO) et `duration` (minutes).

export const OPEN_MIN = 8 * 60 + 30;
export const CLOSE_MIN = 18 * 60;
export const STEP_MIN = 15;
export const SLOT_MIN = 30;

// Point de départ de la durée proposée ; le coiffeur l'ajuste à chaque rendez-vous.
export const STANDARD_DURATION = {
  'Coupe & coiffage': 30,
  Coloration: 120,
  Lissage: 150,
  Soin: 30,
  Barbe: 30,
  Massage: 30,
  Visagiste: 30,
  Diagnostic: 15
};

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;

export const minutesOf = (date) => date.getHours() * 60 + date.getMinutes();

const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);

export function weekStart(date) {
  const day = midnight(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

// Le samedi après-midi, la semaine est presque finie, et le dimanche le salon est fermé : on montre
// déjà la semaine qui vient (les rendez-vous du jour restent sur l'accueil de l'espace coiffeur).
export const NEXT_WEEK_SAT_HOUR = 12;
export function defaultWeek(now) {
  const monday = weekStart(now);
  const turned = now.getDay() === 0 || (now.getDay() === 6 && now.getHours() >= NEXT_WEEK_SAT_HOUR);
  return turned ? addDays(monday, 7) : monday;
}

// Le salon ouvre du lundi au samedi.
export const isOpenDay = (date) => date.getDay() !== 0;

// Haut du planning du jour à l'ouverture : une demi-heure avant maintenant, sans sortir de la
// journée ; en fin d'après-midi, la dernière heure reste visible.
// Haut du planning du jour : une demi-heure avant maintenant ; si ce point coupe un rendez-vous commencé
// moins d'une heure plus tôt, on remonte à son début pour qu'il se lise en entier (nom compris).
export function planStartMin(now, appts = []) {
  const want = minutesOf(now) - SLOT_MIN;
  let start = want;
  for (const a of appts) {
    const s = minutesOf(new Date(a.start));
    if (s < start && s + a.duration > want && s >= want - 60) start = s;
  }
  return Math.min(Math.max(start, OPEN_MIN), CLOSE_MIN - 60);
}

// Morceaux libres de chaque demi-heure, au quart d'heure près : pas avant le prochain quart d'heure
// aujourd'hui, après le rendez-vous qui occupe leur début, jusqu'au rendez-vous suivant.
// Le décalage à « maintenant » vient d'abord : un rendez-vous qui commence pile au quart d'heure
// suivant repousse encore le début (sinon un créneau « libre » le recouvrait).
export function freeSlots(day, appts, now) {
  const out = [];
  const sorted = [...appts].sort((x, y) => x.start.localeCompare(y.start));
  const isToday = day.toDateString() === now.toDateString();
  const nowMin = isToday ? minutesOf(now) : day < now ? Infinity : -Infinity;
  for (let m = OPEN_MIN; m < CLOSE_MIN; m += SLOT_MIN) {
    let start = m < nowMin ? Math.ceil(nowMin / STEP_MIN) * STEP_MIN : m;
    for (const a of sorted) {
      const s = minutesOf(new Date(a.start));
      if (s <= start && s + a.duration > start) start = s + a.duration;
    }
    let end = m + SLOT_MIN;
    for (const a of sorted) {
      const s = minutesOf(new Date(a.start));
      if (s > start && s < end) end = s;
    }
    if (start < end) out.push({ start, end });
  }
  return out;
}

export const weekDays = (monday) => Array.from({ length: 6 }, (_, i) => addDays(monday, i));

export function weekLabel(monday) {
  const sat = addDays(monday, 5);
  const fmt = (date, opts) => new Intl.DateTimeFormat('fr-FR', opts).format(date);
  if (monday.getFullYear() !== sat.getFullYear()) {
    const full = { day: 'numeric', month: 'long', year: 'numeric' };
    return `Semaine du ${fmt(monday, full)} au ${fmt(sat, full)}`;
  }
  const from = monday.getMonth() === sat.getMonth() ? monday.getDate() : fmt(monday, { day: 'numeric', month: 'long' });
  return `Semaine du ${from} au ${fmt(sat, { day: 'numeric', month: 'long' })}`;
}

export function slotAt(day, minutes) {
  const m = Math.min(Math.max(Math.floor(minutes / SLOT_MIN) * SLOT_MIN, OPEN_MIN), CLOSE_MIN - SLOT_MIN);
  const d = midnight(day);
  d.setMinutes(m);
  return d;
}

export const endOf = (a) => new Date(new Date(a.start).getTime() + a.duration * MIN_MS);

export const standardDuration = (services) =>
  services.length ? services.reduce((sum, s) => sum + (STANDARD_DURATION[s] || 0), 0) : SLOT_MIN;

const sameSet = (a, b) => a.length === b.length && a.every((s) => b.includes(s));
const byStart = (a, b) => a.start.localeCompare(b.start);

export function prefillDuration(services, previous) {
  const match = [...previous].sort(byStart).reverse().find((a) => sameSet(a.services, services));
  return match ? { duration: match.duration, from: match.start } : { duration: standardDuration(services), from: null };
}

// Le chevauchement passe avant la fermeture : c'est le rendez-vous suivant qui gêne le plus souvent.
export function checkSlot(candidate, list) {
  const start = new Date(candidate.start);
  const end = endOf(candidate);
  const other = list
    .filter((a) => a.id !== candidate.id && new Date(a.start) < end && endOf(a) > start)
    .sort(byStart)[0];
  if (other) return { reason: 'overlap', other };
  if ((end - midnight(start)) / MIN_MS > CLOSE_MIN) return { reason: 'close' };
  return null;
}

// Jusqu'où le créneau est libre (minutes depuis minuit) : début du rendez-vous suivant du même jour,
// sinon la fermeture. `inside` : le début tombe déjà dans un rendez-vous (`next`).
export function freeUntil(candidate, list) {
  const start = new Date(candidate.start);
  const s = minutesOf(start);
  let until = CLOSE_MIN;
  let next = null;
  for (const a of [...list].sort(byStart)) {
    const as = new Date(a.start);
    if (a.id === candidate.id || as.toDateString() !== start.toDateString()) continue;
    const am = minutesOf(as);
    if (am <= s && am + a.duration > s) return { until: s, next: a, inside: true };
    if (am > s && am < until) {
      until = am;
      next = a;
    }
  }
  return { until, next, inside: false };
}

export function nextOfDay(list, now) {
  return [...list].sort(byStart).find((a) => endOf(a) > now)?.id ?? null;
}

// Groupes de rendez-vous qui se chevauchent : chacun prend une colonne du groupe.
export function lanes(list) {
  const out = new Map();
  let group = [];
  let groupEnd = 0;
  const flush = () => group.forEach((g) => out.set(g.a.id, { lane: g.lane, lanes: Math.max(...group.map((x) => x.lane)) + 1 }));
  for (const a of [...list].sort(byStart)) {
    const start = new Date(a.start).getTime();
    if (start >= groupEnd) {
      flush();
      group = [];
      groupEnd = 0;
    }
    const busy = new Set(group.filter((g) => endOf(g.a).getTime() > start).map((g) => g.lane));
    let lane = 0;
    while (busy.has(lane)) lane++;
    group.push({ a, lane });
    groupEnd = Math.max(groupEnd, endOf(a).getTime());
  }
  flush();
  return out;
}

export function lastColor(visits, now) {
  const last = visits.filter((v) => v.services.includes('Coloration')).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!last) return null;
  const days = Math.round((midnight(now) - midnight(new Date(last.date))) / DAY_MS);
  return { days, date: last.date };
}

// En semaines tant que ça compte pour une couleur (repousse), puis en mois et en années.
// `short` : forme de la liste des clients (« hier », « il y a 3 j », « il y a 4 sem. »), mêmes arrondis.
export function agoText(days, short = false) {
  if (days <= 0) return 'aujourd’hui';
  if (short && days === 1) return 'hier';
  if (days < 14) return short ? `il y a ${days} j` : `il y a ${days} jour${days > 1 ? 's' : ''}`;
  if (days < 91) return `il y a ${Math.floor(days / 7)} ${short ? 'sem.' : 'semaines'}`;
  if (days < 365) return `il y a ${Math.round(days / 30.44)} mois`;
  const years = Math.floor(days / 365);
  return `il y a ${years} an${years > 1 ? 's' : ''}`;
}

export function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
