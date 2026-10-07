# Comparaison des contributions Claude / Codex — 7 octobre 2026

Lecture GitHub du 7 octobre : contribution Claude `feature/white-label-desktop` à `ef6a6f2c` ; notre branche distante `fix/map-register-bridge-write` à `6b369e6d` ; notre base locale à `9caa86d` avant cette note.

## Ajouts de Claude après notre première intégration

- Horaires et journal des passages : `lib/schedule.js`, `lib/agent-passes.js`, SQL du scheduler et réglages dans Paramètres. Transmission des besoins entre Orpailleur et Grand Contrôleur ; passage hebdomadaire de Sika.
- Renommage fondé sur le contenu, annulation et signalement des périodes contredites par le nom. Renommage ambigu proposé au responsable.
- Coordination et indicateurs d'équipe : page Équipe, faits de travail, couverture des données, accès individuel et managers, journal de consultation ; pas de classement RH.
- Campagne d'entraînement de cinq jours, scénarios synthétiques, examinateur Claude et leçons réutilisées ; nettoyage limité au périmètre d'entraînement, sur ordre.
- Page Mise en service : vérifications de dépendances et revue de la cartographie ; installateur SQL groupé.
- Messages internes approuvés puis envoyés via Gmail ; lecture des pièces PBC limitée à un libellé Gmail, dépôt après approbation et mapping validé.
- Exécution de certaines décisions internes ; relance client transformée en proposition au chef de mission.
- Corrections de sécurité : décision liée au contenu vu, accès manager vérifié, protection contre les doubles envois, contrôle du libellé avant dépôt.
- Reprise de nos premiers correctifs d'inventaire et mémoire migrée. Ce dernier point est une intégration de notre travail, pas une nouvelle fonction indépendante.

Sources : historique GitHub et `docs/POUR_CHATGPT.md` de sa branche ; lecture supplémentaire du code `lib/schedule.js`, `lib/agent-passes.js`, `lib/action-executor.js` et du rapport de test Drive.
La passation annonce 216 tests réussis. Nous n'avons pas rejoué sa suite pendant cette comparaison. Notre suite locale : 201 tests réussis lors de l'intégration du budget.

## Réserves avant toute reprise

Le scheduler de Claude a par défaut Grand Contrôleur 09:00/16:00, Sika vendredi 09:00, enabled=false. Paul a fixé Grand Contrôleur 07:00 GMT et Sika le lundi. L'heure de Sika n'a pas été confirmée. Orpailleur reste 08:00/12:00/20:00 GMT. Aucune activation n'est impliquée par cette inspection.

Ses nouvelles fonctions ne sont pas encore intégrées à notre branche locale. Sa passation demande de publier sur sa branche : cette demande ne remplace pas l'instruction directe de Paul de maintenir notre branche comme référence.

Les horaires, Gmail, entraînements et exécutions doivent être vérifiés après raccordement, avec leurs autorisations et prérequis. Code construit et test factice ne prouvent pas un passage réel. L'entraînement avec agent et examinateur peut consommer des appels IA : ne pas lancer sous la contrainte actuelle sans dépense. Aucun e-mail envoyé ni campagne lancée pendant cette inspection.

Le rapport Drive de Claude précède nos corrections de lecture, racine et relais ainsi que le regroupement de la mémoire. Ses anomalies ne sont pas un nouvel état live vérifié aujourd'hui. Le contrôle de cartographie complète et de validation propriétaire reste nécessaire.

## Problème de publication réellement constaté

Le commit distant `6b369e6d` contient bien les 15 fichiers du budget. Cependant, l'arbre distant ne contient pas plusieurs dépendances nécessaires :

- `lib/branding.js`, `lib/action-decisions.js`, `lib/mission-programmes.js`, `lib/app-users.js`, `lib/agent-persona.js`, `lib/tidy.js` ;
- `assets/screens.js`, `assets/brand-theme.js` ;
- `programme.html`.

Ces fichiers sont présents dans notre base locale complète et leur fonctionnement local a été testé. L'archive de mise à jour du budget seule ne pouvait pas restaurer les publications précédentes manquantes. Ne pas déclarer la branche GitHub prête à déployer sur la seule présence de budget.html. Préparer une archive complète, conserver les chemins et vérifier de nouveau le dépôt après chargement.

## Prochain jalon de notre feuille de route

1. Restaurer la base complète sur notre branche ; vérifier les dépendances et construire une preview cohérente avant toute promotion.
2. Compléter l'étape 3 : propositions d'équipe, rôles et allocations, décision persistante sur le programme exact et version source. L'approbation du plan ne vaut pas approbation du programme ni affectation.
3. Recette synthétique de l'étape 4 : plan → programme → équipe confirmée → heures/taux revus → budget validé → dossier de mission. Vérifier le fichier réel après mise en service autorisée.
4. Terminer l'étape 5 : inventaire complet, lecture, revue de cartographie, rangement réel vérifié. Intégrer le renommage de Claude en conservant notre relais, notre lecture du contenu, notre détection des fichiers racine et les possibilités d'annulation.
5. Reprendre ses contributions horaires et coordination quand ce socle est stable ; les horaires doivent reprendre les choix de Paul et rester désactivés jusqu'à une recette contrôlée.
6. Étape 6 : messages et pièces reçues avec sessions individuelles, approbations exactes, idempotence et droits Gmail ; ensuite étape 7 Sika et étape 8 recette globale.

Cette inspection n'a intégré ni exécuté les nouveaux modules de Claude. Elle a préparé le rétablissement de notre base de publication et identifié le prochain travail produit. Aucun schéma, secret, permission Drive ou déploiement modifié.
