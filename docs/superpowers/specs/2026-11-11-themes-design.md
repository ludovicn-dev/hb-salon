# Thèmes au choix dans les Réglages

## Pourquoi
Le coiffeur veut changer l'ambiance de l'appli selon son envie du moment : couleurs, polices, style. L'utilisateur a validé les maquettes (https://claude.ai/artifact/87WeEggDY13UiHdxKGrE6b, source dans `.superpowers/brainstorm/themes/`, ignorée par git). Il a retenu 10 thèmes en plus de l'actuel :

| Thème | Ton | Famille |
|---|---|---|
| Élégance (actuel, **par défaut**) | sombre | — |
| Élégance jour (préféré) | clair | Élégance jour |
| Barbier (préféré) | sombre | Barbier |
| Ivoire & laiton | clair | Élégance jour |
| Barbier jour | clair | Barbier |
| Bleu porcelaine | clair | Élégance jour |
| Ardoise & cuivre | sombre | Barbier |
| Éditorial | clair | — |
| Lagon | clair | — |
| Art déco | sombre | — |
| Atelier | clair | — |

C'est aussi l'ordre des vignettes dans les Réglages : l'actuel, puis les deux préférés, puis la famille Élégance jour à gauche et la famille Barbier à droite, et enfin les autres.

## Ce qui change
- **Réglages** : une section « Thème » en tête de la fenêtre, avant le code. Elle montre 11 vignettes : un aperçu aux couleurs du thème et son nom. Le thème en place est marqué comme une prestation cochée (bord et anneau de la couleur du thème, coche). Toucher une vignette applique le thème **tout de suite à toute l'appli** : espace coiffeur, Bienvenue, écran client, Merci, code. La fenêtre reste ouverte : on peut en essayer plusieurs de suite, puis fermer.
- **Ce qu'un thème change** : les couleurs ; la police des titres et celle du texte ; la graisse, la casse et l'espacement des titres (les deux thèmes Barbier et Ardoise sont en capitales) ; la taille des trois titres quand la police l'exige ; les arrondis ; le fond de Bienvenue et de Merci (motif, cadre) ; les couleurs du logo ; la couleur de la barre d'Android (`theme-color`) ; `color-scheme`, clair ou sombre.
- **Ce qui ne change pas** : la mise en page, les tailles du texte courant, les zones tactiles, les animations. Les rôles des couleurs restent aussi : l'allergie en rouge avec son triangle, à part de tout le reste ; les erreurs et les actions destructrices en `--error` ; « À valider » dans la couleur du thème avec l'horloge ; un seul bouton plein par écran.
- **Mémoire** : le choix est gardé sur la tablette et retrouvé au lancement. Il s'applique **avant le premier écran**, sans flash de l'ancien thème. Il ne part pas en ligne.
- **Hors-ligne** : les polices de tous les thèmes sont enregistrées dans l'appli et mises en cache à l'installation. On peut donc changer de thème sans connexion.

## Hors sujet
- Pas de mode automatique (clair le jour, sombre le soir) : le coiffeur choisit selon son envie, et le thème reste jusqu'à ce qu'il en change. Décision de l'utilisateur.
- Pas de synchro du thème par Supabase : il n'y a qu'une tablette.
- L'icône de l'écran d'accueil Android et l'écran de démarrage (`background_color` du manifeste) restent en bleu nuit.
- Pas de couleurs choisies librement par le coiffeur.
- Thèmes écartés par l'utilisateur, à ne pas reproposer : Sauge, Rose poudré, Néon, Prune & champagne.

## Approches considérées
1. **Retenue : thèmes décrits en CSS.** Chaque thème est un bloc de variables `[data-theme="…"]` dans un nouveau fichier `app/themes.css`. L'attribut `data-theme` est posé sur `<html>` au lancement par un court script dans `index.html`. Les vignettes de Réglages portent elles-mêmes `data-theme` et se peignent donc seules. Le logo devient un masque coloré par le thème. Un test vérifie les contrastes. Coût : environ 30 variables par thème, à tenir dans un seul fichier.
2. Thèmes décrits en JavaScript : les palettes dans un module, appliquées par `style.setProperty`. Une seule source, pratique pour les tests. Mais le thème n'arrive qu'après le chargement de `app.js` : l'accueil s'afficherait un instant en Élégance, sauf à recopier les palettes dans `index.html`. Les vignettes demandent aussi du code pour se peindre.
3. Écartée : une feuille de style par thème, chargée à la demande. Elle provoque un flash à chaque changement et fait 11 fichiers de plus à gérer pour le hors-ligne.

