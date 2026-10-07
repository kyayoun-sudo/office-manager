# Budget de mission — intégration sur la branche Codex

Branche : `fix/map-register-bridge-write`. Aucun changement de branche vers Claude.

## Fonctionnement

Le Mission Controller dispose de `prepare_office_mission_budget` : il enregistre une proposition privée à partir du dernier programme rattaché au plan approuvé. Les tâches doivent toutes être couvertes. Les affectations doivent avoir un statut `confirmed`, `approved` ou `validated` ; les noms sont résolus dans l'annuaire interne. Les heures sont explicites, jamais déduites du pourcentage d'affectation. Un taux absent reste inconnu et bloque la validation. Un taux renseigné, même nul, demande une source.

Dans le dossier de mission, ouvrir « Préparer le budget de mission ». Charger la mission : la dernière proposition compatible préremplit les heures et taux. Vérifier ces valeurs, la devise et le dossier Drive lié à la mission dans l'inventaire. Préparer puis valider le budget. La validation enregistre une décision sans écrire dans Drive. Télécharger le classeur ou cliquer explicitement sur « Créer et classer le classeur dans la mission ».

La création revérifie le plan, le programme, les affectations et les données du budget ; un changement exige une nouvelle revue. Le relais vérifie la décision, le périmètre du cabinet, le lien du dossier à la mission et le classement après création. Une réservation unique en base interdit deux créations concurrentes. Aucun fichier existant n'est remplacé.

## Classeur et confidentialité

Cette première version génère **un nouveau classeur vierge**, avec Mission, Équipe, Plan de travail et Budget Audit. Elle ne copie pas les onglets, les références RH, les clients fictifs ou les valeurs de l'ancien classeur d'exemple. L'identifiant du modèle est une référence de traçabilité ; le moteur ne reproduit pas sa mise en page ni ses autres onglets. Les valeurs du budget sont calculées depuis les heures et taux revus. Les heures réelles sont vides ; les écarts globaux restent vides tant que toutes les lignes ne sont pas renseignées.

Le modèle d'origine reste intact. Son rangement dans la bibliothèque de modèles demeure une opération séparée d'Orpailleur : cette intégration n'a déplacé aucun fichier réel. Le classeur de mission contient nécessairement les noms de l'équipe confirmée et ses taux : il reste dans le Drive privé et n'est jamais ajouté au dépôt. Les propositions, décisions et réservations sont privées, protégées par RLS et réservées au serveur. Les routes de revue, téléchargement et publication demandent les droits du propriétaire. Tous les tests utilisent des données synthétiques.

## Préparation de mise en service

1. Appliquer `db/mission-budgets.sql` dans Supabase après revue. Ajout de trois tables ; aucune table métier existante modifiée.
2. Déployer ensemble les fichiers de `supabase/functions/taty-google-bridge/`, dont le nouveau `mission-budget-files.ts`, en conservant l'authentification actuelle. L'action `create_mission_budget` est nouvelle et n'est pas disponible sur le relais actuellement déployé.
3. Déployer une preview **de notre branche** contenant cette intégration. Ne pas écraser la production de la branche Claude.
4. Tester avec une mission synthétique, un plan approuvé, un programme, une équipe confirmée, des heures/taux validés et un dossier de mission inventorié. Contrôler le fichier réellement créé et son parent.

Une réservation reste conservée en cas d'échec après réservation : ne pas la supprimer pour relancer sans vérifier auparavant si le classeur existe réellement. Cette récupération est volontairement manuelle pour éviter les doublons.

Aucune migration, création de fichier réel, souscription ou mise en service n'a été effectuée pendant cette intégration. Le scheduler, les horaires, Sika et le Grand Contrôleur ne sont pas modifiés. Le rangement du modèle reste traité par Orpailleur ; la préparation du budget relève du Mission Controller ; les taux/heures et la création restent validés par le propriétaire.

## Vérification

`node --test tests/*.test.js`
`node tests/verify-mission-budgets-sql.mjs`
`node tests/verify-programme-sql.mjs`

Les tests couvrent les données sources périmées, les taux absents, les décisions, le calcul du classeur, les cellules de réel vides, le hash stable après passage JSONB, les créations concurrentes, le périmètre Drive, le contrôle après écriture, les droits SQL et l'idempotence du schéma. La publication réelle reste à tester après mise en service.

## Complément — validations de l'étape 3

Le budget utilise désormais `office_mission_team_versions` approuvée et le programme approuvé avec cette équipe, au lieu de déduire une approbation des lignes existantes du planning. Référence : docs/MISSION_REVIEWS.md. L'identifiant d'allocation fourni au moteur est le staff_profile_id dans cette équipe ; la version et son empreinte sont conservées dans le budget et revérifiées avant création. Il faut appliquer db/mission-reviews.sql et mettre à jour le relais avant la recette. Les validations ne modifient pas office_mission_assignments.
