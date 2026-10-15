# Préparation intelligente de l'indépendance et des conflits

Correction ciblée de `feature/white-label-desktop` issue de l'essai du 15 octobre.

- Les honoraires impayés, relations d'affaires du cabinet, services antérieurs et responsabilités de gestion sont préparés une seule fois sur preuves internes. Les informations manquantes sont demandées au responsable KYC désigné, sinon à un responsable habilité du dossier.
- Les intérêts et liens personnels restent déclarés et certifiés par chaque personne. La certification ne renseigne plus les lignes communes à partir des réponses personnelles.
- La recherche publique demande les noms complets des dirigeants, leurs fonctions et les preuves datées, en distinguant les homonymies et les fonctions non confirmées.
- La préparation reçoit les réponses existantes et les missions du cabinet pour comparer les noms connus. Cette comparaison est limitée aux données fournies : elle ne remplace pas un registre complet de personnes liées.
- Les cotations IA restent des propositions sourcées visibles dans le classeur applicatif et les questions du manager. Elles ne sont jamais écrites comme cotations approuvées. Le manager conserve le parcours habituel de validation.
- Le questionnaire permet de revenir à la question précédente et de corriger une réponse avant certification, en conservant les autres réponses et précisions pendant cette saisie.

Les cellules remplies, formules, décisions, signatures et déclarations antérieures sont conservées. Aucune migration de base, modification des autorisations de démarrage, fusion ou mise en production n'est incluse.

## Recette après installation sur une prévisualisation

1. Refaire les vérifications sur une opportunité de test existante : contrôler que les réponses humaines restent inchangées et que les nouvelles propositions comportent leurs preuves.
2. Vérifier que les données publiques des dirigeants alimentent KYC, conflits et intégrité ; une homonymie ou une absence de preuve doit rester explicite.
3. Avec deux membres de l'équipe, vérifier que les honoraires impayés ne figurent pas dans les déclarations personnelles.
4. Revenir sur une réponse et la corriger avant certification : les autres réponses et précisions restent présentes.
5. Contrôler qu'une proposition de risque reste vide dans le fichier Excel tant que le manager ne l'a pas validée ; les décisions et signatures demeurent humaines.

Les tests automatiques utilisent un Drive et une IA simulés. Ils ne prouvent pas la qualité d'une recherche publique réelle ni le bon fonctionnement des connexions de production.

Validation locale : 21/21 tests du module opportunités passent. Suite complète : 575/578 passent ; les trois échecs de `document-location.test.js` (démarrage par dérogation attendu comme appliqué mais désormais bloqué) ont été reproduits sur le commit de base sans cette correction. La syntaxe des deux fichiers JavaScript modifiés est vérifiée.
