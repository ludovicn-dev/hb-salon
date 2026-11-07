# H&B Salon — appli fiche client

Répondre en français. Besoin et règles métier : [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md), à suivre sans les rediscuter.
Salon en Nouvelle-Calédonie : téléphones à 6 chiffres affichés `98.62.13` (`fmtPhone` ; `+687` reconnu, métropole en `06 12 34 56 78`).

## Architecture
PWA en JavaScript simple, sans framework ni étape de build, tout dans [app/](app/) :
- `app.js` : écrans et logique, rendu par chaînes HTML et actions `data-action` ; tout l'état est dans `S`.
  - `render()` garde le défilement et le focus (`render({ focus: '<sélecteur>' })` pour viser un élément). Fenêtres dans `S.modal` : le fondu et `data-autofocus` ne jouent qu'à l'ouverture, sinon le clavier Android revient masquer la fenêtre.
  - Brouillons de visite par client dans `S.drafts` : `parkDraft()` avant de changer de client ou de passer la tablette. Recopiés (photos comprises) dans le réglage local `drafts` (`saveDraftsSoon`), retrouvés si Android ferme l'appli, oubliés le lendemain ; un client supprimé sort aussi de `S.savedDrafts`.
  - Messages : bandeaux du coiffeur (`addNotice` / `dropNotices` ; ceux d'une visite disparaissent quand elle est validée ou effacée), lecteur d'écran (`announce`), `toast`. L'agenda répond sous le titre de la semaine (`agendaNote`), jamais en toast, avec « Remettre comme avant » / « Rétablir » (`undoAgenda`).
  - Après toute écriture de rendez-vous : `refreshAppts()`. Un rendez-vous rétabli reprend un nouvel identifiant (l'effacement de l'ancien est peut-être déjà parti en ligne).
  - Code oublié : code de déblocage à 8 chiffres connu du seul installateur. app.js étant public, seule son empreinte PBKDF2 y figure ; ne jamais revenir à un simple SHA-256.
- `agenda-core.js` : calculs de l'agenda, sans écran ni stockage, testés dans [tests/](tests/).
- `db.js` : IndexedDB. Toute écriture pose `dirty: 1`, les effacements vont dans `deletions`. Changer la structure = nouvelle `DB_VERSION` avec migration dans `onupgradeneeded`.
- `sync.js` : sauvegarde Supabase en REST direct. Ne partent jamais en ligne : un client sans `consentAt`, ses rendez-vous, un rendez-vous `localOnly` (gardé après un refus RGPD ou une suppression de fiche : `detachAppointments` avant `deleteClient` ; purgé une fois son jour passé).
- `sw.js` : hors-ligne. **Incrémenter `CACHE` à chaque mise en ligne**, sinon la tablette garde l'ancienne version.
- `logo.svg` : redessiné par `tools/logo-vectoriel.py` ; icônes : rendre le logo en PNG transparent, puis `python -I tools/icones.py <png> app/icons`. `fonts/` : polices auto-hébergées (pas de Google Fonts, pour le hors-ligne).

## En ligne
- GitHub Pages, publié par `.github/workflows/pages.yml` à chaque push sur `main` : chaque push arrive sur la tablette du coiffeur, tester avant.
- Supabase : tables et règles d'accès dans [supabase/schema.sql](supabase/schema.sql), à coller dans le SQL Editor (`2026-11-agenda.sql` : migration déjà appliquée chez le coiffeur). Un compte = les données d'un salon, créé à la main (inscriptions fermées). Plan gratuit : pas de sauvegarde automatique, pause après 7 jours sans activité.

## Tester
- `npx http-server -p 8080 -c-1` dans `app/` ; calculs de l'agenda : `node --test "tests/*.test.js"` à la racine.
- Pas de tablette sous la main : Playwright en 1280×800 et 800×1280, dans un contexte isolé `browser().newContext({ serviceWorkers: 'block' })` (données à part, et pas d'ancienne version servie par le cache). Minuteurs (2 min client, 10 min coiffeur) : `page.clock.install()`. Clavier Android : réduire la hauteur (~440 px en paysage ; la page déclare `interactive-widget=resizes-content`).
  - Playwright du MCP : fichiers seulement dans le projet (captures dans `.playwright-mcp/`, ignoré par git), pas de `require`. Premier lancement : l'appli ouvre directement « Nouveau code ».
- Synchro : avec un compte Supabase de test créé pour l'occasion puis supprimé, jamais celui du coiffeur ; deux contextes isolés = deux tablettes.
- Revue de design : `/impeccable critique` (rapports dans [.impeccable/critique/](.impeccable/critique/)).

## Design « Élégance »
Bleu nuit `#161D33`, or rose `#E3B59C`, Cormorant Garamond (titres) + Manrope (texte). Couleurs et durées d'animation en variables CSS dans `styles.css`, aucune en dur.
- Retour au toucher sur tout élément tactile (`:active`, transition courte), sans changer la mise en page.
- Un seul bouton or plein par écran (l'action principale). L'or marque aussi ce qui est choisi ; le focus clavier est ivoire (`--focus`).
- Bordeaux et triangle d'alerte réservés à l'allergie ; erreurs et actions destructrices en corail `--error` ; « à valider » en or avec horloge ; informations neutres.
- Bords des champs et boutons à 3:1 minimum (`--control-line`, `--control-line-2`, `--line-2`) ; zones tactiles de 44 px minimum.
- Textes en français : espace fine insécable (U+202F) avant `? ! :`, insécable (U+00A0) à l'intérieur des « » ; pas d'emoji, icônes SVG en ligne (`ICONS`). Ces caractères font échouer les remplacements exacts tapés à la main : les copier depuis le fichier.
- Voulus malgré le détecteur impeccable : bordure or à gauche des rendez-vous de l'agenda, hachures du temps écoulé. Les accents de Cormorant qui paraissent décalés sont le dessin de la police.

Maquettes : https://claude.ai/artifact/4HnJfspaKf4fw7f9TrdCSM ; maquettes de travail (agenda, logo) dans `.superpowers/brainstorm/`, ignoré par git.
