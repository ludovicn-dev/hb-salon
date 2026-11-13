# Agenda : balayage des semaines — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Changer de semaine dans l'Agenda d'un balayage horizontal, la nouvelle semaine entrant par un court glissement (flèches comprises).

**Architecture :** Une fonction pure `swipeStep(dx, dy)` dans `agenda-core.js` (testée sous Node) décide si un geste vaut −1, 0 ou +1 semaine. `app.js` écoute les pointeurs sur la grille (`touch-action: pan-y` laisse le défilement vertical au navigateur), et `showWeek` pose un drapeau de sens que `render()` transforme une seule fois en classe d'animation sur `.week`.

**Tech Stack :** JavaScript sans build, CSS (jetons de `styles.css`), `node --test`, Playwright (MCP).

**Spec :** [docs/superpowers/specs/2026-11-13-agenda-balayage-design.md](../specs/2026-11-13-agenda-balayage-design.md)

## Global Constraints
- Textes et commentaires en français ; aucune valeur d'animation en dur : durées et courbes en variables CSS (`--ease-out`, nouveau jeton `--t-week`).
- La mise en page ne bouge pas : seul `.week` glisse ; aucun défilement horizontal de la page pendant l'animation.
- `prefers-reduced-motion: reduce` : pas de glissement du tout.
- Mise en ligne : `node --test "tests/*.test.js"`, essai Playwright (1280×800 et 800×1280, contexte isolé `serviceWorkers: 'block'`), `CACHE` +1 dans `sw.js` (v32 → v33), carte des gestes régénérée (`python -I -X utf8 tools/carte_gestes.py`), push sur `main`.

## Review Focus
1. Défilement vertical des heures un peu en biais : la semaine ne change pas (test `swipeStep` ; essai Playwright, tâche 2).
2. Balayage qui démarre ou finit sur un créneau / un rendez-vous : aucune fenêtre ne s'ouvre (essai Playwright, tâche 2).
3. Re-rendu après le changement (synchro, minuteur, saisie) : le glissement ne rejoue pas (essai Playwright, tâche 2).
4. Message de l'agenda : une simple confirmation disparaît, un « Rétablir » survit, comme avec les flèches (essai Playwright, tâche 2).
5. Déplacement d'un rendez-vous en cours (`S.moving`) : le balayage change de semaine et le mode « déplacer » reste actif (essai Playwright, tâche 2).

---

### Task 1 : décision du geste (`swipeStep`)

**Files :**
- Modify : `app/agenda-core.js` (nouvelle fonction exportée, à la suite de `defaultWeek`)
- Test : `tests/agenda-core.test.js`

**Interfaces :**
- Produces : `export const SWIPE_MIN = 60` (px) et `export function swipeStep(dx, dy): -1 | 0 | 1` — `dx`, `dy` = fin moins début du geste. Retourne `1` (semaine suivante) pour un balayage vers la gauche (`dx <= -SWIPE_MIN`), `-1` pour un balayage vers la droite (`dx >= SWIPE_MIN`), `0` sinon ; `0` aussi si le geste n'est pas nettement horizontal (`Math.abs(dx) < 1.5 * Math.abs(dy)`).

