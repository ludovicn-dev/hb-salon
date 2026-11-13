# Carte des gestes

Ce que déclenche chaque bouton de l'appli : le `data-action` affiché à l'écran, l'action de l'objet `actions` qui le traite, puis les fonctions appelées en cascade. Les tableaux sont tirés du code (`app/app.js`) ; les parcours, en bas, sont rédigés à la main.

Régénérer les tableaux après un changement d'`app.js`, à la racine : `python -I -X utf8 tools/carte_gestes.py` (il faut `tree_sitter` et `tree_sitter_javascript`). Les numéros de ligne des parcours, eux, datent de la v31 : à recontrôler quand un parcours change.

<!-- début du bloc généré par tools/carte_gestes.py -->

69 actions, 69 gestes distincts affichés à l'écran, 12 écouteurs.

## Actions (`data-action`)

| Geste | Affiché par | Action (ligne) | Appelle | Puis (utilitaires d'affichage omis) |
|---|---|---|---|---|
| `unlock` | viewWelcome | L2481 | askPin, go | — |
| `pin-key` | viewPin | L2482 | pinDigit | pinDigit → hashPin, hashRecovery, startLockTicker, lockMsg |
| `pin-back` | viewPin | L2483 | render | — |
| `pin-cancel` | viewPin | L2488 | render | — |
| `pin-forgot` | viewPin | L2495 | render | — |
| `lock` | viewCoiffeur | L2499 | parkDraft, go | parkDraft → draftHasContent, isAuto |
| `change-pin` | viewModal | L2508 | go | — |
| `backup` | viewCoiffeur | L2512 | tabletOnly, openModal | — |
| `settings` | viewCoiffeur | L2516 | openModal | — |
| `set-theme` | viewThemePicker | L2518 | applyTheme, render, announce | — |
| `toggle-pw` | viewModal | L2524 | icon | — |
| `sync-now` | viewModal | L2531 | toast | — |
| `sign-out` | viewModal | L2536 | hideToast, render | — |
| `cancel-signout` | viewModal | L2541 | render | — |
| `confirm-signout` | viewModal | L2545 | render, toast | — |
| `space` | viewClientDetail, viewCoiffeur, viewTodayPlan | L2556 | loadWeek, parkDraft, render, scrollPlanToNow | parkDraft → draftHasContent, isAuto |
| `slot` | viewDayColumn | L2568 | moveTo, selectorOf, openModal, newApptModal | moveTo → slotIssue, refreshAppts, agendaNote; newApptModal → prefill |
| `appt` | (module), viewDayColumn | L2573 | selectorOf, render, announce, findAppt, openApptModal | — |
| `appt-who` | viewApptWho | L2586 | apptFirstName, prefill, render | prefill → apptServices, freeOf |
| `appt-other` | viewApptWho | L2599 | prefill, render | prefill → apptServices, freeOf |
| `appt-service` | viewApptDialog | L2611 | prefill, render, announceSpan | prefill → apptServices, freeOf; announceSpan → findAppt, apptSpan |
| `appt-time` | viewApptDialog | L2622 | atMinutes, render, announceSpan, fmtMin | announceSpan → findAppt, apptSpan |
| `appt-dur` | viewApptDur | L2633 | render, announceSpan | announceSpan → findAppt, apptSpan |
| `appt-move` | viewApptDialog | L2643 | findAppt, apptName, fmtDayTitle, fmtTime, render, announce | — |
| `move-cancel` | (module), viewAgenda | L2653 | render | — |
| `undo` | cancelAppt, moveTo, viewAgenda, viewTodayPlan | L2657 | undoAgenda | undoAgenda → cancelAppt, slotIssue, agendaNote, refreshAppts |
| `show-appt` | nextApptLine, viewTodayPlan | L2658 | loadWeek, render | — |
| `appt-open` | viewApptDialog | L2668 | openApptClient, findAppt | openApptClient → apptClient, selectClient |
| `today-appt` | viewDayColumn | L2669 | openApptClient, findAppt | openApptClient → apptClient, selectClient |
| `today-edit` | viewDayColumn | L2670 | findAppt, openApptModal | — |
| `appt-cancel` | viewApptDialog | L2675 | cancelAppt, findAppt | cancelAppt → refreshAppts, agendaNote |
| `week-prev` | viewAgenda | L2676 | showWeek, addDays | showWeek → loadWeek |
| `week-next` | (module), viewAgenda | L2677 | showWeek, addDays | showWeek → loadWeek |
| `week-now` | viewAgenda | L2678 | showWeek, scrollPlanToNow | showWeek → loadWeek |
| `export-clients` | viewExport | L2682 | exportClients | exportClients → loadClients, consentCsv, dateFr, download, stamp, csv |
| `export-visits` | viewExport | L2683 | exportVisits | exportVisits → loadClients, dateFr, consentCsv, download, stamp, csv |
| `export-appts` | viewExport | L2684 | exportAppts | exportAppts → loadClients, download, stamp, csv |
| `select` | viewResults | L2685 | selectClient, render | selectClient → parkDraft, dropNotices, restoreDraft, emptyDraft, loadHistory, precheck |
| `clear-search` | viewCoiffeur | L2690 | viewResults | viewResults → searchClients, hasLetters, capName, hasName, ago |
| `new-client` | viewCoiffeur | L2697 | openModal | — |
| `new-client-search` | viewResults | L2699 | hasLetters, openModal, capName, fmtPhone | — |
| `delete-client` | (module), viewModal | L2708 | openModal, hasName, fullName, draftHasContent, isAuto | — |
| `keep-client` | viewModal | L2728 | render | — |
| `confirm-delete-client` | viewModal | L2736 | dropDraft, dropNotices, emptyDraft, loadClients, refreshAppts, hasName, fullName, fmtDayShort, fmtPhone, addNotice, keptText, render | loadClients → isToday; refreshAppts → loadWeek, loadToday, loadNextAppt |
| `edit-client` | viewClientDetail | L2762 | openModal, fmtPhone | — |
| `close-modal` | viewApptDialog, viewModal | L2763 | closeModal | — |
| `tab` | viewClientDetail | L2764 | render | — |
| `toggle-service` | viewDraft | L2768 | render | — |
| `reuse-services` | (module), viewDraft | L2782 | render | — |
| `dismiss-notice` | (module), viewNotices | L2787 | render | — |
| `rehand-notice` | viewNotices | L2791 | selectClient, dropNotices, handTo, render | selectClient → parkDraft, dropNotices, restoreDraft, emptyDraft, loadHistory, precheck; handTo → parkDraft, nextVisitOf |
| `back-to-consent` | viewModal | L2799 | render | — |
| `open-dup` | (module), viewDuplicate | L2804 | linkAppt, selectClient, render | linkAppt → refreshAppts; selectClient → parkDraft, dropNotices, restoreDraft, emptyDraft, loadHistory, precheck |
| `reuse-formula` | viewDraft | L2812 | render, toast, fmtDayShort | — |
| `add-photo` | (module), viewDraft | L2817 | — | — |
| `remove-photo` | viewDraft | L2818 | render | — |
| `zoom` | hydratePhotos | L2824 | selectorOf, viewLightbox | — |
| `close-photo` | viewLightbox | L2835 | — | — |
| `handover` | viewDraft | L2844 | checkServices, handOver | handOver → dropDraft, emptyDraft, handTo |
| `rehand` | viewDraft, viewHistory | L2853 | endEdit, handTo | endEdit → dropDraft, emptyDraft; handTo → parkDraft, nextVisitOf |
| `edit-visit` | viewDraft, viewHistory | L2858 | dropDraft, render | — |
| `cancel-edit` | (module), viewDraft | L2877 | endEdit, render | endEdit → dropDraft, emptyDraft |
| `save-edit` | viewDraft | L2882 | checkServices, saveEdit | saveEdit → endEdit, loadHistory |
| `delete-visit` | viewHistory | L2891 | openModal | — |
| `confirm-delete` | viewModal | L2892 | dropNotices, endEdit, loadHistory, loadClients, render, toast | endEdit → dropDraft, emptyDraft; loadHistory → loadNextAppt; loadClients → isToday |
| `confirm-no-consent` | viewModal | L2904 | dropDraft, dropNotices, hasName, fullName, fmtDayShort, fmtPhone, addNotice, keptText, finishCheckout | — |
| `client-to-coiffeur` | viewClient | L2916 | askPin, go | — |
| `stay` | warnIdle | L2917 | — | — |
| `welcome` | viewThanks | L2918 | go | — |

## Écouteurs du module

| Ligne | Cible | Évènement | Appelle |
|---|---|---|---|
| L2922 | `app` | `click` | — |
| L2944 | `app` | `pointerdown` | — |
| L2952 | `app` | `pointerdown` | — |
| L2960 | `app` | `pointercancel` | — |
| L2963 | `app` | `pointerup` | showWeek, addDays |
| L2975 | `app` | `focusout` | hasLetters, fmtPhone, bindCheckout, checkFieldOnLeave |
| L3010 | `app` | `input` | viewResults, markWho, phoneMatches, norm, prefill, viewApptDur, viewApptSpan, viewApptWho, announceMatches, saveDraftsSoon, bindCheckout |
| L3053 | `app` | `change` | bindCheckout, render, readPhoto, announce, toast |
| L3073 | `app` | `submit` | saveApptForm, validateContact, showErrors, findDuplicates, viewDuplicate, capName, loadClients, linkAppt, selectClient, render, toast, loginError, openModal, dropNotices, finishCheckout |
| L3195 | `document` | `pointerdown`, `keydown`, `input` (boucle) | bumpIdle |
| L3215 | `document` | `keydown` | closeModal, go, trapTab, render, pinDigit |
| L3248 | `window` | `popstate` | closeModal |

## Contrôles

- Gestes affichés sans action correspondante : aucun
- Actions jamais affichées par un `data-action` littéral : aucune

<!-- fin du bloc généré -->

## Parcours : un créneau touché jusqu'au rendez-vous en ligne

1. **Le créneau** : `viewDayColumn` dessine un `<button class="slot" data-action="slot" data-start="…">` (app.js:1068), dans l'agenda comme dans « Aujourd'hui ».
2. **L'appui** : l'écouteur `click` (app.js:2869) donne le focus au bouton, garde le message sous le titre s'il offre « Rétablir » (`KEEP_NOTE`), puis appelle `actions.slot` (app.js:2517).
3. **Déplacement en cours ?** Si oui, `moveTo` vérifie le créneau (`slotIssue`) et enregistre ; sinon, `openModal(newApptModal(start))` (app.js:582) ouvre « Nouveau rendez-vous », durée proposée par `prefill`.
4. **La saisie** : l'écouteur `input` (app.js:2929) propose les fiches du numéro (`phoneMatches`, `viewApptWho`), recalcule la durée et la ligne « Fin à… » (`prefill`, `viewApptSpan`) ; les boutons de la fenêtre passent par `appt-who`, `appt-service`, `appt-time`, `appt-dur`.
5. **« Enregistrer »** : l'écouteur `submit` (app.js:2996) → `saveApptForm` (app.js:782) → `saveAppt` (app.js:793) :
   - qui : fiche touchée, même prénom au numéro, numéro incomplet ou ambigu (erreur sous les champs, `#appt-who-err`) ;
   - quand : `slotIssue` (app.js:838) refuse un chevauchement, signale la fin après 18 h (« Enregistrer quand même ») ;
   - numéro inconnu : nouvelle fiche `db.saveClient` (app.js:869) ; sans numéro, rendez-vous au prénom seul (`clientId: null`) ;
   - `db.saveAppointment` (app.js:872), puis `refreshAppts`, message sous le titre avec « Annuler ce rendez-vous » (app.js:888), fenêtre refermée, bloc ramené en vue (`revealFlash`) et annoncé.
6. **La base locale** : `saveAppointment` (db.js:256) pose `dirty: 1`, efface `syncedAt`, et prévient les abonnés (`changed()`).
7. **L'envoi** : l'abonné de `sync.start` (sync.js:461) recompte ce qui attend et programme un tour 5 s plus tard (`schedule`, `DEBOUNCE_MS`) ; aussi toutes les 5 min et au retour du réseau. `push` (sync.js:265) envoie d'abord les effacements, puis les rendez-vous en attente (sync.js:318), filtrés par `apptOk` : jamais un rendez-vous `localOnly` ni celui d'un client sans accord RGPD, donc jamais un rendez-vous au prénom seul. Chaque ligne acceptée est marquée envoyée (`markSynced`).

## Parcours : passer la tablette, validation par le client, envoi en ligne

1. **« Passer la tablette au client »** (`data-action="handover"`, rendu par `viewDraft`) → `actions.handover` (app.js:2791) : refusé sans prestation cochée (`checkServices`, app.js:2135), une seule fois à la fois (`S.saving`).
2. **La visite est écrite tout de suite** : `handOver` (app.js:2403) enregistre la visite `status: 'pending'` avec formule et note, puis ses photos (`db.addPhoto`) ; si une photo échoue, la visite est retirée. Le brouillon est jeté.
3. **La tablette change de mains** : `handTo` (app.js:2153) met de côté une autre visite en cours, retient la visite (`S.handedVisit`) et le prochain rendez-vous (à partir de demain), pré-remplit les coordonnées (`S.checkout`, case cochée si l'accord existe déjà), puis `go('client')`.
4. **Écran client** (`viewClient`, app.js:1583) : chaque frappe met à jour `S.checkout` (écouteur `input` → `bindCheckout`) ; en quittant un champ, téléphone et e-mail sont vérifiés (écouteur `focusout` → `checkFieldOnLeave`). Inactivité : avertissement après 1 min 40 s, retour à « Bienvenue » 20 s plus tard (`bumpIdle`, `warnIdle`, app.js:319-365) ; la visite reste « à valider ».
5. **« Valider »** : écouteur `submit`, formulaire `checkout` (app.js:3067).
   - **Case cochée** : coordonnées vérifiées, fiche enregistrée avec majuscules (`capName`) et `consentAt` (gardé s'il existait), visite passée en `done` avec `validatedAt`, bandeau du coiffeur retiré, puis `finishCheckout` (app.js:3098).
   - **Case vide** : fenêtre `no-consent` (app.js:3074) avec le nombre de visites et de rendez-vous à venir. « Revenir à la case » (`back-to-consent`, app.js:2746) ou « Ne pas conserver » (`confirm-no-consent`, app.js:2851) : rendez-vous à venir détachés et gardés sur la tablette (`detachAppointments`), fiche, visites et photos effacées avec trace d'effacement (`deleteClient`, db.js:137), bandeau pour le coiffeur, puis `finishCheckout`.
6. **« Merci »** : `finishCheckout` oublie la visite tendue et la fiche ouverte, affiche « Merci » (prochain rendez-vous compris) ; retour seul à « Bienvenue » après 10 s (app.js:306).
7. **Retour du coiffeur** : « Coiffeur » sur l'écran client (`client-to-coiffeur`) ou « Espace coiffeur » sur Bienvenue → code (`askPin`) → `enterCoiffeur` (app.js:2076). Si la visite n'a pas été validée : bandeau « X n'a pas validé sa visite » avec « Repasser à X » (`rehand-notice`) ; si elle l'a été : ligne « X a validé sa fiche à … » quelques secondes.
8. **En ligne** (chaque écriture a posé `dirty: 1` et prévenu `sync.js`, tour 5 s plus tard) : `push` (sync.js:265) envoie d'abord les effacements (fiche refusée : client, visites, photos, rendez-vous déjà envoyés), puis les fiches avec accord (sync.js:303), leurs visites (sync.js:304), leurs photos (fichier + miniature dans le stockage, puis la ligne, sync.js:306-316), enfin les rendez-vous (sync.js:318). Une visite « à valider » d'une fiche sans accord ne part pas ; elle part dès que le client accepte.
