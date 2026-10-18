# Programme de travail à partir des écrits — 17 octobre 2026

Travail sur `feature/white-label-desktop`, sans modification de main ni suppression de fonctionnalités. L’interface programme existante est conservée ; pas de nouvelle page.

## Ce qui est ajouté

- Dans « Importer votre programme » : lien des écrits Word/plan, deux liens complémentaires possibles (revue analytique, compte rendu), et une zone de discussion. Le nouveau bouton propose/ajuste le programme à partir de ces écrits, même sans codes. L’ancien import déterministe par codes et le choix manuel des cycles restent disponibles.
- `lib/programme-planning.js` : appel au routeur IA existant, instructions communes d’assistance Mission Controller/Enhanced Auditor, bibliothèque du cabinet et sources sélectionnées. Aucun outil d’action n’est offert au modèle. Les contenus documentaires sont explicitement des données, jamais des autorisations.
- Couples SOP/code contrôlés côté serveur. Chaque rapprochement exige un extrait exact présent dans une source réellement lue et une justification. Les codes inconnus ou citations fabriquées sont écartés et deviennent des points à décider. L’origine distingue décision exprimée/source et complément suggéré par l’IA. Cette classification reste une proposition sémantique à revoir, pas une preuve automatique de décision humaine.
- Les cycles déjà choisis, affectations, tailles d’échantillon et décisions manuelles sont conservés lors d’une analyse complémentaire. Pour un nouveau cycle, les procédures CORE de la bibliothèque restent proposées selon le fonctionnement existant. Les compléments IA ne sont pas automatiquement activés.
- Chaque rapprochement comporte une case d’examen et une justification humaine obligatoire. Les questions ouvertes demandent une réponse avant validation. Le serveur enregistre le compte connecté comme réviseur ; un nom envoyé par le navigateur ne suffit pas.
- La provenance et les réponses sont stockées dans les JSON existants `cycles`, avec références/version/hash du texte lu, courts extraits, justification, identité du modèle et version des instructions. Pas de copie complète du Word dans la base, pas de mémoire parallèle.
- Les sources sont revérifiées à l’enregistrement, à la validation et à l’export. Un changement de version ou de contenu invalide la poursuite et demande une nouvelle analyse/revue. Pour un Manager/Superviseur, le fichier doit se trouver sous le dossier de CETTE mission (parenté vérifiée) ; les Partner/Owner peuvent sélectionner une source accessible au cabinet. La mission et les droits d’édition restent vérifiés côté serveur.
- La sauvegarde issue de la nouvelle interface vérifie le programme/timestamp ouvert et refuse une page périmée. La validation envoyée par l’interface cible le brouillon effectivement sauvegardé. Les contrôles conditionnels empêchent d’approuver silencieusement une version concurrente. Les anciens clients sans ces nouveaux champs gardent leur compatibilité ; ce n’est pas une transaction SQL globale.

## Document validé dans le Drive

`lib/programme-document.js` produit un Word lisible, avec mission, version, validateur, matérialité, revues, cycles, procédures retenues/non retenues, affectations, justifications et provenance.

Après validation, le programme est exporté dans le dossier de mission déjà configuré. Nom par mission/version/empreinte ; les fichiers antérieurs sont conservés. Reprise par nom déterministe, parent et SHA-256 relus. La référence vérifiée est attachée dans `materiality.programme_document` (JSON existant). Un verrou distribué existant sérialise l’export d’une mission. La création des Working Papers par cycle demeure le parcours existant et est toujours lancée par l’interface après validation.

Si l’export échoue, le programme reste validé dans l’application, mais l’interface indique « document en attente » et offre un bouton pour relancer. Le document ne certifie jamais que les procédures ont été exécutées. Il s’agit d’un export standard généré, pas encore du remplissage du modèle Word officiel du cabinet.

## Vérifications

- Neuf nouveaux tests métier : écrits sans codes, revue bloquante et identité authentifiée, codes/citations fabriqués refusés, permissions IA et accès mission/cabinet, sources modifiées, conservation des choix existants, export/reprise sans écrasement, lecture réelle d’un DOCX synthétique avec Mammoth, refus de sauvegarde depuis une page périmée.
- Recette Chromium sur la véritable page programme + service réel + fournisseur IA et stockage simulés : analyse → revue → sauvegarde → validation → Word exporté et vérifié → appel du parcours existant de création des WP. Le dernier appel WP est simulé dans cette recette ; ses tests existants couvrent séparément la génération des fichiers. Capture de données fictives : `/workspace/output/programme/programme-valide.png`.
- Les tests existants du programme, de la méthodologie, des WP et des permissions sont conservés. `npm test` : **695 tests, 695 réussites, aucun échec**. Contrôles syntaxiques et `git diff --check` réussis.
- Aucun document client modifié, aucun appel à un fournisseur IA réel, aucune migration Supabase distante effectuée pour cette recette.

## Configuration et limites à connaître

- Il faut une méthodologie du cabinet réellement chargée, une IA configurée et l’autorisation existante du cabinet pour lecture/appels IA. Le code réutilise les fournisseurs existants ; il n’introduit pas un nouveau SDK ni une migration des fournisseurs. Sans IA, le parcours manuel et l’import par codes restent utilisables.
- Les sources sont des liens vers des documents déjà déposés dans le Drive/stockage autorisé. Aucun nouvel uploader n’est ajouté à cette page. Pas de recherche automatique dans tous les dossiers ni de récupération automatique de toutes les réunions/revues analytiques.
- Trois documents maximum par analyse, lecture limitée à 40 000 caractères chacun ; une lecture partielle est affichée. Dix références documentaires distinctes maximum dans les rapprochements sauvegardés. Bibliothèque limitée à 1 200 procédures par appel ; au-delà, le parcours manuel reste disponible, un ciblage de bibliothèque reste à construire.
- Le Word original reste intact. La discussion alimente des propositions et décisions dans le même programme ; ce n’est pas encore une messagerie multi-utilisateur ni un historique complet de conversation. Si aucune correspondance n’est possible, les questions sont affichées ; elles ne remplacent pas une procédure officielle à créer dans la méthodologie.
- Pas de deux analyses IA indépendantes : une préparation commune spécialisée, revue par l’humain. Aucun travail GL, échantillonnage, remplissage de WP ou opinion exécuté par cette nouvelle analyse.
- Les permissions du cabinet existantes sont vérifiées avant l’appel externe. Cela ne constitue pas l’achèvement de la gouvernance fournisseurs/catégories de données de l’autre chantier responsable-IA, resté séparé.
- L’export nécessite les RPC déjà fournies dans `db/inspection-reader-leases.sql` (installation complète existante). Sans elles, l’export reste en attente ; aucune nouvelle table/colonne ni nouveau SQL requis.
- La pertinence des rapprochements avec les véritables SOP et les modèles du cabinet doit être évaluée sur une mission pilote. Les tests techniques avec un fournisseur simulé ne prouvent pas la qualité d’un modèle réel ni l’exhaustivité de la couverture d’audit.