- [ ] **Step 1 : tests qui échouent** (ajouter `swipeStep`, `SWIPE_MIN` à l'import)

```js
test('swipeStep : vers la gauche = semaine suivante, vers la droite = précédente', () => {
  assert.equal(swipeStep(-80, 5), 1);
  assert.equal(swipeStep(80, -5), -1);
  assert.equal(swipeStep(-SWIPE_MIN, 0), 1);
});
test('swipeStep : trop court ou pas assez horizontal = rien', () => {
  assert.equal(swipeStep(-59, 0), 0);
  assert.equal(swipeStep(0, 0), 0);
  assert.equal(swipeStep(-70, 60), 0); // défilement en biais
  assert.equal(swipeStep(30, 200), 0); // défilement vertical
  assert.equal(swipeStep(-90, 60), 1); // 90 ≥ 1,5 × 60
});
```

- [ ] **Step 2 :** `node --test "tests/*.test.js"` → échec (`swipeStep` n'est pas exporté).
- [ ] **Step 3 :** écrire `SWIPE_MIN` et `swipeStep` dans `app/agenda-core.js`, avec un commentaire d'une ligne.
- [ ] **Step 4 :** `node --test "tests/*.test.js"` → tout passe.
- [ ] **Step 5 :** commit `Agenda : décision du balayage (swipeStep)`.

### Task 2 : geste, glissement et mise en ligne

**Files :**
- Modify : `app/app.js` — `showWeek` (L2094), `render` (L405-430), gestionnaire de clic (L2902-2914), nouveaux écouteurs de pointeur à côté de celui de L2923
- Modify : `app/styles.css` — jeton `--t-week` dans le bloc `:root` des durées (L66-72), règles près de `.week` (L996-999)
- Modify : `app/sw.js` (`CACHE` → `hb-salon-v33`), `docs/carte-des-gestes.md` (régénérée), `CLAUDE.md` (une ligne)

**Interfaces :**
- Consumes : `core.swipeStep(dx, dy)` (tâche 1).
- Produces : `S.weekSlide: 'next' | 'prev' | null` ; classes `.week.slide-next` / `.week.slide-prev`.

- [ ] **Step 1 : glissement (CSS).** Jeton `--t-week: 260ms; /* glissement d'une semaine à l'autre */`. `.week.slide-next` entre depuis la droite (`translateX(32px)`, opacité 0 → 1), `.week.slide-prev` depuis la gauche (`-32px`), courbe `--ease-out`. Sous `prefers-reduced-motion: reduce` : `animation: none`. `touch-action: pan-y` sur `.week`. Empêcher le débordement horizontal pendant l'animation (`overflow-x: clip` sur `.agenda`).
- [ ] **Step 2 : sens du glissement.** `showWeek(monday, focus)` pose `S.weekSlide = monday > S.week ? 'next' : monday < S.week ? 'prev' : null` avant de changer `S.week`. Dans `render()`, après `app.innerHTML = …` : si `S.weekSlide`, ajouter `slide-${S.weekSlide}` à `app.querySelector('.week')` puis remettre `S.weekSlide = null` (une seule fois, comme `.overlay.enter`). `show-appt` (L2643) ne passe pas par `showWeek` : pas de glissement, voulu.
- [ ] **Step 3 : écoute du geste.** Sur `app`, `pointerdown` : retenir `{ x, y, id }` seulement si `S.view === 'coiffeur' && S.space === 'agenda' && !S.modal` et `e.target.closest('.week')`. `pointercancel` (le navigateur a pris le défilement vertical) : oublier le geste. `pointerup` du même `pointerId` : `step = core.swipeStep(dx, dy)` ; si `step` ≠ 0, retenir `swipedAt = Date.now()`, appliquer au message de l'agenda la même règle que les flèches (`if (S.note && !S.note.undo) S.note = null`), puis `showWeek(addDays(S.week, 7 * step))`. Accepter tous les types de pointeur (souris comprise : utile aux essais sur PC).
- [ ] **Step 4 : pas d'appui fantôme.** En tête du gestionnaire `click` de `app` : ignorer le clic si `Date.now() - swipedAt < 400` (le créneau sous le doigt ne s'ouvre pas).
- [ ] **Step 5 : essai Playwright** (`npx http-server -p 8080 -c-1` dans `app/`, contexte isolé, 1280×800 puis 800×1280). Glisser à la souris (`page.mouse.down/move/up`, plusieurs pas) sur la grille et vérifier :
  - −120 px horizontaux → titre de la semaine suivante, `.week` porte `slide-next` ; +120 px → semaine précédente, `slide-prev` ;
  - 30 px horizontaux / 200 px verticaux → même semaine ;
  - geste parti d'un créneau libre et fini sur un autre → aucune fenêtre (`.overlay` absent) ;
  - après un `render()` provoqué ensuite (ex. ouvrir puis fermer une fenêtre), `.week` n'a plus de classe `slide-*` ;
  - flèches ‹ › et « Cette semaine » : même classe de glissement, dans le bon sens ;
  - après « Annuler ce rendez-vous », balayer : « Rétablir » toujours là ; mode « déplacer » : toujours actif après balayage ;
  - `getComputedStyle(.week).touchAction === 'pan-y'` ; avec `page.emulateMedia({ reducedMotion: 'reduce' })`, `animationName === 'none'` ;
  - pas de défilement horizontal de la page (`document.documentElement.scrollWidth <= innerWidth`).
- [ ] **Step 6 : mise en ligne locale.** `node --test "tests/*.test.js"` → tout passe ; `CACHE = 'hb-salon-v33'` ; `python -I -X utf8 tools/carte_gestes.py` (les nouveaux écouteurs apparaissent dans « Écouteurs du module ») ; dans `CLAUDE.md`, à la ligne de l'espace Agenda, ajouter que la semaine change aussi d'un balayage (`swipeStep`, `S.weekSlide`).
- [ ] **Step 7 :** commit `Agenda : changer de semaine d'un balayage, avec glissement (v33)`. Le push sur `main` (arrive chez le coiffeur) seulement après accord de Ludo.
