// Tests des calculs de l'agenda : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPEN_MIN,
  CLOSE_MIN,
  STANDARD_DURATION,
  minutesOf,
  weekStart,
  defaultWeek,
  weekDays,
  weekLabel,
  slotAt,
  endOf,
  standardDuration,
  prefillDuration,
  checkSlot,
  freeUntil,
  nextOfDay,
  lanes,
  lastColor,
  agoText,
  fmtDuration
} from '../app/agenda-core.js';

const d = (day, h = 0, m = 0, month = 10, year = 2026) => new Date(year, month, day, h, m);
const iso = (...a) => d(...a).toISOString();
const appt = (id, start, duration, extra = {}) => ({ id, start, duration, services: [], ...extra });

test('constantes des horaires et durées standard', () => {
  assert.equal(OPEN_MIN, 510);
  assert.equal(CLOSE_MIN, 1080);
  assert.deepEqual(STANDARD_DURATION, {
    'Coupe & coiffage': 30,
    Coloration: 120,
    Lissage: 150,
    Soin: 30,
    Barbe: 30,
    Massage: 30,
    Visagiste: 30,
    Diagnostic: 15
  });
});

test('minutesOf compte depuis minuit', () => {
  assert.equal(minutesOf(d(9, 14, 30)), 870);
});

test('weekStart : lundi de la semaine, le dimanche appartient à la semaine qui finit', () => {
  assert.equal(weekStart(d(14, 16)).getTime(), d(9).getTime());
  assert.equal(weekStart(d(15, 10)).getTime(), d(9).getTime());
  assert.equal(weekStart(d(9, 8)).getTime(), d(9).getTime());
});

test('defaultWeek : le samedi après-midi et le dimanche ouvrent la semaine suivante', () => {
  assert.equal(defaultWeek(d(15, 10)).getTime(), d(16).getTime());
  assert.equal(defaultWeek(d(11, 10)).getTime(), d(9).getTime());
  assert.equal(defaultWeek(d(14, 11, 59)).getTime(), d(9).getTime());
  assert.equal(defaultWeek(d(14, 12)).getTime(), d(16).getTime());
  assert.equal(defaultWeek(d(14, 17, 30)).getTime(), d(16).getTime());
});

test('weekDays : lundi → samedi', () => {
  const days = weekDays(d(9));
  assert.equal(days.length, 6);
  assert.equal(days[0].getTime(), d(9).getTime());
  assert.equal(days[5].getTime(), d(14).getTime());
});

test('weekLabel dans un mois, sur deux mois, sur deux années', () => {
  assert.equal(weekLabel(d(9)), 'Semaine du 9 au 14 novembre');
  assert.equal(weekLabel(d(30)), 'Semaine du 30 novembre au 5 décembre');
  assert.equal(weekLabel(d(28, 0, 0, 11)), 'Semaine du 28 décembre 2026 au 2 janvier 2027');
});

test('slotAt arrondit à la demi-heure inférieure, borné aux horaires', () => {
  assert.equal(slotAt(d(9), 8 * 60 + 40).getTime(), d(9, 8, 30).getTime());
  assert.equal(slotAt(d(9), 14 * 60 + 59).getTime(), d(9, 14, 30).getTime());
  assert.equal(slotAt(d(9), 17 * 60 + 50).getTime(), d(9, 17, 30).getTime());
  assert.equal(slotAt(d(9), 7 * 60).getTime(), d(9, 8, 30).getTime());
});

test('endOf ajoute la durée', () => {
  assert.equal(endOf(appt('a', iso(9, 9), 150)).getTime(), d(9, 11, 30).getTime());
});

test('standardDuration additionne, 30 min sans prestation', () => {
  assert.equal(standardDuration([]), 30);
  assert.equal(standardDuration(['Coupe & coiffage', 'Coloration']), 150);
  assert.equal(standardDuration(['Diagnostic']), 15);
});

test('prefillDuration reprend le dernier rendez-vous aux mêmes prestations', () => {
  const prev = [
    appt('a', iso(12, 9, 0, 8), 150, { services: ['Coloration'] }),
    appt('b', iso(1, 9, 0, 9), 180, { services: ['Coloration', 'Coupe & coiffage'] }),
    appt('c', iso(20, 9, 0, 7), 135, { services: ['Coloration'] })
  ];
  assert.deepEqual(prefillDuration(['Coloration'], prev), { duration: 150, from: iso(12, 9, 0, 8) });
  assert.deepEqual(prefillDuration(['Coupe & coiffage', 'Coloration'], prev), { duration: 180, from: iso(1, 9, 0, 9) });
  assert.deepEqual(prefillDuration(['Soin'], prev), { duration: 30, from: null });
});

test('checkSlot : bout à bout accepté', () => {
  assert.equal(checkSlot({ start: iso(9, 14), duration: 60 }, [appt('x', iso(9, 15), 30)]), null);
});

