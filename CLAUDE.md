# H&B Salon — appli fiche client

Répondre en français. Le besoin et les règles métier sont dans [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md) : s'y référer, ne pas les rediscuter.
Salon en Nouvelle-Calédonie : téléphones à 6 chiffres, affichés `98.62.13` (`fmtPhone`, `+687` reconnu, métropole en `06 12 34 56 78`).

## Technique
- PWA en JavaScript simple, sans framework ni étape de build : tout est dans [app/](app/).
  - `app.js` : écrans et logique (rendu par chaînes HTML + actions `data-action`). Tout l'état est dans l'objet `S`.
    - `render()` garde le défilement et le focus ; `render({ focus: '<sélecteur>' })` pour viser un élément.
    - Brouillons de visite par client dans `S.drafts` (mémoire seulement) ; `parkDraft()` avant de changer de client ou de passer la tablette.
    - Bandeaux du coiffeur : `addNotice()` / `dropNotices()` ; ceux liés à une visite (`visitId`) disparaissent quand elle est validée ou effacée.
    - Annonces lecteur d'écran : `announce()` (zone `#announce`) et `toast()` (zone `#toast`, hors de `#app`).
    - Fenêtres : `S.modal`, redessinées avec l'écran ; le fondu d'arrivée ne joue que quand le type de fenêtre change (`app.dataset.modal`). `data-autofocus` ne joue aussi qu'à l'ouverture : un choix touché garde le focus, sinon le clavier Android revient masquer la fenêtre.
    - Réglages (roue dentée de la barre du haut) : fenêtre `settings`, avec « Changer le code ».
    - PIN oublié : code de déblocage à 8 chiffres connu du seul installateur. app.js étant public, seule son empreinte PBKDF2 y figure (`RECOVERY_SALT`, `RECOVERY_ITER`, `RECOVERY_HASH`) ; ne jamais revenir à un simple SHA-256.
  - `agenda-core.js` : calculs de l'agenda sans écran ni stockage (semaines, créneaux, chevauchements, durées, « dernière couleur »), testés par `node --test "tests/*.test.js"`.
    - Agenda dans `app.js` : `S.space` (« Fiches » / « Agenda »), `S.week`, `S.weekAppts`, `S.todayAppts`, `S.moving` ; recharger avec `refreshAppts()` après toute écriture de rendez-vous.
    - Finir après 18 h n'est qu'un avertissement (`slotIssue`, raison `close`) : le coiffeur le force par « Enregistrer quand même » ; un déplacement est permis et la note le rappelle. Dans la grille, le bloc est coupé à 18 h (bas en pointillés).
    - Retours de l'agenda sous le titre de la semaine (`agendaNote()`, `S.note`, effacé à l'action suivante), jamais en toast ; « Remettre comme avant » / « Rétablir » (`undoAgenda`). Un rendez-vous rétabli reprend un nouvel identifiant : nos effacements reviennent à la synchro et effaceraient l'ancien.
  - `db.js` : stockage IndexedDB (clients, visites, photos avec miniature `thumb`, rendez-vous `appointments`, réglages dont `pinHash` et `pinLock`). Toute écriture locale pose `dirty: 1` ; les effacements vont dans le magasin `deletions`. Changer la structure = nouvelle `DB_VERSION` avec migration dans `onupgradeneeded`.
  - `sync.js` : sauvegarde Supabase en REST direct (pas de bibliothèque). Envoie `dirty` + effacements, puis récupère les nouveautés (`synced_at` posé par le serveur). Les clients sans `consentAt` ne partent jamais en ligne, ni leurs rendez-vous ; un rendez-vous `localOnly` (gardé après un refus RGPD ou la suppression d'une fiche par le coiffeur, via `detachAppointments` appelé avant `deleteClient` ; rattaché à la fiche créée depuis lui par `linkAppt`) non plus ; il est purgé au démarrage une fois son jour passé (`purgeLocalOnly`). Connexion dans la fenêtre « Sauvegarde ».
  - `sw.js` : hors-ligne. **Incrémenter `CACHE` à chaque mise en ligne**, sinon la tablette garde l'ancienne version.
  - `logo.svg` : vrai logo redessiné en vectoriel (dégradé doux d'or rose) par `tools/logo-vectoriel.py` depuis `tools/logo-origine.webp` (H et côté gauche du B en géométrie exacte, « SALON » en Cormorant). Icônes de `icons/` : rendre `logo.svg` en PNG à fond transparent (navigateur), puis `python -I tools/icones.py <png> app/icons`.
  - `fonts/` : polices variables auto-hébergées (un fichier par famille et sous-ensemble ; pas de Google Fonts, pour le hors-ligne).
- Supabase : tables et règles d'accès dans [supabase/schema.sql](supabase/schema.sql) (à coller dans le SQL Editor) ; une base créée avant l'agenda reçoit [supabase/2026-11-agenda.sql](supabase/2026-11-agenda.sql), à coller **avant** de mettre en ligne la version avec l'agenda. Un compte = les données d'un salon ; inscriptions fermées, comptes créés à la main dans le tableau de bord. Plan gratuit : pas de sauvegarde automatique de la base, pause après 7 jours sans activité.
- En ligne : GitHub Pages, publié par `.github/workflows/pages.yml` à chaque push sur `main`. Chaque push arrive directement sur la tablette du coiffeur : tester avant.
- Textes de l'interface en français, avec espace fine insécable (U+202F) avant `? ! :` et insécable (U+00A0) à l'intérieur des « » ; pas d'emoji, icônes SVG en ligne (`ICONS`). Ces caractères font échouer les remplacements exacts tapés à la main : les copier depuis le fichier.

## Lancer et tester
- `npx http-server -p 8080 -c-1` dans `app/`, puis http://localhost:8080.
- Calculs de l'agenda : `node --test "tests/*.test.js"` (à la racine).
- Pas de tablette sous la main : tester avec Playwright en 1280×800 (paysage) et 800×1280 (portrait), dans un contexte isolé (`browser().newContext()`) pour ne pas mélanger les données IndexedDB ; `page.clock.install()` pour les minuteurs (2 min client, 10 min coiffeur).
  - Playwright du MCP : fichiers lus ou écrits seulement dans le projet (captures dans `.playwright-mcp/`, ignoré par git) ; pas de `require` dans le code exécuté. Premier lancement : l'appli ouvre directement « Nouveau code », sans accueil.
  - Clavier Android ouvert : simuler en réduisant la hauteur (~440 px en paysage) ; la page déclare `interactive-widget=resizes-content`.
- Synchro : tester avec un compte Supabase de test créé pour l'occasion (puis vidé et supprimé), jamais avec celui du coiffeur ; deux contextes isolés = deux tablettes.
- Révisions design : `/impeccable critique` (rapports dans [.impeccable/critique/](.impeccable/critique/)) ou `/ui-ux-pro-max`.

## Design « Élégance »
Bleu nuit `#161D33`, or rose `#E3B59C`, Cormorant Garamond (titres) + Manrope (texte). Couleurs et durées d'animation (`--t-press`, `--t-dialog`, `--t-flash`) en variables CSS dans `styles.css`, aucune en dur.
- Retour au toucher sur tout élément tactile (`:active` + transition courte), sans changer la mise en page.
- Un seul bouton or plein par écran (l'action principale).
- Le bordeaux et le triangle d'alerte sont réservés à l'allergie ; erreurs et actions destructrices en corail `--error` ; « à valider » en or avec horloge ; informations neutres.
- Bords des champs et boutons à 3:1 minimum (`--control-line`, `--control-line-2`, `--line-2`) ; zones tactiles de 44 px minimum.
- Les accents de Cormorant qui paraissent décalés sont le dessin de la police, pas un bug.

Maquettes : https://claude.ai/artifact/4HnJfspaKf4fw7f9TrdCSM ; maquettes de travail (agenda, logo) dans `.superpowers/brainstorm/`, ignoré par git.
