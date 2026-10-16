# Cabinet virtuel : preuves sur disque et recette métier

Ce complément s'appuie sur la première version du cabinet virtuel dans Entraînement. Il ne la remplace pas et ne modifie pas les agents, leurs instructions, leurs quotas ou les données de production.

## Lancer le laboratoire local (Node 20+)

```sh
npm ci
# Choisir un nouveau répertoire VIDE, réservé aux seules simulations.
node scripts/firm-lab.mjs init /tmp/office-manager-lab 500
# Une action, puis lecture après redémarrage du processus.
node scripts/firm-lab.mjs step /tmp/office-manager-lab 1
node scripts/firm-lab.mjs verify /tmp/office-manager-lab
# Fin de la première année seulement (mois 12 exclu).
node scripts/firm-lab.mjs step /tmp/office-manager-lab 500 12
# Reprise jusqu'à la fin du calendrier de référence.
node scripts/firm-lab.mjs step /tmp/office-manager-lab 500
node scripts/firm-lab.mjs population /tmp/office-manager-lab 2027
node scripts/firm-lab.mjs population /tmp/office-manager-lab 2028
node scripts/firm-lab.mjs pause /tmp/office-manager-lab
```

`init` prend un plafond global d'actions (500 par défaut). `step` prend un maximum d'actions pour l'exécution (1 par défaut) et une borne exclusive en mois (24 par défaut). Le plafond global ne se réinitialise pas au redémarrage. À la limite, la campagne est sauvegardée en pause avec `SIMULATION_ACTION_BUDGET_REACHED`. Pas d'appel IA : coût connu 0 USD, aucune consommation du quota Shadow. Ce lanceur n'est PAS un moteur d'exécution des agents IA.

Un autre seed est disponible via `new SimulationDisk(directory).initialize({ seed: 17, maxActions: 500 })`. Les scénarios comptables varient avec la graine et avec l'exercice ; cela ne constitue pas une mesure d'apprentissage.

## Fichiers réellement écrits

- `.simulation-only` : marqueur obligatoire ; refus d'initialiser un répertoire non vide.
- `blobs/<sha256>` : contenu immuable, incluant les propositions JSON, les checkpoints et les Excel. Chaque écriture est immédiatement relue et son empreinte contrôlée.
- `commits/<sha256>.json` : manifeste des productions de la campagne et du checkpoint.
- `HEAD` : pointeur publié par renommage atomique APRÈS écriture et vérification des fichiers. Une écriture interrompue avant cette publication ne modifie pas le checkpoint courant.
- `.lock` : exclusion mutuelle entre processus locaux. En cas d'arrêt brutal laissant ce verrou, vérifier qu'aucun processus n'écrit avant de retirer **uniquement** `.lock`. Aucun déverrouillage automatique susceptible de concurrencer un écrivain actif.

Aucun fichier métier n'est écrasé ; toutes les anciennes versions restent disponibles par empreinte. `verify` relit toutes les productions référencées par le manifeste. Les blobs de populations sont imprimés par `population` avec leurs empreintes ; ils ne sont pas injectés dans le contexte des agents et ne sont pas automatiquement rattachés aux missions de l'interface. Ce stockage local ne remplace pas la persistance de l'interface dans SHADOW_LAB.json. Les garanties couvrent la reprise après interruption de processus, pas une panne matérielle ni une suppression du sandbox éphémère : conserver une copie du répertoire pour une reprise durable hors session.

## Comptabilité fictive et contrôles

Chaque exercice génère 1 200 factures et 2 400 lignes de GL équilibrées, une balance et un Excel marqué SIMULATION. Les contrôles automatiques parcourent **toutes** les lignes : validité des dates, séparation d'exercice, rapprochements facture/GL, balance/GL et égalité débits/crédits. Trois anomalies sont introduites : une facture discordante, une date hors exercice et une date impossible. L'écart facture/GL change en deuxième année.

Le rapport distingue le contrôle de population complète, une sélection ciblée des exceptions, l'absence d'échantillonnage statistique et **zéro justificatif examiné**. Il ne prétend pas fournir une opinion d'audit. L'évaluateur indépendant est un module hors du contexte modèle ; son oracle mesure anomalies manquées/fausses alertes et comptages, pas la qualité du jugement ni des preuves. Aucun modèle n'a été appelé pour noter ces contrôles.

## Recette reproductible

```sh
node --test tests/firm-simulation*.test.js tests/procedure-work.test.js tests/procedure-review.test.js tests/review-workflow-regressions.test.js tests/app-router.test.js
npm test
```

La nouvelle recette métier appelle les fonctions **existantes** `saveConclusion`, `writeWorkpaper`, `submitProcedure`, `returnToPreparer`, `answerPoint`. Seuls le dépôt de données, le journal et l'adaptateur documentaire sont remplacés par des fixtures isolées ; le XLSX est réellement écrit et relu sur disque. Elle vérifie refus d'accès, soumission, retour, correction, nouvelle soumission et conservation de l'ancien fichier. Elle n'appelle pas Supabase, Drive, Gmail ni un fournisseur IA et ne crée aucune signature réelle.

## Ce qui a été exécuté pour cette livraison

- 36 tests ciblés passants (dont 7 nouveaux), incluant reprise, non-duplication, rejet de corruption, exclusion mutuelle, pause au budget, frontière d'exercice, lecture de 2 400 lignes par le lecteur de production, et retour/correction d'un WP Excel via les services existants.
- Lanceur local : création, arrêt à la fin de l'année 1, reprise jusqu'au mois 24 de **référence**, génération et contrôles des GL 2027 et 2028. Dans chaque exercice : trois anomalies attendues, zéro anomalie manquée et zéro fausse alerte pour le scanner déterministe.
- Suite complète `npm test` : 668 tests, 665 passent et 3 échouent dans `tests/document-location.test.js` (lignes 149, 168, 183). Les trois mêmes échecs ont été reproduits sur le commit de départ `10e67ef` dans un worktree séparé (14 tests, 11 passent, 3 échouent) : ils préexistent à ce complément et ne sont pas corrigés ici.
- Aucun appel IA ni envoi de message externe. Aucun changement d'abonnement, de droits, de secrets ou de production.

## Restant à livrer pour satisfaire le cahier des charges complet

Le parcours référence de la première version reste une orchestration simplifiée ; ses annonces PBC, paiements, charge et revue ne prouvent pas l'exécution des services correspondants. Cette livraison ajoute une recette de services réelle sur le sous-parcours WP, pas un branchement de tous les outils métier à la campagne.

Restent notamment : les six agents avec leurs vrais outils dans un tenant fictif, tous les contrôles de permissions métier dans ce tenant, l'échange PBC effectif et sa réception versionnée, les calendriers journaliers/congés et la résolution des conflits de capacité, les événements adverses avec conséquences sur les travaux, la facturation et le recouvrement par les services SIKA, la réutilisation contrôlée de vraies données de N-1 (pas seulement un lien), les scénarios d'évaluation tenus à l'écart, les leçons Shadow complètes/versionnées avec validation, les budgets monétaires des appels IA par période, et l'intégration des fichiers disque et de la prise de rôle humaine dans Entraînement.

**Les deux années de fonctionnement métier des agents ne sont pas validées.** Les résultats de référence ne sont ni une performance IA ni une preuve d'apprentissage. Aucun poids de modèle n'est modifié.
