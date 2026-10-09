> Note de mise à jour : les limites de la Brique 3 décrites dans cette analyse historique sont remplacées par `docs/ORPAILLEUR_BRIQUE_03_COMPLETE.md` (lecteur 2.0.0).

# Orpailleur — analyse des briques 4 à 15 et livraison Brique 4

Branche cible : `feature/white-label-desktop`. Travail par lots, en étendant le dépôt actuel. Ce document distingue les propositions du texte, le code existant et le lot réellement livré. Les quinze briques ne sont pas toutes terminées.

## Verdict sur l'architecture proposée

La boucle CONNECT → READ → UNDERSTAND → SUGGEST → APPROVE → MOVE → VERIFY → LEARN est la bonne cible V1. Séparer lecture, compréhension, choix et autorisation permet d'expliquer les décisions et de tester chaque étape. Il n'est pas nécessaire de créer quinze services ni quinze nouveaux stockages : ce sont d'abord des responsabilités et des contrats.

La Brique 3 reste partielle : le lot précédent n'apporte pas encore une lecture exhaustive de tous les formats, ni un OCR vérifié page par page. La Brique 4 peut utiliser ses extraits, mais doit transmettre cette limite aux étapes suivantes.

## Corrections à apporter au texte

1. **Scores et pourcentages.** Les exemples 0,98 ou 97 % ne constituent pas des probabilités calibrées. Séparer qualité de lecture, présence d'une preuve, interprétation sémantique, proximité de destination et autorisation. Afficher les nombres observés avec leur dénominateur et les limites de l'échantillon. Une citation exacte prouve sa présence dans le texte, pas la justesse de l'interprétation.
2. **Règles et autorité.** INFERRED peut devenir STRONG statistiquement ; USER_CONFIRMED exige une confirmation humaine. Une accumulation de documents ne doit jamais activer des déplacements autorisés. L'autorisation est un objet distinct, limité à un Drive, une règle, des actions et une portée explicite.
3. **Placements existants.** Des documents déjà rangés constituent des observations, pas forcément de bons exemples. Exclure corbeille, mémoire, dossiers de test et conflits ; distinguer exemples validés et placements simplement observés. Ne pas apprendre en boucle de ses propres propositions non validées.
4. **Mouvements manuels.** Un changement de parent démontre un mouvement. Sans attribution fiable, son auteur reste UNKNOWN : il peut venir d'un utilisateur, de l'agent ou d'une autre intégration. Le scan seul ne permet pas de déclarer USER_CORRECTION.
5. **Similarité.** Commencer avec types, entités, références et exemples observés ; les embeddings sont facultatifs. Évaluer la portée des références : une même référence ne signifie pas toujours un doublon, et un doublon n'autorise jamais une suppression.
6. **Exécution.** Comparer les métadonnées actuelles aux préconditions, contrôler la destination et les collisions, réserver l'action, journaliser avant écriture, puis relire. Une lecture préalable ne supprime pas à elle seule la course avec une modification concurrente ; utiliser une précondition de version lorsque le connecteur le permet et conserver ce risque explicitement sinon.
7. **Reprise.** Après crash entre écriture et journal, vérifier d'abord l'état réel. Ne pas répéter aveuglément le déplacement. Une clé de décision doit comprendre la portée, le fichier, sa version et l'intention. Une réservation doit expirer et pouvoir être reprise.
8. **Mémoire.** Les quinze tables proposées ne sont pas un démarrage minimal pour ce dépôt. Réutiliser TIDY_STATE par Drive, le registre, la file d'actions, les décisions et le journal existants. Ne pas dupliquer chunks et texte dans une autre base.
9. **UX.** « Connect your Drive » est une bonne entrée. Montrer séparément découverts, lus, partiellement lus, profils établis, à revoir, proposés, exécutés et vérifiés. Un indicateur unique « compris » ne doit pas cacher une couverture partielle.

## Correspondance avec le dépôt et lots suivants

| Brique | Existant inspecté | Travail à faire / livraison |
|---|---|---|
| 4 Compréhension | `tidy-plan.js` mélangeait lecture sémantique et destination | **Livré dans ce lot** : étape indépendante, citations contrôlées, profils bornés et isolation de portée ; le choix de destination historique reste en place |
| 5 Structure | `firmStructure` dans `tidy-plan.js`, `firm-learning.js` | Profils de dossiers génériques fondés sur les documents réellement lus, couverture et échantillon ; hypothèses distinctes des règles humaines |
| 6 Relations | registre `file-index.js`, références et doublons possibles dans `tidy-plan.js` | Comparaison explicable de profils dans le même Drive, exemples validés, conflits et exclusion des données périmées |
| 7 Destination | dossiers existants fournis au planificateur IA | Candidats classés séparément, preuves par candidat, destination actuelle toujours présente, aucune création par défaut |
| 8 Décision | réglage `auto_filing`, contrôle lecture/confiance dans `tidy-plan.js` | Politique indépendante du score, règle humaine requise pour autonomie, abstention et conflits explicites ; seuils à calibrer |
| 9 Validation | `action-decisions.js`, file « À valider », `orpailleur-ask.js` | Choix d'un autre dossier, correction structurée, validation groupée avec liste exacte et versions ; préserver les propositions existantes |
| 10 Action | `action-executor.js`, `tidy-drive.js` | Préconditions périmées, collision contrôlée, destination vérifiée ; désactiver le nettoyage des dossiers vides par défaut |
| 11 Vérification | relecture après FILE_MOVE dans `action-executor.js` | Contrôle explicite de l'identifiant, nom et parents attendus, échec vérifiable distinct de succès, reprise après résultat incertain |
| 12 Mémoire | TIDY_STATE, journal, registre, `shadow.js` | Règles scoped, corrections vs exceptions, preuves positives/négatives, états conflictuels ; ne pas introduire une mémoire concurrente |
| 13 Runner | `agent-passes.js`, `startChangesPass` | Modes observer/proposer/assisté/autonome appliqués partout, file de lecture réservée, reprises atomiques et idempotence complète |
| 14 Traçabilité | `audit-log.js`, décisions et journal | Chaîne fichier/version → preuves → décision → autorisation → action → vérification, audit de portée sur chaque accès |
| 15 UX | `mise-en-service.html`, `parametres.html`, `rangement.html` | Présentation générique, étapes honnêtes, explication des suggestions et limites, choix dossier et portée d'une validation groupée |

