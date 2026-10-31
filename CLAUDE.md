# H&B Salon — appli fiche client

Répondre en français. Le besoin et les règles métier sont dans [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md) : s'y référer, ne pas les rediscuter.

## Technique
- PWA en JavaScript simple, sans framework ni étape de build : tout est dans [app/](app/).
  - `app.js` : écrans et logique (rendu par chaînes HTML + actions `data-action`). Tout l'état est dans l'objet `S`.
    - `render()` garde le défilement et le focus ; `render({ focus: '<sélecteur>' })` pour viser un élément.
    - Brouillons de visite par client dans `S.drafts` (mémoire seulement) ; `parkDraft()` avant de changer de client ou de passer la tablette.
    - Bandeaux du coiffeur : `addNotice()` / `dropNotices()` ; ceux liés à une visite (`visitId`) disparaissent quand elle est validée ou effacée.
    - Annonces lecteur d'écran : `announce()` (zone `#announce`) et `toast()` (zone `#toast`, hors de `#app`).
    - PIN oublié : code de déblocage à 8 chiffres connu du seul installateur ; seule son empreinte est dans `RECOVERY_HASH`.
  - `db.js` : stockage IndexedDB (clients, visites, photos avec miniature `thumb`, réglages dont `pinHash` et `pinLock`).
  - `sw.js` : hors-ligne. **Incrémenter `CACHE` à chaque mise en ligne**, sinon la tablette garde l'ancienne version.
  - `fonts/` : polices variables auto-hébergées (un fichier par famille et sous-ensemble ; pas de Google Fonts, pour le hors-ligne).
- Chaque enregistrement a `syncedAt` : prévu pour la synchro Supabase (étape 2).
- Textes de l'interface en français, avec espaces insécables fines avant `? ! :` ; pas d'emoji, icônes SVG en ligne (`ICONS`).

## Lancer et tester
- `npx http-server -p 8080 -c-1` dans `app/`, puis http://localhost:8080.
- Pas de tablette sous la main : tester avec Playwright en 1280×800 (paysage) et 800×1280 (portrait), dans un contexte isolé (`browser().newContext()`) pour ne pas mélanger les données IndexedDB ; `page.clock.install()` pour les minuteurs (2 min client, 10 min coiffeur).
- Révisions design : `/impeccable critique` ; rapports dans [.impeccable/critique/](.impeccable/critique/).

## Design « Élégance »
Bleu nuit `#161D33`, or rose `#E3B59C`, Cormorant Garamond (titres) + Manrope (texte). Couleurs en variables CSS dans `styles.css`, aucune en dur.
- Un seul bouton or plein par écran (l'action principale).
- Le bordeaux et le triangle d'alerte sont réservés à l'allergie ; erreurs et actions destructrices en corail `--error` ; « à valider » en or avec horloge ; informations neutres.
- Bords des champs et boutons à 3:1 minimum (`--control-line`, `--control-line-2`, `--line-2`) ; zones tactiles de 44 px minimum.
- Les accents de Cormorant qui paraissent décalés sont le dessin de la police, pas un bug.

Maquettes : https://claude.ai/artifact/4HnJfspaKf4fw7f9TrdCSM
