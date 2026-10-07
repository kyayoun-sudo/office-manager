# Étape 3 — décisions sur les plans de mission

2026-10-07. Branche de travail et publication : `fix/map-register-bridge-write`.
Les ajouts de Claude et cette étape sont intégrés à notre base locale c6c6b29.
Branche de contribution inspectée : feature/white-label-desktop, base fcbccc86.

## Comportement

Depuis À valider → Plans de mission, ou le dossier de mission : consulter le
texte complet et les phases de la dernière version. Un propriétaire ou associé
gérant peut approuver, reporter ou refuser (commentaire obligatoire au refus).
La case de relecture et la décision concernent cette version précise.

Les décisions sont conservées dans `office_mission_plan_decisions`. L'identifiant
et l'empreinte de la version proviennent de la base, jamais d'un texte recomposé.
Une nouvelle version n'hérite d'aucune décision. Le serveur refuse une version
dépassée ou une décision prise à partir d'un historique devenu obsolète. Un
identifiant de requête permet de récupérer un résultat après une réponse réseau
perdue sans enregistrer la même décision deux fois.

Ce journal ne modifie ni `office_action_queue`, ni les affectations, ni le
programme d'exécution. Aucun e-mail, déplacement, appel IA ou passage d'agent.
Le journal des actions de Claude conserve son comportement existant.

## Accès et limites

GET `api/app?route=plan-decisions&mission_id=…` : code pilote, organisation fixée
par le serveur. POST : code pilote **et** code propriétaire. Les comptes owner /
partner reçoivent ce dernier via la connexion déjà ajoutée par Claude.
La table a RLS et aucun accès anon/authenticated. Le backend a SELECT et le RPC
restreint `office_decide_mission_plan`, aucun INSERT/UPDATE/DELETE direct.
Le RPC SECURITY DEFINER a un search_path fixe et vérifie le tenant/version/hash.

Le secret propriétaire est partagé : le journal atteste un accès propriétaire,
pas l'identité personnelle du décideur. Une identité serveur par utilisateur
reste une étape distincte ; aucun nom fourni par le navigateur n'est présenté
comme une identité vérifiée. Historique affiché : 20 versions, 50 décisions par
version, avec limites signalées. Le programme et l'équipe ne sont pas approuvés
par l'approbation de ce plan.

## Préservation du projet

Aucun fichier présent dans la base `3e567eb` n'est modifié. Seuls les ajouts de
Claude `api/app.js`, `mission.html`, `validations.html` et son test de routes sont
étendus. Les autres fichiers de cette étape sont nouveaux. Toujours 10 fonctions
dans api/ ; aucune nouvelle Edge Function ou tâche planifiée.

## État vérifié

- Nouveaux tests Node : 5/5 ; tests de routes : 2/2.
- Suite intégrée dans notre branche : **169 tests, 169 réussis**. Notre test
  browser-response.test.js correct est conservé. Le précédent résultat 162/163
  concernait la copie de la branche de Claude, où ce fichier différait déjà.
- PGlite : migration rejouée, versions indépendantes, empreinte, isolation,
  refus des décisions obsolètes, retries, droits et absence d'écriture dans la queue.
- SQL comptes/marque/journal d'actions et plans existants : vérifications réussies.
- Supabase : migrations ajoutées et droits vérifiés. Test RPC annulé par rollback ;
  zéro décision permanente sur Nova et aucun compte créé.
- Tables de Claude nécessaires à la connexion et au menu installées :
  office_app_users, office_org_branding, office_action_decisions. Aucune donnée RH
  ou réponse au questionnaire exportée. Les tables persona/tidy restent à préparer.
- Interface testée localement avec données synthétiques et décision « Reporter ».
  Ce test ne prouve pas encore la connexion et la validation dans Vercel.

## Publication et recette restantes

Charger le lot intégré en conservant les dossiers sur **fix/map-register-bridge-write**.
GitHub non publié par l'agent, aucune promotion en production.
Le secret OFFICE_MANAGER_OWNER_TOKEN cible actuellement production seulement.
Son extension à preview a été refusée par la revue automatique faute d'accord
explicite. Attendre l'accord de Paul pour changer cette portée, sans lire ni changer
la valeur. Un nouveau déploiement preview devra ensuite consommer ce réglage.

Dans le nouvel aperçu : login.html → Première configuration du cabinet ; Paul
saisit son code propriétaire et crée son propre compte. Puis Missions → Nova →
Lire le plan et voir les décisions. Relire la version 1, décider, rouvrir le
dossier et vérifier l'historique. La version réelle reste à valider par Paul.

Les advisors signalent INFO « RLS sans policy » pour les tables backend seules,
volontaire avec grants publics révoqués. Les alertes héritées sur les anciennes
vues SECURITY DEFINER, trois anciennes tables sans RLS et normalize_office_action_states
ne sont pas corrigées par cette étape additive. Voir les règles de sécurité :
https://supabase.com/docs/guides/database/database-linter .

Après cette recette : étape 4 de notre feuille de route, détailler le programme
de mission et les responsabilités à proposer, puis les faire valider séparément.
