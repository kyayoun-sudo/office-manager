# Recette et déploiement préparé

Le commit uploadé 8a5cd0e a créé une preview Vercel READY sur le projet existant office-manager-personal-pilot. La page et /api/health répondent. Le contrôle initial de /api/status échouait : OFFICE_MANAGER_ACCESS_TOKEN était limité à production. Sa portée a été étendue à preview sans lire ni changer sa valeur. Un nouveau déploiement est nécessaire pour prendre cette configuration en compte.

1. Charger le contenu du dossier correctif sur la branche fix/map-register-bridge-write en conservant les chemins. Aucun merge sur main.
2. Attendre la nouvelle preview automatique puis vérifier le rejet d’un accès sans token ou avec token invalide et consulter une mission autorisée via People Intelligence.
3. Le moteur office_mission_staffing_advice existe déjà dans Supabase : la correction applicative fonctionne sans appliquer de SQL. Ne pas appliquer l’ancienne livraison SQL : elle remplaçait le moteur récent par l’ancien matching.
4. Le nouveau db/people-intelligence.sql est un script transactionnel préparé, testé localement, sans données RH. Examiner et sauvegarder les définitions existantes avant toute application autorisée au projet actif. Il ajoute la conservation des exigences manuelles et des actions validées au moteur récent. Aucun SQL n’a été appliqué en ligne pendant cette correction.
5. Confirmer la recette interne avant toute décision de déploiement en production. Aucun scan Orpailleur, mouvement documentaire, appel IA, cron ou Edge Function n’est lancé pour tester cette livraison.

107 tests applicatifs passent ; le test PostgreSQL local valide le moteur, l’absence de pénalisation sans questionnaire, l’idempotence, les droits backend et la conservation des validations. Ces contrôles ne remplacent pas une recette avec mission réelle et accès autorisé.

Aucun nouveau projet, service payant ou abonnement n’est requis. Les profils et questionnaires ne sont pas dans le dépôt. Trois tables opérationnelles préexistantes (office_business_packs, office_mission_lifecycle_events, office_template_registry) ont des droits de lecture anon/authenticated avec RLS désactivée ; définir leurs politiques avec les usages existants avant de modifier ces droits.
