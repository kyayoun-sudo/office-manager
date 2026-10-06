# Recette et déploiement préparé

## Étape 1 — suivi des demandes

La preview 296b1d52 est READY : health 200, accès agent/status sans token 401.
Le contrôle utilisateur complet du Grand Contrôleur après correction reste
à confirmer. Le nouvel endpoint GET /api/runs utilise le token pilote et
l'organisation serveur ; il affiche les vingt demandes de l'interface les
plus récentes, sans métriques ni erreurs techniques brutes.
Une demande running vieille de plus de six minutes est affichée comme fin
inconnue : cela ne signifie ni annulation ni absence d'effets.
Le suivi expose un résumé limité aux 1000 caractères déjà enregistrés.
La route racine vérifie maintenant son activation avant tout appel IA.
113 tests locaux passent. Aucun SQL, cron, scan Drive ou appel IA réel
n'est nécessaire pour publier le correctif.

Recette : charger les fichiers sur fix/map-register-bridge-write, ouvrir
la nouvelle preview, entrer le token habituel, cliquer Actualiser le suivi.
Pour valider une réponse réelle, envoyer une seule demande de lecture sur
Nova Services, puis vérifier la réponse et son résumé dans le suivi.
Cette dernière action utilise les fournisseurs IA configurés et reste une
recette utilisateur ; elle n'a pas été exécutée par l'agent.

## Correction du délai du Grand Contrôleur

Le test utilisateur du 6 octobre sur BLE TRANSIT a validé la consultation
People Intelligence. La demande au Grand Contrôleur a été interrompue après
60 secondes (journal Vercel confirmé), avant une réponse JSON.
Fluid Compute est déjà activé sur le projet Hobby. Le correctif porte uniquement
la limite de api/agent.js à 300 secondes, garde 60 secondes pour les autres
routes et charge le contexte racine en parallèle des contextes spécialistes.
L'interface traduit les réponses non JSON et délais dépassés en message lisible,
sans relance automatique ni affirmation qu'une action a été effectuée.

110 tests passent, dont les erreurs HTTP de la page. Le correctif doit être
publié sur la branche de preview puis testé. Aucun appel IA ou scan Drive
n'a été lancé pour le valider localement ; aucun abonnement n'a été changé.
La durée plus longue ne garantit pas la fin de toutes les demandes.
Documentation : https://vercel.com/docs/functions/limitations.

Le commit uploadé 8a5cd0e a créé une preview Vercel READY sur le projet existant office-manager-personal-pilot. La page et /api/health répondent. Le contrôle initial de /api/status échouait : OFFICE_MANAGER_ACCESS_TOKEN était limité à production. Sa portée a été étendue à preview sans lire ni changer sa valeur. Un nouveau déploiement est nécessaire pour prendre cette configuration en compte.

1. Charger le contenu du dossier correctif sur la branche fix/map-register-bridge-write en conservant les chemins. Aucun merge sur main.
2. Attendre la nouvelle preview automatique puis vérifier le rejet d’un accès sans token ou avec token invalide et consulter une mission autorisée via People Intelligence.
3. Le moteur office_mission_staffing_advice existe déjà dans Supabase : la correction applicative fonctionne sans appliquer de SQL. Ne pas appliquer l’ancienne livraison SQL : elle remplaçait le moteur récent par l’ancien matching.
4. Le nouveau db/people-intelligence.sql est un script transactionnel préparé, testé localement, sans données RH. Examiner et sauvegarder les définitions existantes avant toute application autorisée au projet actif. Il ajoute la conservation des exigences manuelles et des actions validées au moteur récent. Aucun SQL n’a été appliqué en ligne pendant cette correction.
5. Confirmer la recette interne avant toute décision de déploiement en production. Aucun scan Orpailleur, mouvement documentaire, appel IA, cron ou Edge Function n’est lancé pour tester cette livraison.

107 tests applicatifs passent ; le test PostgreSQL local valide le moteur, l’absence de pénalisation sans questionnaire, l’idempotence, les droits backend et la conservation des validations. Ces contrôles ne remplacent pas une recette avec mission réelle et accès autorisé.

Aucun nouveau projet, service payant ou abonnement n’est requis. Les profils et questionnaires ne sont pas dans le dépôt. Trois tables opérationnelles préexistantes (office_business_packs, office_mission_lifecycle_events, office_template_registry) ont des droits de lecture anon/authenticated avec RLS désactivée ; définir leurs politiques avec les usages existants avant de modifier ces droits.