## Conception

### Jetons de couleur : garder `--accent` pour les repères
`--accent` sert 56 fois dans `styles.css`. Presque toujours, c'est l'or **des repères** : texte, bords, état choisi, icônes, ligne de l'heure, filet des rendez-vous. Sur fond clair, cet or doit être foncé pour rester lisible. Le bouton principal, lui, garde un or clair en fond.
- `--accent` garde son rôle actuel de repère. Dans les thèmes clairs, il prend la valeur foncée (`ink` dans l'annexe). Les quelque 50 règles qui l'utilisent ne changent pas.
- Nouveaux jetons pour les **fonds** dorés : `--accent-fill`, `--accent-fill-hi` (appui) et `--on-accent` (texte posé dessus). Ils servent à `.btn-accent` et à son `:active`, à la case cochée du consentement (`.consent input:checked + .box`) et à `::selection`. Le constructeur cherche d'autres fonds pleins qui seraient passés inaperçus, avec la même règle : un aplat d'or prend `--accent-fill`, un texte, un bord ou un repère prend `--accent`. Dans les thèmes sombres, `--on-accent` vaut `--bg`, comme aujourd'hui, et `--accent-fill` vaut `--accent`. Barbier et Ardoise font exception : l'annexe y donne un repère (`ink`) un peu plus clair que le fond du bouton (`accent`), et on suit l'annexe (choix de Claude après relecture).
- Les jetons définis par thème sont `--bg`, `--panel`, `--panel-2`, `--line`, `--line-2`, `--control-line`, `--control-line-2`, `--text`, `--text-2`, `--muted`, `--placeholder`, `--accent`, `--accent-hi`, `--accent-fill`, `--accent-fill-hi`, `--on-accent`, `--warn-bg` (fond de l'allergie), `--error`, `--scrim` et `color-scheme`. `--control-line-2` et `--accent-hi` n'existent pas dans les maquettes : le constructeur les fixe, et le test les vérifie.
- Les jetons dérivés (`--appt-bg`, `--grid-line`, `--past-hatch`, `--halo`, `--glow`, `--scrim-soft`) restent calculés par `color-mix` dans `:root`. Un thème peut les remplacer : les thèmes clairs fixent `--appt-bg` aux valeurs de l'annexe. Pour qu'ils se recalculent sur un élément qui porte son propre `data-theme` (vignette), ils sont déclarés sur `:root, [data-theme]`.
- `--warn` et `--warn-line` semblent inutilisés. Le constructeur le vérifie et les supprime s'ils le sont.
- Aucune couleur écrite en dur hors des blocs de thème, comme aujourd'hui (règle du CLAUDE.md).

### Titres
`.serif` prend `--serif`, `--title-weight`, `text-transform: var(--title-case)` et `letter-spacing: var(--title-track)`. Valeurs par défaut : celles d'Élégance, soit 500, `none` et `normal`. Les polices condensées en capitales, ou plus grosses à corps égal, réduisent leurs trois tailles de titre (`--fs-xl`, `--fs-2xl`, `--fs-3xl`) dans leur bloc de thème, arrondies au pixel. Facteurs des maquettes : Barbier et Barbier jour ×0,82, Ardoise ×0,9, Atelier ×0,9, Ivoire ×0,94. Le texte courant garde 13/14/16/18 px dans tous les thèmes. Les chiffres du clavier du code (`.key`) sont dans la police du texte mais utilisent aujourd'hui `--fs-xl`. Ils prennent leur propre variable à 32 px, que les thèmes ne changent pas : sans cela, ils rapetisseraient avec les titres (choix de Claude après relecture).

### Logo
`logo.svg` a son dégradé or rose écrit dedans. Il sert désormais de **masque**. Le logo devient `<span class="logo logo-…" role="img" aria-label="H&B Salon">`, avec `aspect-ratio: 854 / 502`, `background: linear-gradient(var(--logo-1), var(--logo-2))` et `mask: url(logo.svg) center / contain no-repeat`, plus `-webkit-mask` par prudence pour Chrome Android. `styles.css` utilise déjà un masque pour l'icône de `.field-err`. Ce changement touche la fonction `logo()` d'`app.js` et le logo de démarrage d'`index.html`. Les classes de taille `.logo-sm` à `.logo-xl` restent, et `logo.svg` reste dans le cache.

### Fond de Bienvenue et de Merci
Le dégradé de `.welcome` passe dans un jeton `--welcome-bg`. Par défaut, il vaut le halo actuel. Les thèmes de l'annexe le remplacent : rayures, rayons, quadrillage, dégradé du lagon. Le cadre d'Éditorial, d'Art déco (double) et de Bleu porcelaine est dessiné par une règle propre au thème dans `themes.css` (`.welcome::before`, inset d'environ 28 px, sans capter le toucher). Le bouton « Espace coiffeur » se décale alors à l'intérieur du cadre. Le filet sous « Bienvenue » prend `--accent`.

### Réglages
- La section « Thème » forme un groupe de boutons radio (`role="radiogroup"`, chaque vignette en `role="radio"` avec `aria-checked`), comme les puces « qui » de la fenêtre de rendez-vous. Chaque vignette porte `data-action="set-theme"`. Son aperçu porte `data-theme` et dessine le fond, une ligne de texte, une ligne secondaire, une pastille `--accent-fill` et un liseré `--accent`. La zone tactile fait au moins 44 px, avec un retour au toucher.
- La fenêtre de Réglages doit s'élargir pour 4 colonnes en paysage. En portrait, 2 ou 3 colonnes. Le constructeur en décide.
- Au toucher : l'attribut est posé sur `<html>`, le choix est écrit dans `localStorage`, la balise `theme-color` est mise à jour, puis `render()` est appelé en gardant le focus sur la vignette. `announce()` lit « Thème Barbier appliqué » pour le lecteur d'écran. Pas de toast. La fenêtre étant déjà ouverte, elle ne rejoue pas son fondu (règle `S.modal`).
- À l'ouverture de Réglages, le focus va sur la vignette cochée, à la place de « Changer le code ».

### Démarrage sans flash
- Un court script en ligne dans le `<head>` d'`index.html`, **avant** les feuilles de style, lit le thème dans `localStorage` et pose `data-theme` sur `<html>`. Il est enveloppé dans un `try`, car `localStorage` peut lever une erreur. Sans valeur, Élégance s'applique (`:root`).
- La balise `theme-color` prend la couleur de fond du thème dès le lancement. Par exemple, le script lit aussi une couleur gardée avec le thème, ou une petite table. Le constructeur choisit.
- Un identifiant inconnu (thème retiré plus tard) retombe sur Élégance : aucun bloc ne correspond, donc `:root` s'applique. `app.js` nettoie ensuite l'attribut et la valeur gardée.
- `themes.css` est chargé après `styles.css` dans `index.html` et ajouté à la liste `SHELL` de `sw.js`.

### Polices
- Familles à ajouter dans `app/fonts/`, en woff2 latin et latin-ext comme les deux actuelles, variables quand Google Fonts en propose :
  - Oswald 500 ; Work Sans 400–700 ;
  - Bodoni Moda 500 et 500 italique ; Archivo 400–700 ;
  - DM Serif Display 400 ; DM Sans 400–700 ;
  - Marcellus 400 ; Josefin Sans 400–700 ;
  - Space Grotesk 500–600 ; IBM Plex Sans 400–700 ;
  - Barlow Condensed 600 ; Barlow 400–700 ;
  - Playfair Display 500 ; Source Sans 3 400–700 ;
  - Gilda Display 400 ; Figtree 400–700.

  Les graisses du texte suivent celles que l'appli utilise : 400, 500, 600 et 700. Toutes ces polices sont sous licence OFL.
- Les `@font-face` vont dans `fonts/fonts.css`, sur le modèle actuel (`font-display: swap`, `unicode-range`). La liste `FONTS` de `sw.js` est étendue.
- Le poids total visé est d'environ 1,5 Mo. Le constructeur mesure le poids réel et le donne dans son compte rendu.
- Le constructeur peut ajouter un script dans `tools/` pour télécharger et déclarer les polices, s'il le juge utile.

### Barre du haut et polices larges
Avec Work Sans (Barbier, Barbier jour), la date ne tient plus en entier dans la barre du haut en 1280 × 800 : elle était coupée dans les maquettes. Exigence : **rien ne déborde ni n'est coupé dans la barre du haut, pour aucun thème**, en 1280 × 800 comme en 800 × 1280. Le constructeur choisit la solution : date abrégée, espacement ajusté, ou autre. Elle ne doit pas changer la barre d'Élégance.

### Tests
- Ajouter `tests/themes.test.js`, lancé par `node --test "tests/*.test.js"`. Il lit `app/themes.css`. Le test échoue dans trois cas :
  - un thème de la liste n'a pas son bloc ;
  - il manque un jeton obligatoire à un bloc ;
  - une paire de contrastes descend sous son seuil. Les seuils :
    - `--text` sur `--bg`, `--panel`, `--panel-2`, `--appt-bg` et `--warn-bg` ≥ 7 ;
    - `--text-2` sur `--bg`, `--panel` et `--appt-bg` ≥ 4,5 ;
    - `--muted` sur `--bg`, `--panel` et `--panel-2` ≥ 4,5 ;
    - `--accent` sur `--bg`, `--panel` et `--panel-2` ≥ 4,5, et sur `--appt-bg` ≥ 3 ;
    - `--on-accent` sur `--accent-fill` ≥ 4,5 ;
    - `--error` sur `--bg` et `--warn-bg` ≥ 4,5, et sur `--appt-bg` ≥ 3 ;
    - `--bg` sur `--error` ≥ 4,5 (texte de `.btn-danger`) ;
    - `--line-2` et `--control-line` sur `--bg` ≥ 3, `--control-line` sur `--panel` ≥ 3, `--control-line-2` sur `--panel-2` ≥ 3 ;
    - `--placeholder` sur `--panel` ≥ 3.
- La liste des thèmes (identifiant et nom) vit à un seul endroit, partagé par `app.js` et le test. Par exemple, un petit module `app/themes.js`.
- Avec Playwright, passer chaque thème sur les écrans suivants, en 1280 × 800 et 800 × 1280 : Bienvenue, code, écran client, Merci, Aujourd'hui, fiche (allergie, prestations cochées, historique), agenda, fenêtre de rendez-vous, Réglages. Faire aussi un passage clavier ouvert (hauteur d'environ 440 px) avec un thème clair et un thème Barbier. Vérifier enfin le lancement avec un thème clair gardé : aucun flash d'Élégance.

