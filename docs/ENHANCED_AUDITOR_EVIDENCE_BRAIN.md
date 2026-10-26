# Enhanced Auditor — compréhension et sélection des preuves

Cette extension part de `feature/white-label-desktop` (`01edfc4`), qui possède déjà le moteur d'ordres de remplissage (`fill-orders.js`) et le cerveau commun (`agent-brain.js`). Elle complète la revue et l'écran « Ma procédure », sans remplacer le remplissage ni ses confirmations.

## Parcours branchés

- Une revue démarre par `knowledge` : lecture de trois documents par passage, enregistrement d'une fiche `audit_read` dans le registre **existant** de la mission, reprise jusqu'au dernier document. Les noms et rôles ne décident pas de la pertinence. Une erreur de lecture reste visible et n'est pas une lecture réussie.
- `executeMissionWork` transmet le SOP courant, les instructions et cellules réellement lues du working file, l'échantillon humain et le catalogue à `reasonAuditProcedure`.
- Le cerveau commun reçoit un catalogue fermé d'actions : lire une pièce de la mission, préparer les étapes sourcées, comparer une ligne aux pièces choisies et déjà lues, scanner la population rattachée, parcourir le reste du catalogue.
- Les résultats et refus reviennent au modèle au tour suivant. Aucune étape d'audit n'est inventée comme solution de repli par le code si l'IA ne répond pas.
- Dans « Ma procédure », **Préparer avec les pièces de la mission** appelle le même moteur pour la seule procédure ouverte. Les propositions sont conservées côté serveur ; les pièces proposées peuvent être confirmées avec le rattachement existant. Cela ne décide ni PASS/EXCEPTION ni d'une conclusion.
- Le rapport de revue montre le plan, ses références SOP/WP, les questions, refus, erreurs et limites du passage.
- Les fiches `audit_read` sont aussi exposées à la mémoire partagée d'Enhanced Auditor et au remplissage existant. Les profils corrigés par les humains sont conservés.

## Limites explicites

La fiche est une compréhension IA sur les passages transmis, **pas une certification de lecture exhaustive**. Lecture texte bornée à 30 000 caractères ; pièces visuelles transmises via le lecteur existant. Les citations textuelles conservées doivent être présentes dans le texte ; une lecture visuelle demande une vérification sur la pièce. Les cellules du working file sont données jusqu'à 120 lignes, 30 colonnes et 25 feuilles, avec indication de lecture partielle. Le lecteur exhaustif SOP existant reste disponible pour les travaux qui l'exigent.

Catalogue paginé par 30 pièces ; 4 tours maximum par procédure, 8 ordres par tour ; comparaison limitée explicitement à 6 pièces à la fois. Une limite atteinte est exposée. Les images et tableaux ne permettent pas à l'IA d'exécuter du code arbitraire. Les calculs de population restent ceux du moteur existant.

Les lectures réutilisées ont une révision connue ; un fichier modifié est relu. Les pièces sélectionnées sont revérifiées avant et après comparaison, par révision et, si la révision est inconnue, par empreinte du contenu lu. Aucun document extérieur au catalogue de la mission ne peut être sélectionné par ces actions.

L'autorisation de lecture et d'IA du cabinet est exigée. Le parcours interactif vérifie aussi les droits de la personne et refuse les travaux soumis ou revus. L'échantillon, les résultats humains, les liens de preuve déjà confirmés, les conclusions et les signatures ne sont pas remplacés par les propositions.

## Validation et mise en service

`tests/audit-evidence-brain.test.js` couvre la lecture d'un document mal nommé, la mémoire par version, la boucle lecture/sélection/comparaison/retour, les références SOP/WP, les fichiers hors mission, les changements de source, les pannes IA, la pagination, le parcours de revue, l'action interactive et les lots repris.

Ces tests injectent une IA et un Drive simulés. Ils prouvent le branchement et les garde-fous, pas la qualité d'interprétation d'un modèle réel. Aucun appel payant à une IA, essai dans le Drive du cabinet ou changement de production n'est inclus dans cette validation.

Après fusion, tester l'aperçu avec un vrai SOP, un working file et des pièces renommées arbitrairement ; vérifier le plan, les sources, les refus et une pièce modifiée. La promotion du déploiement reste distincte de la livraison du code.