## Écarts concrets à traiter dans les briques 10–14

Le chemin FILE_MOVE existant préserve deux versions lors d'une collision et relit le fichier après action. Il ne faut donc pas reconstruire ces fonctions. Cependant, ce chemin ne réalise pas encore le contrat STALE_DECISION attendu avant écriture. Le contrôle de collision peut actuellement masquer une erreur de recherche ; la variante de nom doit elle-même être contrôlée. Le contrôle après action n'exige pas explicitement que l'identifiant retourné égale celui demandé.

Le même chemin peut envoyer à la corbeille le dossier source devenu vide. C'est incompatible avec NO DELETE BY DEFAULT. Cet écart est identifié, mais l'exécuteur n'est pas modifié dans le lot Brique 4. L'autonomie historique n'est pas encore limitée à des règles humaines validées. Ne pas déclarer les briques 8, 10, 11 ou 14 achevées sur la base de cette livraison.

## Ce qui est implémenté pour la Brique 4

`document-understanding.js` reçoit les inspections et fait une requête IA par lot, au maximum 40 documents. Le nom et le chemin ne sont pas transmis comme preuves. Les champs sont bornés et limités à type, titre, sujet, organisations, personnes, dates, période, références, montants, thèmes, mots-clés et langue.

Chaque fait accepté doit citer exactement un chunk fourni. Les valeurs factuelles doivent figurer dans cette citation ; les dates restent sous leur forme originale, sans normalisation inventée. Le type, le sujet, les thèmes, les mots-clés et la langue sont explicitement des interprétations. Les pages et emplacements viennent exclusivement du lecteur, pas du modèle. Les citations elles-mêmes ne sont pas conservées dans le profil durable ; celui-ci conserve la référence de source, les positions et l'empreinte de l'extraction.

Les champs absents restent inconnus. Un échec IA produit UNDERSTANDING_FAILED. Des réponses contenant deux profils pour le même identifiant ne sont pas fusionnées arbitrairement. Les champs d'action ou de destination sont rejetés. Aucun profil ne modifie le Drive.

Le moteur exige une organisation et un dossier mémoire, et compare aussi connexion/utilisateur lorsqu'ils sont présents. Un document d'une autre portée est exclu avant envoi à l'IA. Cette vérification complète les accès du connecteur ; elle ne remplace pas l'authentification ni les contrôles de tous les autres modules.

Les profils sont transmis au planificateur existant et gardés dans le TIDY_STATE du Drive, sans nouvelle table. La lecture PARTIAL reste PARTIAL après compréhension. Le pourcentage de confiance est laissé inconnu ; le résumé est assemblé à partir des valeurs acceptées, sans résumé libre non sourcé.

## Limites du lot

- Vérifier la présence d'une citation ne prouve pas qu'une organisation est émettrice, destinataire ou propriétaire du document. Les rôles et l'interprétation sémantique demandent encore une validation.
- Un extrait court peut omettre une information importante. Aucun enrichissement n'annule les limites du lecteur.
- Le planificateur historique continue à produire les propositions de rangement ; le moteur séparé des briques 5–8 n'est pas encore construit.
- Une requête IA supplémentaire par lot a un coût et une latence. Tests locaux sans appel fournisseur réel ; permissions Drive et comportement des modèles restent à valider dans l'environnement connecté.

## Ordre de construction recommandé

Après la Brique 4 : construire 5–8 comme un lot cohérent de propositions explicables, sans autonomie nouvelle. Puis renforcer 9–11 pour la boucle validation → écriture → vérification. Ensuite compléter 12–14 pour apprentissage, continuité et traçabilité. Enfin simplifier la Brique 15 autour des comportements réellement disponibles.

La V1 sera validée sur un scénario avec documents témoins : connexion, scan, lecture, profils, compréhension des dossiers, arrivée d'un nouveau fichier, proposition, approbation, déplacement, relecture et correction réutilisable. Ajouter les cas décision périmée, collision, lecture partielle, conflit, crash et autre Drive. Les tests du dépôt seuls ne prouvent pas ce scénario réel.

## Installation du lot Brique 4

Après les ZIP briques 1–2 et Brique 3, extraire ce ZIP et uploader son contenu à la racine de `feature/white-label-desktop`, en conservant les chemins. Ne pas uploader le ZIP lui-même comme fichier source. Les changements communs à `tidy-plan.js` incluent les lots précédents.