## Contraintes
- Règles de design du CLAUDE.md : un seul bouton plein, retour au toucher, zones de 44 px, bords à 3:1, typographie française, aucune couleur ni taille en dur hors des variables.
- `render()` garde le défilement et le focus. Une fenêtre de `S.modal` ne rejoue ni son fondu ni `data-autofocus` quand elle est seulement redessinée.
- Incrémenter `CACHE` dans `sw.js`.
- Mettre à jour le CLAUDE.md : section Design (thèmes, `themes.css`, `--accent` contre `--accent-fill`, logo en masque) et section Architecture (`themes.css`, polices).

## Laissé au constructeur
- Le nom exact des nouveaux jetons et de la clé de `localStorage`.
- La façon de colorer `theme-color` au lancement.
- La disposition des vignettes et la largeur de la fenêtre de Réglages.
- Les tailles de titre arrondies par thème.
- `--control-line-2`, `--accent-hi` et `--accent-fill-hi` de chaque thème.
- `--halo` et `--glow` des thèmes clairs, à vérifier à l'œil.
- La solution pour la date dans la barre du haut.

## Annexe : palettes des maquettes
Valeurs validées sur les maquettes, avec un contrôle de contraste passé. Correspondance avec les jetons de l'appli :
- couleurs de base : `bg` → `--bg`, `panel` → `--panel`, `panel2` → `--panel-2`, `line` → `--line`, `line2` → `--line-2`, `ctl` → `--control-line` ;
- textes : `text` → `--text`, `text2` → `--text-2`, `muted` → `--muted`, `ph` → `--placeholder` ;
- or : `accent` → `--accent-fill`, `ink` → `--accent`, `on` → `--on-accent` ;
- alertes : `al` → `--warn-bg`, `error` → `--error` ;
- agenda et accueil : `appt` → `--appt-bg` (sinon dérivé), `logo` → `--logo-1` et `--logo-2`, `welcome` → `--welcome-bg` ;
- arrondis : `r` → `--r-xs`, `--r-sm`, `--r-md`, `--r-lg`, `--r-xl`, `--r-pill` ;
- polices et titres : `serif` → `--serif`, `sans` → `--sans`, `titleWeight`, `titleCase` et `titleTrack` → jetons de titre, `titleK` → facteur des tailles de titre ;
- `frame` : cadre sur l'accueil (double pour Art déco) ; `welcomeItalic` : « Bienvenue » en italique.

