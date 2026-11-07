# Agenda de rendez-vous et vrai logo — conception

Date : 7 novembre 2026. Statut : à valider.
Décidé avec l'utilisateur en séance (brainstorming + maquettes dans `.superpowers/brainstorm/1160-1793979834/content/`).
Ce qui vient de moi (Claude) et n'a pas été discuté est marqué **[choix Claude]** et récapitulé en fin de document.

## Pourquoi

Le téléphone sonne au salon. Aujourd'hui le coiffeur note le rendez-vous dans un grand cahier papier :
deux pages ouvertes = une semaine, une ligne par heure. Il veut faire la même chose sur la tablette :
ouvrir l'agenda, toucher le créneau, taper le numéro du client. Si la fiche existe, son prénom s'affiche
(avec son allergie) ; sinon une fiche est créée avec juste le prénom. Le jour J, il retrouve ses
rendez-vous du jour en ouvrant l'espace coiffeur, et un appui l'amène sur la fiche, prestations cochées.

En même temps : remplacer le logo redessiné (Cormorant + Manrope, le H paraissait plus large que le B)
par le **vrai logo du salon**, reflets compris, partout dans l'appli et dans son icône.

## Objectifs

- Une vue semaine qui se lit comme le cahier, et une prise de rendez-vous en quelques secondes au téléphone.
- Les rendez-vous du jour à l'ouverture de l'espace coiffeur, à la place de « Prochain client ».
- « Dernière couleur il y a N semaines (date) » sur la fiche.
- Sauvegarde en ligne des rendez-vous, comme les fiches.
- Le vrai logo partout, et une nouvelle icône d'appli.

## Hors champ

