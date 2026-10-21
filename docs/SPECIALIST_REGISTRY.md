# Specialist Registry — V1

Couche additive. Aucun outil existant de Firm Manager, Mission Controller, Enhanced Auditor, Orpailleur, SIKA ou Shadow n’est remplacé ou redirigé. Les connexions déjà présentes continuent leur fonctionnement ; la règle du service central s’applique aux nouveaux spécialistes. Une migration globale des anciennes connexions serait un autre chantier.

## Parcours

Point de composition serveur de l’agent → `specialistRouter({orgId,agentKey,actor})` → `specialistService` → registre et permission explicite → approbation éventuelle → adapter → résultat structuré consultatif. L’identité de l’agent vient du serveur, jamais des arguments produits par l’IA ou du navigateur. Aucun adapter n’est ajouté aux outils actuels des agents dans cette version.

Les adapters MCP, REST, Hugging Face/local et internal sont des contrats fermés : ils échouent sans réseau ni chargement dynamique de code. Seul Mock fonctionne. Aucun champ endpoint, secret ou code arbitraire n’est accepté ou stocké. Un futur branchement externe doit être implémenté exclusivement dans cette couche et réexaminé pour les secrets, destinations autorisées, délais et données transmissibles.

## Administration et test

Paramètres → Admin → AI & Specialists → Specialist Registry (`/specialists.html`). Propriétaire, associé et administrateur informatique configurent les spécialistes et permissions. Seuls propriétaire/associé/manager peuvent approuver un appel côté service ; la page Admin reste réservée aux administrateurs.

Créer `mock-specialist`, compétence `mock.echo`, adapter Mock ; activer, autoriser Shadow, garder l’approbation obligatoire. Tester : un appel attend. Approuver puis exécuter le test approuvé : résultat simulé et journal. Refaire sans permission ou avec le spécialiste désactivé : refus journalisé.

L’approbation est à usage unique, liée à l’organisation, l’agent, le demandeur, la mission éventuelle, la compétence, l’empreinte de l’entrée et la révision du registre. Les appels concurrents utilisent une prise conditionnelle en base. Une panne après prise laisse l’appel `running` : aucun rejeu automatique d’un effet potentiellement déjà exécuté.

## Données et limites

`db/specialists.sql` ajoute trois tables, RLS activée sans accès navigateur. Toutes les lectures/écritures de service portent le filtre cabinet. Les permissions absentes refusent. Les résultats contiennent `authority: advisory_only`, `audit_conclusion: false`, `validation: false`, `sign_off: false`. Les données de documents et les entrées ne sont pas conservées dans le journal : identifiants et empreintes seulement. La V1 ne lit aucune pièce métier.

Les scores sont calculés sur les appels terminés présents dans la fenêtre des 100 derniers appels du cabinet : taux de succès technique et moyenne de confiance déclarée. Sans historique : non mesuré. Ils ne mesurent pas la justesse d’un jugement d’audit. Le Mock indique explicitement la simulation et une confiance artificielle de 0,5.

Les modifications du registre et les décisions alimentent l’audit existant. Chaque tentative autorisée/refusée a son état dans `specialist_calls`. Les changements sensibles exigent l’écriture du journal ; une indisponibilité ne devient pas une réussite silencieuse. Aucun fichier mémoire supplémentaire par spécialiste ou agent.

Tests : `tests/specialists.test.js` exécute le service sur PostgreSQL embarqué (PGlite), avec le vrai DDL : permissions, isolement, RLS/grants, approbation, altération de demande, concurrence, refus du réseau et scores.
