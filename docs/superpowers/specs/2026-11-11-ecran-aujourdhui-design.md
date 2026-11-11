# Écran « Aujourd'hui » : planning du jour avec prise de rendez-vous

## Pourquoi
L'accueil de l'espace coiffeur est aujourd'hui une liste des rendez-vous du jour (onglet « Fiches »). Le coiffeur veut voir sa journée comme un planning, même vide, et y noter un rendez-vous sans passer par l'agenda.

## Ce qui change
- **Navigation du haut** : « Fiches » devient « Aujourd'hui » (icône maison). Les deux boutons « Aujourd'hui » / « Agenda » basculent entre les deux espaces.
- **Espace « Aujourd'hui »** : la colonne « Client » de gauche reste (recherche, résultats, « Nouveau client »). L'entrée « Aujourd'hui » en tête de cette colonne disparaît. Toucher « Aujourd'hui » en haut alors qu'une fiche est ouverte la referme et ramène au planning, la visite en cours étant mise de côté (`parkDraft`), comme l'actuelle action `today`.
- **Planning du jour**, à droite, à la place de la liste :
  - de 8 h 30 à 18 h, même sans rendez-vous ; aéré, environ 60 px par demi-heure ; il défile ;
  - il s'ouvre calé un peu avant l'heure actuelle, ou en haut de la journée avant l'ouverture ;
  - le temps passé est hachuré, la ligne de l'heure est présente, et les rendez-vous qui se chevauchent sont côte à côte, comme dans l'agenda ;
  - chaque rendez-vous affiche l'heure, le nom complet, les prestations, la durée et l'heure de fin. Il porte aussi l'état de la liste actuelle : « Validée à… », « À valider », « Pas de visite notée », « En cours », allergie. L'or va au prochain client pas encore fait ;
  - **toucher un rendez-vous ouvre la fiche du client** pour noter la visite (comportement actuel de `today-appt`, prestations cochées d'avance) ;
  - **toucher un créneau libre ouvre la fenêtre de rendez-vous** de l'agenda, avec la même durée proposée et les mêmes contrôles ;
  - après l'enregistrement, la confirmation s'affiche sous le titre « Aujourd'hui », sur la même ligne que dans l'agenda (`S.note`). Comme dans l'agenda, un nouveau rendez-vous n'a pas de bouton pour revenir en arrière. Le bouton « Rétablir » ou « Remettre comme avant » d'une annulation ou d'un déplacement faits dans l'agenda reste visible ici. Le nouveau bloc flashe et prend le focus.
- **Journée vide** : le planning est entièrement libre. Le lien « Prochain rendez-vous : … » reste sous le titre.
- **Dimanche** (salon fermé) : le message « Salon fermé aujourd'hui » remplace le planning, avec le lien vers le prochain rendez-vous ou vers l'agenda.
- **Modifier, déplacer ou annuler** un rendez-vous du jour : par la ligne « Rendez-vous aujourd'hui à… » de la fiche, qui ouvre l'agenda. Rien de nouveau ici.
- **Tablette en hauteur** : la colonne « Client » passe au-dessus du planning, comme pour la fiche aujourd'hui.

## Hors sujet
- Pas de navigation entre les jours dans « Aujourd'hui » : c'est le rôle de l'agenda.
- Rien ne change dans l'agenda : comportement, rendu et appui sur un rendez-vous (fenêtre) restent les mêmes.

## Approches considérées
1. **Retenue : partager la colonne de l'agenda.** `viewDayColumn` sert aux deux écrans, avec des options : rendez-vous à afficher, contenu des blocs, action au toucher. Les créneaux sont désignés par leur date plutôt que par leur rang dans `S.week`, pour marcher hors de l'agenda. Avantage : une seule logique pour les créneaux libres, les chevauchements, le hachuré et la ligne de l'heure. Coût : la fonction prend quelques options, et il faut vérifier que l'agenda reste identique.
2. Écrire un planning du jour à part, qui ne reprend que `freeSlots`. Avantage : liberté de mise en page. Inconvénient : chevauchements, hachuré et ligne de l'heure en double, avec le risque que l'un des deux exemplaires diverge.
3. Écartée : un « mode jour » de l'agenda. Il ramènerait la navigation par semaine et l'appui qui ouvre la fenêtre du rendez-vous au lieu de la fiche.

## Contraintes
- Règles de design du CLAUDE.md : un seul bouton or plein, retour au toucher, zones de 44 px (les quarts d'heure gardent leur débordement tactile), typographie française, `nbDay`/`SEP`.
- `S.space` vaut désormais `'today'` ou `'agenda'` (l'ancienne valeur `'fiches'` disparaît), et il est gardé au verrouillage.
- Après toute écriture de rendez-vous, `refreshAppts()` est appelé. Les rendez-vous du jour viennent de `S.todayAppts`.
- `KEEP_NOTE` et la gestion du focus après enregistrement ou annulation doivent viser le bloc du planning du jour quand on y est.
- Service worker : incrémenter `CACHE`.

## Laissé au constructeur
Le nom des options de `viewDayColumn`, la hauteur exacte des demi-heures et la marge de calage à l'ouverture (environ une demi-heure avant maintenant). Le libellé exact de la ligne sous le titre suit le modèle de l'agenda : « Touchez un créneau libre pour noter un rendez-vous. »
