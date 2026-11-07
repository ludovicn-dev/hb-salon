# H&B Salon — Appli fiche client (v1)

Appli web installable (PWA) sur la tablette Samsung du salon. Design : modèle « Élégance »
(bleu nuit #161D33, or rose #E3B59C, Cormorant Garamond + Manrope).
Maquettes : https://claude.ai/artifact/4HnJfspaKf4fw7f9TrdCSM

## Parcours
1. **Espace coiffeur** (protégé par PIN 4 chiffres) : rechercher un client (téléphone ou nom) ou en créer un,
   cocher les prestations du jour, formule couleur, note interne, photos.
2. **Passer la tablette** : la visite est enregistrée dès ce moment.
3. **Écran client** : vérifie ses prestations, complète prénom / nom / téléphone / e-mail (facultatif),
   coche le consentement RGPD, valide. Retour auto à l'accueil après 2 min d'inactivité.
   Revenir à l'espace coiffeur exige le PIN.
4. **Agenda** (espace coiffeur, bouton « Agenda ») : semaine du lundi au samedi, 8 h 30 – 18 h. Un appui sur un créneau libre
   ouvre la prise de rendez-vous : téléphone (ou nom) du client, fiche trouvée ou créée avec juste le prénom, prestations,
   durée ajustable par quart d'heure. Un rendez-vous se modifie, se déplace ou s'annule. À l'ouverture de l'espace coiffeur,
   les rendez-vous du jour ; un appui ouvre la fiche avec les prestations prévues cochées.

## Règles
- Un seul coiffeur pour l'instant (pas de choix de coiffeur).
- Une fiche par personne ; le téléphone est facultatif et peut être partagé (parent/enfant).
- Pas de prix, pas d'avis/étoiles, pas d'envoi de messages en v1.
- Prestations : Coupe & coiffage, Coloration, Lissage, Soin, Barbe, Massage, Visagiste, Diagnostic.
- Formule couleur : marque, nuance, oxydant, temps de pose + « reprendre la dernière formule ».
- Allergies / sensibilités : saisies par le coiffeur (fiche client).
- Photos : 1 à 3 par visite, côté coiffeur.
- Consentement RGPD : proposé au client mais **pas obligatoire** pour valider. **Sans accord, rien n'est conservé** :
  après confirmation, la fiche du client, ses visites et ses photos sont effacées.
- Code PIN oublié : code de déblocage à 8 chiffres, connu de la seule personne qui a installé l'appli ; il permet de choisir un nouveau PIN.
- Historique : le coiffeur peut **modifier ou supprimer** une visite passée.
- Rendez-vous : pas de chevauchement, fin à 18 h au plus tard. Un rendez-vous garde une copie du prénom et du téléphone.
  Sans accord RGPD, il reste sur la tablette ; si le client refuse l'accord, ses rendez-vous passés sont effacés
  et ceux à venir restent sur la tablette seulement, puis en sont effacés une fois leur jour passé.

## Données
- Hors-ligne d'abord : tout est enregistré sur la tablette puis synchronisé quand le réseau revient.
- Stockage en ligne : Supabase (gratuit), compte au nom du coiffeur (responsable RGPD). Seules les fiches avec accord partent
  en ligne ; une fiche effacée faute d'accord l'est aussi en ligne. Connexion au compte depuis la fenêtre « Sauvegarde ».
- Export : bouton « Exporter » (Excel/CSV) dans l'espace coiffeur.
- Pas d'import : on part de zéro.
