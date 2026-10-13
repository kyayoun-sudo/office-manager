# Notifications visibles et alertes limitées au périmètre

Demande : rendre les notifications visibles dans les interfaces Firm Manager, sans modifier les fonctions fondamentales des agents.

## Comportement

- La cloche quitte le pied du menu et apparaît en haut de l’espace de travail, avec le libellé Notifications et le nombre non lu.
- Panneau commun : Toutes, Non lues, À traiter ; dossier, contexte, date et lien d’action. La lecture ne clôture pas une tâche ni une validation.
- Marquer une alerte ou toutes comme lues ; lecture mémorisée sur cet appareil par cabinet et personne. Synchronisation entre onglets du même navigateur ; pas de synchronisation serveur entre appareils.
- Fermeture par bouton, clic extérieur et Échap, focus rendu à la cloche. Le panneau s’adapte à l’écran et défile sur mobile.
- Chargement, absence de notifications et erreur distingués ; dernières données conservées si une actualisation échoue, avec bouton Réessayer.
- Actualisation à l’ouverture, au retour dans l’onglet et toutes les 30 secondes si visible. Pas de transport push, de son ou de notification système ajouté.

## Données et droits

Le service existant est réutilisé. Ajout des actions en attente et messages internes récents aux alertes déjà disponibles. Le compteur À valider utilise le résultat filtré du service et ne relit plus la file globale depuis la cloche.

Le staffing courant détermine le périmètre des non-associés, y compris Managers et superviseurs. Une erreur de lecture du staffing n’autorise jamais une vue globale. Documents sans rattachement prouvé exclus pour ces utilisateurs ; aucun rapprochement par sous-chaîne d’identifiant.

Owner/Partner conservent la vue globale de missions. Un message privé d’autrui reste exclu même pour eux. Les groupes exigent une appartenance et les questions du personnel suivent le périmètre des personnes autorisées. Les tâches d’opportunité et de veille réutilisent leurs destinataires métier existants.

Les alertes proviennent des enregistrements existants. Aucun nouveau rôle Finance/externe, moteur de dépense, workflow, transfert de document ou changement de charte d’agent n’est créé par ce lot. Les liens conservent les contrôles des pages cibles ; les autorisations de ces pages ne sont pas élargies.

## Vérification locale

575 tests du dépôt passent, dont huit nouveaux tests : périmètre Manager, Owner/travailleur, erreur de staffing/session absente, identifiants exacts, messages privés et groupes, notifications personnelles, questions de rapports directs, classification/déduplication.

Recette navigateur avec données fictives et le composant JavaScript/CSS modifié : filtres, lecture individuelle/globale, persistance après recharge, changement de personne/cabinet, erreur/reprise, clavier, clic extérieur, clic sur l’icône, absence d’erreur JavaScript, dimensions ordinateur et mobile. La recette a détecté et corrigé un clic de filtre interprété comme extérieur après remplacement du contenu.

Pas de connexion Drive/Gmail/IA réelle ni de déploiement pendant cette intervention. Les routes existantes sont conservées et aucune migration SQL n’est nécessaire. Les captures montrent le composant réel dans un écran de recette locale, pas une session de production.