test('checkSlot : un quart d’heure de trop chevauche le suivant', () => {
  const other = appt('x', iso(9, 15), 30);
  assert.deepEqual(checkSlot({ start: iso(9, 14), duration: 75 }, [other]), { reason: 'overlap', other });
});

test('checkSlot : renvoie le premier chevauché par heure de début', () => {
  const a = appt('a', iso(9, 15), 30);
  const b = appt('b', iso(9, 14, 30), 30);
  assert.equal(checkSlot({ start: iso(9, 14), duration: 120 }, [a, b]).other, b);
});

test('checkSlot : fin après 18 h refusée', () => {
  assert.deepEqual(checkSlot({ start: iso(9, 17, 30), duration: 45 }, []), { reason: 'close' });
  assert.equal(checkSlot({ start: iso(9, 17, 30), duration: 30 }, []), null);
});

test('checkSlot : ignore le rendez-vous lui-même', () => {
  assert.equal(checkSlot({ id: 'x', start: iso(9, 14), duration: 60 }, [appt('x', iso(9, 14), 30)]), null);
});

test('checkSlot : le rendez-vous chevauché passe avant la fermeture', () => {
  const teva = appt('t', iso(9, 16, 45), 30);
  assert.deepEqual(checkSlot({ start: iso(9, 16, 30), duration: 120 }, [teva]), { reason: 'overlap', other: teva });
});

test('freeUntil : jusqu’au rendez-vous suivant du jour, sinon la fermeture', () => {
  const teva = appt('t', iso(9, 16, 45), 30);
  const lea = appt('l', iso(9, 10), 45);
  const demain = appt('d', iso(10, 9), 30);
  assert.deepEqual(freeUntil({ start: iso(9, 16, 30) }, [lea, teva, demain]), { until: 16 * 60 + 45, next: teva, inside: false });
  assert.deepEqual(freeUntil({ start: iso(9, 17, 15) }, [lea, teva, demain]), { until: CLOSE_MIN, next: null, inside: false });
  assert.deepEqual(freeUntil({ start: iso(9, 8, 30) }, [teva, lea]), { until: 10 * 60, next: lea, inside: false });
});

test('freeUntil : début déjà pris, et rendez-vous lui-même ignoré', () => {
  const lea = appt('l', iso(9, 10), 45);
  assert.deepEqual(freeUntil({ start: iso(9, 10, 30) }, [lea]), { until: 10 * 60 + 30, next: lea, inside: true });
  assert.deepEqual(freeUntil({ id: 'l', start: iso(9, 10) }, [lea]), { until: CLOSE_MIN, next: null, inside: false });
});

test('nextOfDay : le premier pas terminé', () => {
  const list = [appt('c', iso(7, 13), 60), appt('a', iso(7, 8, 30), 45), appt('b', iso(7, 9), 150)];
  assert.equal(nextOfDay(list, d(7, 9, 45)), 'b');
  assert.equal(nextOfDay(list, d(7, 18)), null);
});

test('lanes : chevauchements côte à côte', () => {
  const l = lanes([appt('a', iso(9, 9), 60), appt('b', iso(9, 9, 30), 60), appt('c', iso(9, 14), 30)]);
  assert.deepEqual(l.get('a'), { lane: 0, lanes: 2 });
  assert.deepEqual(l.get('b'), { lane: 1, lanes: 2 });
  assert.deepEqual(l.get('c'), { lane: 0, lanes: 1 });
});

test('lastColor : visite la plus récente avec Coloration', () => {
  const visits = [
    { date: iso(4, 10), services: ['Coupe & coiffage'] },
    { date: iso(12, 10, 0, 8), services: ['Coloration', 'Soin'] },
    { date: iso(1, 10, 0, 7), services: ['Coloration'] }
  ];
  assert.deepEqual(lastColor(visits, d(7, 15)), { days: 56, date: iso(12, 10, 0, 8) });
  assert.equal(lastColor([{ date: iso(4, 10), services: ['Soin'] }], d(7, 15)), null);
});

test('agoText : jours sous 2 semaines, semaines sous 3 mois, puis mois et années', () => {
  assert.equal(agoText(0), 'aujourd’hui');
  assert.equal(agoText(1), 'il y a 1 jour');
  assert.equal(agoText(13), 'il y a 13 jours');
  assert.equal(agoText(14), 'il y a 2 semaines');
  assert.equal(agoText(56), 'il y a 8 semaines');
  assert.equal(agoText(90), 'il y a 12 semaines');
  assert.equal(agoText(91), 'il y a 3 mois');
  assert.equal(agoText(200), 'il y a 7 mois');
  assert.equal(agoText(364), 'il y a 12 mois');
  assert.equal(agoText(365), 'il y a 1 an');
  assert.equal(agoText(800), 'il y a 2 ans');
});

test('fmtDuration', () => {
  assert.equal(fmtDuration(15), '15 min');
  assert.equal(fmtDuration(45), '45 min');
  assert.equal(fmtDuration(120), '2 h');
  assert.equal(fmtDuration(150), '2 h 30');
});