Élégance garde exactement les valeurs actuelles de `styles.css`.

```js
{
  id: "elegance",
  name: "Élégance",
  tag: "Sombre",
  serif: "'Cormorant Garamond', Georgia, serif",
  sans: "Manrope, system-ui, sans-serif",
  titleWeight: 500,
  bg: "#161d33",
  panel: "#1f2843",
  panel2: "#2a3456",
  line: "#2e3a5c",
  line2: "#66739e",
  ctl: "#707ca8",
  text: "#f3ede7",
  text2: "#c9cfdf",
  muted: "#a9b1c7",
  ph: "#8c95ae",
  accent: "#e3b59c",
  ink: "#e3b59c",
  on: "#161d33",
  al: "#3a2a35",
  error: "#ff7b6e",
  logo: ["#f2d4c2","#d9a386"],
  r: [6,10,12,16,20,99],
  welcome: "radial-gradient(ellipse 55% 60% at 50% 42%, #222b4a 0%, #1b2340 45%, #161d33 100%)",
},
{
  id: "jour",
  name: "Élégance jour",
  tag: "Clair",
  serif: "'Cormorant Garamond', Georgia, serif",
  sans: "Manrope, system-ui, sans-serif",
  titleWeight: 600,
  bg: "#f6f1ee",
  panel: "#fffcfa",
  panel2: "#f0e6e0",
  line: "#e3d7cf",
  line2: "#7c7f96",
  ctl: "#767a92",
  text: "#161d33",
  text2: "#39415e",
  muted: "#5a6180",
  ph: "#81869d",
  accent: "#e3b59c",
  ink: "#94553a",
  on: "#161d33",
  al: "#fbe9e6",
  error: "#b8321f",
  appt: "#e5e8f1",
  logo: ["#cf9576","#94553a"],
  r: [6,10,12,16,20,99],
  welcome: "radial-gradient(ellipse 55% 60% at 50% 42%, #fffaf6 0%, #f8f1ec 50%, #efe5df 100%)",
},
{
  id: "barbier",
  name: "Barbier",
  tag: "Sombre",
  serif: "Oswald, 'Arial Narrow', sans-serif",
  sans: "'Work Sans', system-ui, sans-serif",
  titleWeight: 500,
  titleCase: "uppercase",
  titleTrack: "0.04em",
  titleK: 0.82,
  bg: "#181513",
  panel: "#221e1b",
  panel2: "#2e2824",
  line: "#3a332d",
  line2: "#7d7064",
  ctl: "#86786b",
  text: "#f2eadf",
  text2: "#d6ccbf",
  muted: "#b5a99b",
  ph: "#958a7e",
  accent: "#d39257",
  ink: "#d9995f",
  on: "#181513",
  al: "#3b211e",
  error: "#ff7a66",
  logo: ["#ebb985","#b8743a"],
  r: [3,4,6,8,10,4],
  welcome: "repeating-linear-gradient(135deg, rgba(211,146,87,0.05) 0 22px, transparent 22px 44px), radial-gradient(ellipse 60% 65% at 50% 42%, #2a231e 0%, #181513 75%)",
},
{
  id: "ivoire",
  name: "Ivoire & laiton",
  tag: "Clair",
  serif: "'Playfair Display', Georgia, serif",
  sans: "'Source Sans 3', system-ui, sans-serif",
  titleWeight: 500,
  titleK: 0.94,
  bg: "#f5f0e6",
  panel: "#fffcf6",
  panel2: "#ece3d2",
  line: "#ddd2bf",
  line2: "#857a68",
  ctl: "#7e735f",
  text: "#2a2118",
  text2: "#4a3f33",
  muted: "#64584a",
  ph: "#8a7f70",
  accent: "#c9a45c",
  ink: "#7c5d1f",
  on: "#2a2118",
  al: "#f9e3dd",
  error: "#b3301f",
  appt: "#ede3cc",
  logo: ["#d4b06a","#8c6a2a"],
  r: [6,10,12,16,20,99],
  welcome: "radial-gradient(ellipse 55% 60% at 50% 42%, #fffdf7 0%, #f7f2e8 50%, #ece4d4 100%)",
},
{
  id: "barbierjour",
  name: "Barbier jour",
  tag: "Clair",
  serif: "Oswald, 'Arial Narrow', sans-serif",
  sans: "'Work Sans', system-ui, sans-serif",
  titleWeight: 500,
  titleCase: "uppercase",
  titleTrack: "0.04em",
  titleK: 0.82,
  bg: "#f1ebe2",
  panel: "#fbf8f3",
  panel2: "#e8dfd2",
  line: "#d9cdbd",
  line2: "#857565",
  ctl: "#7e6e5f",
  text: "#1e1814",
  text2: "#3d332b",
  muted: "#5c4f44",
  ph: "#85776a",
  accent: "#c97d3e",
  ink: "#8a4a1c",
  on: "#1e1814",
  al: "#f8e1dc",
  error: "#b0301e",
  appt: "#ecdcc8",
  logo: ["#c98a52","#7f4319"],
  r: [3,4,6,8,10,4],
  welcome: "repeating-linear-gradient(135deg, rgba(138,74,28,0.045) 0 22px, transparent 22px 44px), radial-gradient(ellipse 60% 65% at 50% 42%, #fbf7f0 0%, #f1ebe2 75%)",
},
{
  id: "porcelaine",
  name: "Bleu porcelaine",
  tag: "Clair",
  serif: "'Gilda Display', Didot, Georgia, serif",
  sans: "Figtree, system-ui, sans-serif",
  titleWeight: 400,
  bg: "#f2f4f8",
  panel: "#ffffff",
  panel2: "#e4e9f3",
  line: "#d5dbe7",
  line2: "#7a8299",
  ctl: "#737b93",
  text: "#18213d",
  text2: "#36405e",
  muted: "#555f7c",
  ph: "#838aa1",
  accent: "#2d4b8e",
  ink: "#2d4b8e",
  on: "#ffffff",
  al: "#fbe6e4",
  error: "#b42318",
  appt: "#e1e8f5",
  logo: ["#cfac70","#8f6d33"],
  r: [6,10,12,16,20,99],
  welcome: "radial-gradient(ellipse 55% 60% at 50% 42%, #ffffff 0%, #f5f7fb 50%, #e6ebf4 100%)",
  frame: true,
},
{
  id: "ardoise",
  name: "Ardoise & cuivre",
  tag: "Sombre",
  serif: "'Barlow Condensed', 'Arial Narrow', sans-serif",
  sans: "Barlow, system-ui, sans-serif",
  titleWeight: 600,
  titleCase: "uppercase",
  titleTrack: "0.03em",
  titleK: 0.9,
  bg: "#171c21",
  panel: "#1f262c",
  panel2: "#29323a",
  line: "#333d46",
  line2: "#6c7a86",
  ctl: "#76848f",
  text: "#eef1f2",
  text2: "#ccd4d9",
  muted: "#a7b2ba",
  ph: "#87939c",
  accent: "#d68a5c",
  ink: "#de9a70",
  on: "#171c21",
  al: "#3a2124",
  error: "#ff7b68",
  logo: ["#eab08a","#b8693d"],
  r: [3,4,6,8,10,4],
  welcome: "repeating-linear-gradient(90deg, rgba(238,241,242,0.028) 0 1px, transparent 1px 16px), radial-gradient(ellipse 60% 65% at 50% 42%, #24303a 0%, #171c21 75%)",
},
{
  id: "editorial",
  name: "Éditorial",
  tag: "Clair",
  serif: "'Bodoni Moda', Didot, Georgia, serif",
  sans: "Archivo, system-ui, sans-serif",
  titleWeight: 500,
  bg: "#f6f6f4",
  panel: "#ffffff",
  panel2: "#ececea",
  line: "#dcdcd8",
  line2: "#858581",
  ctl: "#7d7d79",
  text: "#111111",
  text2: "#333333",
  muted: "#5c5c58",
  ph: "#8a8a86",
  accent: "#111111",
  ink: "#111111",
  on: "#ffffff",
  al: "#fbe7e7",
  error: "#bf1e2e",
  appt: "#e9e9e5",
  logo: ["#111111","#111111"],
  r: [0,0,0,0,0,0],
  welcome: "linear-gradient(#f6f6f4, #f6f6f4)",
  frame: true,
  welcomeItalic: true,
},
{
  id: "lagon",
  name: "Lagon",
  tag: "Clair",
  serif: "'DM Serif Display', Georgia, serif",
  sans: "'DM Sans', system-ui, sans-serif",
  titleWeight: 400,
  bg: "#f4f0e6",
  panel: "#fffdf8",
  panel2: "#e2efec",
  line: "#ddd5c5",
  line2: "#7b8884",
  ctl: "#75837e",
  text: "#0f2f35",
  text2: "#2b4b50",
  muted: "#4b6669",
  ph: "#7a8d8d",
  accent: "#0e7a7e",
  ink: "#0b6a6e",
  on: "#ffffff",
  al: "#fbe4df",
  error: "#b3361f",
  appt: "#d6ebe8",
  logo: ["#34a8a6","#0b6a6e"],
  r: [6,10,12,16,20,99],
  welcome: "linear-gradient(180deg, #cfe9e5 0%, #e4efe8 38%, #f4f0e6 72%)",
},
{
  id: "artdeco",
  name: "Art déco",
  tag: "Sombre",
  serif: "Marcellus, 'Trajan Pro', Georgia, serif",
  sans: "'Josefin Sans', system-ui, sans-serif",
  titleWeight: 400,
  titleTrack: "0.02em",
  bg: "#0d221e",
  panel: "#132d28",
  panel2: "#1a3832",
  line: "#23463e",
  line2: "#5e8178",
  ctl: "#68897f",
  text: "#f2ebdd",
  text2: "#cfd9cf",
  muted: "#a7b9b0",
  ph: "#86998f",
  accent: "#d8b66e",
  ink: "#d8b66e",
  on: "#0d221e",
  al: "#3a2125",
  error: "#ff7f6e",
  logo: ["#f2da9e","#b8923f"],
  r: [2,2,3,4,6,2],
  welcome: "repeating-conic-gradient(from 270deg at 50% 108%, rgba(216,182,110,0.055) 0deg 0.5deg, transparent 0.5deg 6deg), radial-gradient(ellipse 60% 65% at 50% 42%, #173a33 0%, #0d221e 75%)",
  frame: true,
},
{
  id: "atelier",
  name: "Atelier",
  tag: "Clair",
  serif: "'Space Grotesk', system-ui, sans-serif",
  sans: "'IBM Plex Sans', system-ui, sans-serif",
  titleWeight: 600,
  titleTrack: "-0.01em",
  titleK: 0.9,
  bg: "#e6e5e2",
  panel: "#f2f1ef",
  panel2: "#dad9d5",
  line: "#c9c8c3",
  line2: "#787772",
  ctl: "#72716c",
  text: "#1c1c1a",
  text2: "#383835",
  muted: "#545450",
  ph: "#7c7b76",
  accent: "#e2a919",
  ink: "#6f5000",
  on: "#1c1c1a",
  al: "#f6ddd8",
  error: "#b0261c",
  appt: "#f1e5bf",
  logo: ["#1c1c1a","#1c1c1a"],
  r: [4,4,6,8,10,4],
  welcome: "linear-gradient(rgba(28,28,26,0.045) 1px, transparent 1px) 0 0 / 40px 40px, linear-gradient(90deg, rgba(28,28,26,0.045) 1px, transparent 1px) 0 0 / 40px 40px, #e6e5e2",
},
```
