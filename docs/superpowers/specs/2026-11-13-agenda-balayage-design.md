# Agenda : changer de semaine d'un glissement du doigt

## Pourquoi
Sur la tablette, passer d'une semaine à l'autre oblige à viser les flèches ‹ › en haut à droite. Un balayage horizontal sur la grille est plus naturel, surtout pour chercher un créneau quelques semaines plus loin.

## Ce qui est voulu
- Balayer vers la gauche sur la semaine : semaine suivante ; vers la droite : semaine précédente.
- La semaine change d'un coup, une fois le doigt levé (elle ne suit pas le doigt), puis la nouvelle entre par un court glissement animé, du côté d'où elle « vient ».
- Les flèches ‹ › et « Cette semaine / Semaine prochaine » déclenchent le même glissement (sens donné par la semaine visée).
- Rien n'est animé si la tablette demande moins d'animations (`prefers-reduced-motion`).
- Tout le reste est inchangé : message sous le titre et « Rétablir » (`KEEP_NOTE`), déplacement d'un rendez-vous en cours (`S.moving`), semaines passées en consultation.

## Hors sujet
- Pas de page qui suit le doigt, pas de carrousel à trois semaines.
- Pas de geste sur « Aujourd'hui » (un seul jour) ni dans les fenêtres.
- Un rendez-vous ramené en vue (`revealFlash`) change de semaine sans glissement.

## À éviter (échec même si « ça marche »)
- Un défilement vertical des heures, un peu en biais, qui change la semaine par erreur.
- Un appui sur un créneau ou un rendez-vous pris pour un balayage, ou un balayage qui ouvre un créneau au lever du doigt.
- Une animation rejouée à chaque `render()` (saisie, minuteur, synchro) au lieu du seul changement de semaine.

## Approches considérées
1. **Pointeurs + entrée animée (retenue).** `touch-action: pan-y` sur la grille : Chrome garde le défilement vertical (et envoie `pointercancel` dans ce cas) et nous laisse les gestes horizontaux. Au `pointerup`, au-delà d'un seuil horizontal (~60 px, nettement plus horizontal que vertical), on appelle `showWeek`. Seule la nouvelle semaine glisse (quelques dizaines de px + fondu). Peu de code, testable dans Playwright.
2. **Pointeurs + View Transitions.** L'ancienne semaine sort pendant que la nouvelle entre. Plus fidèle à une page tournée, mais il faut cantonner la transition à la grille alors que `render()` réécrit tout l'écran, et c'est plus fragile si une fenêtre s'ouvre pendant l'animation. Écartée.

## Décidé
- Approche 1 ; flèches animées aussi ; réduction des animations respectée.

## Laissé au constructeur (mes choix, à corriger si besoin)
- Le glissement joue une seule fois : un drapeau (sens) posé par le changement de semaine, lu et effacé par le rendu, comme l'entrée des fenêtres.
- Animation en jetons existants (`--ease-out`, durée de type `--t-screen`), sur `.week` seulement : titre et boutons restent fixes, la mise en page ne bouge pas.
- Le clic qui suit un balayage est ignoré (pas de créneau ouvert par erreur).
- Seuil exact, ampleur du glissement : réglés à l'essai sur la tablette (Playwright 1280×800 et 800×1280).
- Mise en ligne habituelle : tests, essai Playwright, `CACHE` +1, carte des gestes régénérée.