- SMS ou messages de rappel (mis de côté le 7/11).
- Suivi des absences, liste d'attente, rendez-vous récurrents.
- Plusieurs coiffeurs, jours fériés ou fermetures exceptionnelles, horaires réglables.
- Chevauchement de rendez-vous (pas de client pris pendant une pose, pour l'instant).
- Export CSV des rendez-vous ; Google Agenda.
- Ménage automatique des fiches créées au téléphone pour un client qui n'est jamais venu.

## À éviter absolument

- Qu'un rendez-vous fasse partir en ligne les données d'un client sans accord RGPD.
- Qu'un client qui refuse l'accord perde ses rendez-vous à venir (il a bien appelé pour venir).
- Qu'un rendez-vous soit enregistré par-dessus un autre sans que le coiffeur le voie.
- Une prise de rendez-vous plus lente que le cahier.

## Contraintes

- Celles de [CLAUDE.md](../../../CLAUDE.md) : JavaScript simple sans build, rendu par chaînes HTML et `data-action`,
  état dans `S`, design « Élégance », textes français avec espaces fines, un seul bouton or plein par écran,
  bordeaux et triangle réservés à l'allergie, corail pour les erreurs et la suppression, zones tactiles de 44 px.
- Tablette Samsung, deux orientations : 1280×800 (paysage) et 800×1280 (portrait) ; clavier Android ouvert
  (~440 px de haut en paysage).
- Hors-ligne d'abord : tout est écrit sur la tablette, puis synchronisé.
- Changement de structure locale = `DB_VERSION` 3 avec migration ; `CACHE` du service worker à incrémenter.
- La base Supabase du coiffeur existe déjà : la nouvelle table arrive par un script SQL que l'utilisateur
  colle lui-même **avant** la mise en ligne (compte du coiffeur et compte de test).
- Le coiffeur n'a pas encore installé l'appli : push direct sur `main` accepté.

## Approches

- **A. Rendez-vous à part, sauvegarde comprise, tout en une fois** — retenue par l'utilisateur.
  Nouveau magasin `appointments` sur la tablette et nouvelle table `appointments` en ligne, synchronisés
  comme les fiches. Un rendez-vous garde sa propre copie du prénom et du téléphone : il survit à
  l'effacement de la fiche.
- B. Rendez-vous = visites « prévues » dans le magasin `visits` existant. Écartée : une visite disparaît
  avec la fiche (RGPD) alors qu'un rendez-vous doit lui survivre, elle n'a pas de durée, et l'historique
  se mélangerait au planning.
- C. Google Agenda. Écarté par l'utilisateur : données des clients chez un tiers, aucun lien avec les fiches.
- Livrer en deux temps (agenda local d'abord, sauvegarde ensuite) : écarté par l'utilisateur, qui veut
  tout livrer en une fois.

## Ce qui est décidé

### 1. Données

Magasin IndexedDB `appointments` (`DB_VERSION` 3), index `dirty`, `clientId`, `start` :

| Champ | Contenu |
|---|---|
| `id` | identifiant (uid) |
| `clientId` | fiche liée, ou `null` si la fiche a été effacée |
| `firstName`, `phone` | copie prise à la réservation (affichée si la fiche n'existe plus) |
| `start` | début, date ISO |
| `duration` | durée en minutes, multiple de 15 |
| `services` | prestations prévues (liste, éventuellement vide) |
| `localOnly` | `1` si le rendez-vous ne doit jamais partir en ligne (voir RGPD) |
| `createdAt`, `updatedAt`, `syncedAt`, `dirty` | comme les autres enregistrements |

Partout, un rendez-vous affiche le nom actuel de sa fiche (complété par le client entre-temps) ; la copie ne
sert que quand la fiche n'existe plus. Heures calculées dans le fuseau de la tablette (Nouméa).

Fonctions dans `db.js` sur le modèle des visites : `saveAppointment` (pose `dirty: 1`),
`deleteAppointment(id, tombstone)` (effacement noté dans `deletions`, type `appointment`),
`appointmentsBetween(début, fin)`, `appointmentsOf(clientId)`.
Annuler un rendez-vous = l'effacer : il disparaît de l'agenda.

### 2. L'agenda (vue semaine)

- Deux boutons dans la barre du haut de l'espace coiffeur : **Fiches** / **Agenda** (celui affiché est
  souligné d'or). L'agenda prend toute la largeur sous la barre. Revenir aux fiches retrouve le client et
  le brouillon tels qu'ils étaient.
- 6 colonnes **lundi → samedi**, de **8 h 30 à 18 h sans pause**, une ligne par heure (trait plus discret
  à la demi-heure), comme le cahier. Maquette retenue : vue A de `agenda-vue.html`.
- Toute la semaine tient à l'écran sans défiler, dans les deux orientations ; en portrait les colonnes sont
  plus étroites. **[choix Claude]** En paysage une demi-heure fait ~34 px de haut, sous les 44 px de la règle :
  accepté parce que l'heure se corrige dans la fenêtre qui s'ouvre, un appui imprécis ne coûte rien.
- En-tête : « Semaine du 9 au 14 novembre », flèches ‹ › et « Cette semaine ». Jour courant en or, trait or
  à l'heure actuelle. **[choix Claude]** Le dimanche, l'agenda s'ouvre sur la semaine suivante.
- Un rendez-vous = un bloc dont la hauteur suit la durée : prénom + prestations abrégées, triangle
  d'allergie si la fiche en a une. Les blocs courts n'affichent que le prénom.
- Les rendez-vous passés restent visibles, atténués, et s'ouvrent encore.
- Un appui sur un créneau vide ouvre « Nouveau rendez-vous » à la demi-heure touchée.
  **[choix Claude]** Pas de création dans un créneau passé (grisé).

### 3. Fenêtre « Nouveau rendez-vous »

Maquette : `rdv-et-accueil.html`.

- En tête : jour et heure préremplis (« Samedi 7 novembre · 14 h 00 »). **[choix Claude]** L'heure se règle
  par − / + de 15 min, pour les rendez-vous à l'heure et quart que la grille ne permet pas de viser.
- Champ **Téléphone** (clavier numérique), focus d'entrée. Les fiches correspondantes apparaissent au fil de
  la frappe, avec la même règle que la recherche des fiches (plusieurs si le numéro est partagé ; une seule
  ligne de choix, les plus récentes d'abord), plus « + Autre personne ». Un appui choisit la fiche.
  **[choix Claude]** Le champ accepte aussi un nom (comme la recherche des fiches) : un client dont la fiche
  n'a pas de téléphone serait sinon introuvable et recréé en double.
- « Autre personne », ou aucun résultat : champ **Prénom** (obligatoire ; prérempli si l'on a tapé un nom).
  À l'enregistrement, une fiche est créée avec ce prénom et le téléphone tapé (s'il y en a un), sans accord
  RGPD, comme une fiche créée par le coiffeur.
- Fiche choisie avec allergie : ligne d'allergie (bordeaux, triangle) sous le choix.
- Les 8 prestations à cocher. **[choix Claude]** Aucune n'est obligatoire : la durée suffit à bloquer le créneau.
- **Durée** préremplie, réglée par − / + de 15 min (minimum 15 min) :
  durée du dernier rendez-vous du même client avec exactement les mêmes prestations (« comme le 12 sept. »),
  sinon durée standard (« durée habituelle »). Elle se recalcule quand les prestations changent, tant que le
  coiffeur ne l'a pas réglée à la main.
  **[choix Claude]** Durées standard, additionnées puis arrondies au quart d'heure (30 min sans prestation) :

  | Coupe & coiffage | Coloration | Lissage | Soin | Barbe | Massage | Visagiste | Diagnostic |
  |---|---|---|---|---|---|---|---|
  | 30 min | 2 h | 2 h 30 | 30 min | 30 min | 30 min | 30 min | 15 min |

  Coupe & coiffage ramenée de 45 à 30 min le 2026-11-07, à la demande de l'utilisateur.

- **Enregistrer** (seul bouton or) et Annuler. Enregistrer est refusé, avec la raison sous le bouton et
  annoncée au lecteur d'écran, si :
  - personne n'est choisi (« Choisissez la fiche ou tapez un prénom ») ;
  - le rendez-vous chevauche le suivant (« Chevauche le rendez-vous de Camille à 15 h 00 ») ;
  - **[choix Claude]** il finit après 18 h (« Le salon ferme à 18 h »).
- La fenêtre reste utilisable clavier ouvert en paysage (elle défile ; c'est déjà un `.dialog`).

### 4. Un rendez-vous existant

Appui sur un bloc : même fenêtre, titrée « Rendez-vous », avec la personne affichée (non modifiable :
pour changer de client, on annule et on reprend) et :

- prestations, heure et durée modifiables, mêmes contrôles et même refus que ci-dessus ;
- **Déplacer** **[choix Claude]** : la fenêtre se ferme, un bandeau « Touchez le nouveau créneau de Camille »
  (avec Annuler) reste en haut de l'agenda ; on peut changer de semaine ; l'appui sur un créneau libre y
  déplace le rendez-vous avec la même durée, ou dit pourquoi c'est impossible ;
- **Ouvrir la fiche** **[choix Claude]** : comme un appui dans la liste du jour (voir 5) ;
- **Annuler le rendez-vous** (corail) avec confirmation ; il disparaît.

### 5. À l'ouverture de l'espace coiffeur : les rendez-vous du jour

À la place de « Prochain client » (quand aucune fiche n'est ouverte) :

- « Aujourd'hui », puis « Samedi 7 novembre · 4 rendez-vous ».
- Une ligne par rendez-vous : heure, nom, prestations · durée, « Allergie » avec triangle si besoin.
  Les rendez-vous terminés sont grisés ; le prochain est entouré d'or. **[choix Claude]** « Le prochain » =
  le premier qui n'est pas terminé (celui en cours, s'il y en a un).
- Un appui ouvre la fiche avec les prestations du rendez-vous déjà cochées, si sa visite du jour est vide
  (un brouillon déjà commencé n'est pas touché).
- **[choix Claude]** Rendez-vous dont la fiche a été effacée : l'appui ouvre « Nouveau client » avec le prénom
  et le téléphone préremplis.
- Aucun rendez-vous : « Aucun rendez-vous aujourd'hui », avec le bouton « Nouveau client » actuel et un
  lien vers l'agenda.

### 6. Fiche : dernière couleur

Sous le nom, en information neutre : « Dernière couleur il y a 8 semaines (12 sept.) », d'après la visite la
plus récente qui contient Coloration. Rien si aucune. **[choix Claude]** En dessous de 2 semaines : « il y a
N jours » (et « aujourd'hui »).

### 7. RGPD

- Un rendez-vous ne part en ligne que si sa fiche a l'accord RGPD (même règle que les visites). Réservé au
  téléphone sans accord : il reste sur la tablette, et part dès que le client donne son accord en fin de visite.
- Refus de l'accord en fin de visite : fiche, visites et photos effacées comme aujourd'hui, et :
  - rendez-vous passés de ce client (début avant maintenant, dont celui du jour) : effacés ;
  - rendez-vous à venir : **gardés sur la tablette seulement** (`clientId: null`, `localOnly: 1`), avec leur
    copie du prénom et du téléphone. S'ils étaient déjà en ligne, ils y sont effacés.
- **[choix Claude]** La fenêtre « Ne pas conserver votre fiche ? » vue par le client ajoute, s'il a des
  rendez-vous à venir : « Vos prochains rendez-vous restent notés. » Le bandeau du coiffeur précise
  « Ses 2 rendez-vous à venir sont gardés sur la tablette. »

### 8. Sauvegarde en ligne

- Table `appointments` (`client_id` obligatoire avec effacement en cascade, `first_name`, `phone`,
  `start_at`, `duration_min`, `services text[]`, dates, `synced_at` posé par le serveur), mêmes index,
  déclencheur `touch` et règles d'accès que les autres tables. Le type `appointment` est ajouté au contrôle
  de `deletions.kind`.
- `supabase/schema.sql` mis à jour pour une installation neuve, plus un script court
  `supabase/2026-11-agenda.sql` pour les bases existantes (création de la table, nouveau contrôle sur
  `deletions`), à coller avant la mise en ligne.
- `sync.js` : envoi après les visites (la fiche doit exister en ligne), réception après les photos, même règle
  « le plus récent gagne ». Un rendez-vous `localOnly` n'est jamais envoyé, et l'effacement qui revient
  d'en ligne ne le supprime pas sur la tablette. Le compteur « en attente » compte les rendez-vous.
- Une fiche effacée depuis une autre tablette efface aussi ses rendez-vous ici.

### 9. Logo et icône

- `app/logo.webp` : le logo détouré (`logo-vrai.webp`, 854×502, fond transparent, 80 Ko). `logo()` rend
  une image (`alt="H&B Salon"`) aux largeurs des tailles actuelles (sm, md, lg, xl) ; les styles du logo
  dessiné disparaissent.
- Icône : le vrai logo sur bleu nuit, en 192 et 512 px ; une version « maskable » à part, logo réduit pour
  tenir dans la zone sûre (cercle de 80 %). Le favicon passe à l'image ; `icon.svg` disparaît.
  Images générées par un petit script Pillow comme `detourer.py`.
- `sw.js` : nouveaux fichiers dans `SHELL`, `CACHE` → `hb-salon-v7`.

### 10. Mise en ligne

1. L'utilisateur colle `supabase/2026-11-agenda.sql` dans le compte de test, puis dans celui du coiffeur.
2. Push sur `main`.

## Laissé au constructeur

- Découpage du code (tout dans `app.js` ou un module `agenda.js`), structure de `S` pour l'onglet et le mode
  « Déplacer », calcul de la grille.
- Barre du haut en portrait : faire tenir Fiches / Agenda sans dépasser deux lignes (quitte à masquer
  « Espace coiffeur »).
- Lecteur d'écran : créneaux et blocs en boutons avec un nom complet (« Lundi 9 novembre, 14 h, libre »).
- Deux rendez-vous qui se chevauchent après synchro de deux tablettes : les afficher côte à côte, sans bloquer.
- Le verrouillage après 10 min s'applique aussi à l'agenda ; au déverrouillage, on revient où l'on était.

## Tests

Playwright en 1280×800 et 800×1280, contextes isolés, `page.clock.install()` pour fixer « maintenant »
(un samedi, un dimanche, un après-midi). À couvrir : prise de rendez-vous (fiche trouvée, numéro partagé,
autre personne, nom), refus (chevauchement, 18 h, personne), modification, déplacement vers une autre
semaine, annulation, liste du jour et ouverture de fiche, dernière couleur, refus RGPD avec rendez-vous
passés et à venir, migration d'une base v2 remplie, clavier ouvert (~440 px). Synchro : compte Supabase de
test créé pour l'occasion puis supprimé, deux contextes = deux tablettes. Puis une revue `/impeccable critique`.

## Choix de Claude à vérifier

1. Demi-heure de ~34 px en paysage (sous la règle des 44 px), l'heure se corrigeant dans la fenêtre.
2. Le dimanche, l'agenda s'ouvre sur la semaine suivante.
3. Pas de création dans un créneau passé.
4. Heure réglable par − / + 15 min dans la fenêtre.
5. Le champ Téléphone accepte aussi un nom.
6. Prestations facultatives pour un rendez-vous.
7. Durées standard du tableau, additionnées.
8. Refus d'un rendez-vous qui finit après 18 h.
9. « Déplacer » par appui sur le nouveau créneau dans la grille.
10. « Ouvrir la fiche » dans la fenêtre d'un rendez-vous ; fiche effacée → « Nouveau client » prérempli.
11. « Le prochain » de la liste du jour = celui en cours s'il y en a un.
12. « Il y a N jours » sous 2 semaines pour la dernière couleur.
13. Rendez-vous passés effacés au refus RGPD ; phrase ajoutée dans la fenêtre vue par le client.
