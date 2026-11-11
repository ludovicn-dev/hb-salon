# Écran « Aujourd'hui » — plan de mise en œuvre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**But :** remplacer l'espace « Fiches » par « Aujourd'hui ». La colonne « Client » reste, et un planning de la journée permet de toucher un créneau libre pour noter un rendez-vous, ou un rendez-vous pour ouvrir la fiche du client.

**Architecture :** `viewDayColumn` (agenda) devient commune aux deux espaces. Elle reçoit les rendez-vous du jour et, en mode « aujourd'hui », produit des blocs plus riches qui ouvrent la fiche. Deux petits calculs purs vont dans `agenda-core.js`, avec leurs tests. Pas de framework ni d'étape de build.

**Pile :** JavaScript simple (modules ES), CSS à variables, `node --test`, Playwright (MCP) pour vérifier à l'écran.

**Note de conception :** [docs/superpowers/specs/2026-11-11-ecran-aujourdhui-design.md](../specs/2026-11-11-ecran-aujourdhui-design.md)

## Contraintes globales
- Répondre et écrire les textes en français : espace fine insécable U+202F avant `? ! :`, apostrophe typographique `’` dans les textes affichés (comme le reste d'`app.js`), pas d'emoji, icônes par `icon()`.
- Couleurs et durées en variables CSS de `styles.css`, aucune en dur. Un seul bouton or plein par écran. Zones tactiles d'au moins 44 px, sauf les quarts d'heure, qui gardent `reachOf`.
- `S.space` vaut `'today'` ou `'agenda'` ; la valeur `'fiches'` disparaît partout.
- Après toute écriture de rendez-vous : `refreshAppts()`.
- Mise en ligne : `CACHE` passe de `'hb-salon-v17'` à `'hb-salon-v18'` dans `app/sw.js`.
- L'agenda (semaine) doit rester identique, au pixel près.
- Une demi-heure mesure `--half-h: 60px` dans le planning du jour. Le planning s'ouvre calé 30 minutes avant l'heure actuelle.

## Points à surveiller
1. **Après 18 h**, ou journée finie : tout est hachuré, aucun créneau n'est proposé, la ligne dit « Journée terminée. » et non « Touchez un créneau libre… ».
2. **Visite en cours sur une fiche, puis « Aujourd'hui » en haut** : le brouillon est mis de côté (`parkDraft`). En rouvrant la fiche, on le retrouve.
3. **Rendez-vous noté depuis « Aujourd'hui » pour une personne sans fiche** (prénom seul) : la fiche est créée et apparaît dans la colonne. Le bloc apparaît, flashe et prend le focus.
4. **Déplacement commencé dans l'agenda, puis bascule vers « Aujourd'hui »** : le déplacement est abandonné (`S.moving = null`). Un créneau touché ensuite ouvre la fenêtre de rendez-vous, il ne déplace rien.
5. **Deux rendez-vous qui se chevauchent** : ils sont côte à côte dans le planning large, chacun lisible, et chacun ouvre sa propre fiche.

Chacun de ces points a sa vérification à la tâche 5.

---

### Tâche 1 : calculs du jour dans `agenda-core.js`

**Fichiers :**
- Modifier : `app/agenda-core.js` (après `defaultWeek`)
- Tests : `tests/agenda-core.test.js` (ajouter les noms à l'import et les tests à la fin)

**Interfaces :**
- Produit : `isOpenDay(date: Date) -> boolean` (faux le dimanche seulement) ; `planStartMin(now: Date) -> number`, la minute du jour où caler le haut du planning : `OPEN_MIN` avant 9 h, sinon `minutesOf(now) - 30`, plafonné à `CLOSE_MIN - 60` pour qu'une fin de journée montre encore la dernière heure.

- [ ] **Étape 1 : écrire les tests, qui doivent échouer**

```js
test('isOpenDay : fermé le dimanche seulement', () => {
  assert.equal(isOpenDay(d(15)), false); // dimanche 15 novembre 2026
  assert.equal(isOpenDay(d(16)), true);  // lundi
  assert.equal(isOpenDay(d(14)), true);  // samedi
});

test('planStartMin : calé une demi-heure avant maintenant, borné à la journée', () => {
  assert.equal(planStartMin(d(11, 7, 0)), OPEN_MIN);
  assert.equal(planStartMin(d(11, 8, 50)), OPEN_MIN);
  assert.equal(planStartMin(d(11, 11, 10)), 10 * 60 + 40);
  assert.equal(planStartMin(d(11, 17, 40)), CLOSE_MIN - 60);
  assert.equal(planStartMin(d(11, 20, 0)), CLOSE_MIN - 60);
});
```

- [ ] **Étape 2 :** `node --test "tests/*.test.js"` → ÉCHEC (`isOpenDay` n'est pas exporté).
- [ ] **Étape 3 :** écrire les deux fonctions exportées dans `app/agenda-core.js`, avec un commentaire d'une ligne en français pour chacune.
- [ ] **Étape 4 :** `node --test "tests/*.test.js"` → tous les tests passent.
- [ ] **Étape 5 : commit**

```bash
git add app/agenda-core.js tests/agenda-core.test.js
git commit -m "Agenda : jour ouvert et calage du planning du jour"
```

---

### Tâche 2 : colonne de jour commune, agenda inchangé

**Fichiers :**
- Modifier : `app/app.js`. Concernés : `viewDayColumn` (vers la ligne 965), `viewAgenda` (repères d'heures, vers la ligne 1052), l'action `slot` (vers la ligne 2187) et `KEY_ATTRS` (ligne 200).

**Interfaces :**
- Produit :
  - `viewDayColumn(day: Date, appts: Appt[], now: Date, today = null) -> string`. Le paramètre `today` est `null` dans l'agenda. Dans le planning du jour, il vaut `{ next: string|null }` : l'identifiant du prochain rendez-vous, mis en or. L'index de jour `i` disparaît de la signature ; le nom du jour se calcule par `DAY_NAMES[(day.getDay() + 6) % 7]`.
  - `hourMarks(halves = false) -> string` : les `<span class="hour">` de 8 h 30 à 18 h, repris tels quels de `viewAgenda`. Avec `halves`, il écrit aussi les demi-heures.
  - Créneau libre : `<button class="slot" data-action="slot" data-start="<ISO du début>" …>`. Les attributs `data-day` et `data-min` disparaissent.
- Consomme : rien de la tâche 1.

- [ ] **Étape 1 : capture de référence de l'agenda.** Servir l'appli (`npx http-server -p 8080 -c-1` dans `app/`). Ouvrir Playwright en 1280×800, contexte `serviceWorkers: 'block'`, avec l'horloge figée par `page.clock.install({ time: new Date(2026, 10, 11, 11, 10) })`. Créer le code, puis trois rendez-vous le mercredi 11, dont deux qui se chevauchent. Enregistrer la capture `.playwright-mcp/agenda-avant.png`.
- [ ] **Étape 2 : passer `viewDayColumn` en `(day, appts, now, today = null)`.** `viewAgenda` lui passe `S.weekAppts` filtrés par jour, comme le fait aujourd'hui le corps de la fonction. Les créneaux portent `data-start` à la place de `data-day` et `data-min`. Si `today` est `null`, le balisage des blocs ne change pas.
- [ ] **Étape 3 : adapter l'action `slot` et `KEY_ATTRS`.** L'action devient `const start = el.dataset.start` ; la suite (`moveTo` ou `openModal(newApptModal(start))`) ne change pas. Dans `KEY_ATTRS`, `'data-start'` remplace `'data-day'` et `'data-min'`.
- [ ] **Étape 4 : extraire `hourMarks()`** de `viewAgenda` sans changer son rendu.
- [ ] **Étape 5 : vérifier.** Même scénario qu'à l'étape 1, capture `.playwright-mcp/agenda-apres.png`, à comparer : identique. Toucher un créneau doit ouvrir la fenêtre « Nouveau rendez-vous » à la bonne heure. Faire aussi un déplacement : il doit fonctionner. Lancer `node --test "tests/*.test.js"` : tous les tests passent.
- [ ] **Étape 6 : commit**

```bash
git add app/app.js
git commit -m "Agenda : colonne de jour réutilisable, créneaux désignés par leur date"
```

---

### Tâche 3 : planning du jour

**Fichiers :**
- Modifier : `app/app.js`. `viewEmpty` (vers la ligne 1161) est remplacée par `viewTodayPlan`, et `viewAgendaLine` (vers la ligne 1038) est adaptée.
- Modifier : `app/styles.css`. Le bloc « Rendez-vous du jour » (vers la ligne 1018, `.today-list`, `.today-row`…) est remplacé ; `.empty` est gardé pour le dimanche.

**Interfaces :**
- Consomme : `core.isOpenDay`, de la tâche 1 ; `viewDayColumn(day, appts, now, { next })` et `hourMarks(true)`, de la tâche 2.
- Produit : `viewTodayPlan() -> string`, avec pour racine `<div class="today-plan">` et pour titre `<h1 class="serif">Aujourd’hui</h1>`. Les blocs de rendez-vous du jour ont la classe `appt-block today-block` (plus `next` pour le prochain), `data-action="today-appt"` et `data-id`. `visitTag(a, now) -> string` est l'étiquette d'état, extraite telle quelle de `viewEmpty` : « À valider », « Validée à… », « Pas de visite notée », sinon « En cours ».

- [ ] **Étape 1 : `viewAgendaLine(hint)`.** Le paramètre `pastWeek` est remplacé par le texte de consigne, et la ligne garde son ordre : déplacement, puis message, puis consigne. Dans `viewAgenda`, l'appel devient `viewAgendaLine(pastWeek ? 'Semaine passée : consultation seulement.' : 'Touchez un créneau libre pour noter un rendez-vous.')`, avec exactement les textes actuels.
- [ ] **Étape 2 : blocs du jour dans `viewDayColumn`, quand `today` est fourni.**
  - Contenu, sur deux lignes :
    - ligne 1 : `.appt-time`, puis le nom complet (`apptName(a, true)`), l'icône d'allergie et, à droite, `visitTag(a, now)` ;
    - ligne 2 (`.appt-sub`) : les prestations en entier, puis `fmtDuration` et « jusqu’à HH h MM », séparés par `SEP`.
  - Un bloc de moins de 45 minutes garde la seule ligne 1, avec les prestations courtes à la suite du nom, comme dans l'agenda.
  - `aria-label` : celui de l'agenda, auquel s'ajoute l'état (`prochain rendez-vous`, `à valider`, `visite validée`…), comme dans la liste actuelle.
  - Allergie : bordeaux et triangle, c'est-à-dire les classes existantes `.today-allergy` ou l'icône `alert`. Rien d'autre que l'allergie ne prend ce bordeaux.
- [ ] **Étape 3 : `viewTodayPlan()`.** Elle prend la place de `viewEmpty()` à la ligne 470.
  - **Dimanche** (`!core.isOpenDay(now)`) : un bloc `.empty` avec `viewValidated()`, le titre « Salon fermé aujourd’hui », puis le lien du prochain rendez-vous ou « Ouvrir l’agenda ». Ce sont les deux liens qui existent déjà dans `viewEmpty`.
  - **Les autres jours** :
    - en-tête : `viewValidated()`, puis le titre, puis `<p class="muted">fmtDayTitle(now) SEP n rendez-vous</p>` (« aucun rendez-vous » si n = 0) ;
    - sous l'en-tête, `viewAgendaLine(...)`, avec la consigne « Touchez un créneau libre pour noter un rendez-vous. » ou, à partir de 18 h, « Journée terminée. ». À droite, le bouton `undo` quand `S.note?.undo` existe, avec le balisage de `viewAgenda`, et rien d'autre ;
    - sans rendez-vous aujourd'hui avec `S.upcoming` : le lien « Prochain rendez-vous : … » de `viewEmpty`, sous la ligne ;
    - le planning : `<div class="day-plan"><div class="hours">${hourMarks(true)}</div>${viewDayColumn(dayStart, S.todayAppts, now, { next })}</div>`, où `next` est calculé comme dans `viewEmpty` (`core.nextOfDay` sur les rendez-vous dont la visite n'est pas faite).
  - Supprimer `viewEmpty`.
- [ ] **Étape 4 : CSS.** Supprimer `.today-list`, `.today-rows`, `.today-row*`, `.today-time` et `.today-who*` ; garder `.today-allergy`, `.today-state*`, `.today-live` et `.tag-pending`, utilisés par `visitTag`. Ajouter :
  - sous `:root` : `--half-h: 60px` ;
  - `.day-plan` : grille `48px minmax(0, 1fr)`, `column-gap: 6px`, `height: calc(var(--half-h) * 19)`. 19 demi-heures vont de 8 h 30 à 18 h ;
  - `.today-block` : `font-size: 15px`, `padding: 6px 12px`, ligne 1 en `display: flex; gap: 10px; width: 100%`, état poussé à droite par `margin-left: auto` ;
  - `.today-block.next` : `box-shadow: inset 0 0 0 1.5px var(--accent)`, comme `.live` ;
  - `.today-plan` : colonne flex avec `gap: 8px` et `padding-bottom: 24px`, titre à 40 px comme l'ancien `.today-list h1`.
- [ ] **Étape 5 : vérifier.** En 1280×800 à 11 h 10, avec les rendez-vous de la tâche 2, l'écran ressemble à l'option B de la maquette : nom complet, prestations, état, prochain rendez-vous en or, temps passé hachuré. Le défilement n'est pas encore calé, c'est la tâche 4. Toucher un créneau ouvre « Nouveau rendez-vous » ; enregistrer fait apparaître le bloc dans le planning et la confirmation sous le titre. Toucher un bloc ouvre la fiche avec les prestations cochées. Capture : `.playwright-mcp/today-1280.png`.
- [ ] **Étape 6 : commit**

```bash
git add app/app.js app/styles.css
git commit -m "Aujourd'hui : planning du jour avec prise de rendez-vous"
```

---

### Tâche 4 : navigation, focus, calage, mise en ligne

**Fichiers :**
- Modifier : `app/app.js`. Concernés : `S.space` (ligne 55), `viewCoiffeur` (vers la ligne 444), `viewTodayEntry` (supprimée), `openApptClient` (vers la ligne 816), `saveAppt` (`S.modalReturn`, vers la ligne 802), `undoAgenda` (vers la ligne 897), l'action `show-appt` (vers la ligne 2271), les actions `space` et `today` (vers les lignes 2182 et 2304), et la fin de `enterCoiffeur`.
- Modifier : `app/styles.css` (supprimer `.today-entry*`, vers les lignes 322 et 1058), `app/sw.js` (`CACHE`) et `CLAUDE.md` (les lignes « Accueil "Aujourd'hui" » et « action `today` »).

**Interfaces :**
- Consomme : `core.planStartMin`, de la tâche 1 ; `.today-plan` et `.appt-block[data-id]`, de la tâche 3.
- Produit : `scrollPlanToNow()`. Elle cale le défilement de `.detail`, ou de `.coiffeur-body` quand c'est lui qui défile (largeur de 700 px ou moins), pour que la minute `planStartMin(new Date())` soit en haut de la vue. Elle ne fait rien si `.today-plan .day-col` est absent.

- [ ] **Étape 1 : boutons du haut.**
  - Le bouton de gauche devient `data-space="today"`, avec `icon('home', 22)` et le libellé « Aujourd’hui ». Il est enfoncé (`aria-pressed`) quand `S.space === 'today'`, même si une fiche est ouverte.
  - `S.space` vaut `'today'` au départ ; `openApptClient` passe aussi à `'today'`.
  - Supprimer `viewTodayEntry()` et son appel, puis le CSS `.today-entry*`.
- [ ] **Étape 2 : action `space`.** Elle abandonne tout déplacement en cours (`S.moving = null`). Pour `'today'`, elle fait ce que fait l'actuelle action `today` : `parkDraft()`, puis effacer `clientId`, `client` et `query`. Elle dessine ensuite l'écran, appelle `scrollPlanToNow()` et met le focus sur `[data-space="today"]`. Supprimer l'action `today`.
- [ ] **Étape 3 : focus.**
  - `saveAppt` : `S.modalReturn = `.appt-block[data-id="${saved.id}"]``.
  - `undoAgenda` : `render({ focus: S.space === 'agenda' ? '.agenda-head h1' : '.today-plan h1' })`.
  - `show-appt` : sans changement, il passe déjà à l'agenda.
- [ ] **Étape 4 : calage à l'arrivée.** Appeler `scrollPlanToNow()` après le `go('coiffeur')` de `enterCoiffeur`, quand aucune fiche n'est ouverte, et dans l'action `space` vers `'today'`. Pas d'appel dans les autres rendus : `render()` garde la position.
- [ ] **Étape 5 : mise en ligne et documentation.** Dans `app/sw.js` : `const CACHE = 'hb-salon-v18';`. Dans `CLAUDE.md`, remplacer l'entrée « Accueil "Aujourd'hui" » par : *Espace « Aujourd'hui » (`S.space = 'today'`) : planning du jour (`viewTodayPlan`, colonne partagée avec l'agenda `viewDayColumn(day, appts, now, { next })`). Un créneau libre note un rendez-vous ; un rendez-vous ouvre la fiche. Le bouton du haut referme la fiche ouverte.*
- [ ] **Étape 6 : vérifier.** Ouvrir l'espace coiffeur à 11 h 10 : le planning s'ouvre calé sur 10 h 40. Ouvrir une fiche, puis toucher « Aujourd'hui » en haut : retour au planning calé sur l'heure. Lancer `node --test "tests/*.test.js"` : tous les tests passent.
- [ ] **Étape 7 : commit**

```bash
git add app/app.js app/styles.css app/sw.js CLAUDE.md
git commit -m "Aujourd'hui remplace Fiches dans la navigation (v18)"
```

---

### Tâche 5 : vérification complète à l'écran

**Fichiers :** aucun, sauf des corrections si une vérification échoue (dans ce cas, un commit « Aujourd'hui : corrections après vérification »).

- [ ] **Étape 1 : vérifier les cinq points à surveiller**, en Playwright avec un contexte `serviceWorkers: 'block'` et l'horloge par `page.clock.install()` :
  1. Horloge à 18 h 30 : aucun bouton `.slot` dans `.today-plan`, la ligne affiche « Journée terminée. ».
  2. Ouvrir une fiche, cocher une prestation, toucher « Aujourd'hui », rouvrir la fiche : la prestation est toujours cochée.
  3. Créneau de 15 h, taper « Nina », choisir « Autre personne », enregistrer : « Nina » apparaît dans la colonne « Client », et le bloc de 15 h existe et a le focus (`document.activeElement.matches('.appt-block')`).
  4. Dans l'agenda, rendez-vous, « Déplacer », puis « Aujourd'hui » et toucher un créneau : la fenêtre « Nouveau rendez-vous » s'ouvre, et le rendez-vous n'a pas bougé.
  5. Deux rendez-vous qui se chevauchent à 14 h : deux blocs côte à côte, chacun ouvrant sa propre fiche.
- [ ] **Étape 2 : tailles d'écran.**
  - En 800×1280 : planning lisible, colonne « Client » à gauche (280 px).
  - En 1280×440 (clavier ouvert), recherche dans la colonne : rien ne masque le champ.
  - Dimanche 15 novembre 2026 : message « Salon fermé aujourd’hui ».
  - Captures dans `.playwright-mcp/`.
- [ ] **Étape 3 : agenda.** Refaire la comparaison de la tâche 2 : l'agenda est identique.
- [ ] **Étape 4 :** pas de push sur `main` sans l'accord de l'utilisateur, car chaque push arrive sur la tablette du coiffeur.
