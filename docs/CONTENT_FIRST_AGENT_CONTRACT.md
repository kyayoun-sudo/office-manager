# IA cerveau, code outils : contrat opérationnel

Le contrat commun est `lib/agent-contract.js`. Il est donné au Firm Manager et à ses spécialistes SDK, au cerveau `think`, au classement Orpailleur et à Shadow. Il ne donne aucune autorité de signature ni de modification des permissions à un modèle.

## Accès au contenu

`inspect_mission_documents` fournit à chaque agent opérationnel le catalogue de la mission, paginé par 30, et la lecture à la demande d'une pièce. Aucun filtre métier par nom ou extension ne retire une pièce du catalogue. Les droits de mission et l'appartenance de la pièce au catalogue restent vérifiés.

`document-content.js` choisit le parseur selon les octets et le MIME : un classeur nommé comme un PDF reste lisible comme classeur. Il fournit des fenêtres avec leurs vraies coordonnées, les feuilles disponibles et les plages suivantes. Les longues cellules peuvent être lues par adresse et offset. Les lectures visuelles/OCR restent partielles et soumises à vérification humaine.

Une fenêtre bornée n'est pas une lecture exhaustive. Le modèle peut demander les pages du catalogue, pages PDF, feuilles, lignes, colonnes ou offsets suivants. Un contexte SOP/working file volumineux est lui aussi accessible par fenêtres explicites ; il n'est pas réduit en supprimant silencieusement les derniers documents.

## Décision et retour d'exécution

`document-reasoning.js` est l'adaptateur commun des besoins du working file, du remplissage de feuille et des tests explicites. Une requête fait une inférence ou une lecture, puis sauvegarde un point de reprise dans le travail de la procédure. Le résultat doit référencer des pièces effectivement lues avant d'être utilisé.

Pour le remplissage et les tests, le code exécute les instructions en aperçu et renvoie les contrôles et résultats au modèle. Celui-ci doit rendre la préparation après ce retour ; il peut modifier son plan, lire davantage ou poser une question. Les résultats présentés ne sont pas écrits dans Excel par cette boucle. L'écriture conserve les validations humaines et les contrôles existants.

Le panneau d'étape utilise le même lecteur de contenu. Les méthodes de remplissage déjà confirmées par une personne restent réutilisables sous les conditions de contexte, versions et empreintes existantes ; une simple confiance du modèle ne constitue pas une méthode validée.

L'interface poursuit les requêtes de préparation marquées `document_brain`, avec un maximum de 20 passages automatiques par série. Elle affiche la progression et propose de continuer au-delà. Les écritures ne sont pas rejouées par ce mécanisme.

## Conflits retirés

- La recherche des pièces ne peut plus déclarer une pièce manquante après un simple rapprochement lexical. Un besoin non résolu reste à examiner.
- La consigne rejetant un PTBA avant examen est retirée du contrôle des besoins. Le SOP et le working file réels définissent la méthode applicable.
- Les limites de 15 pièces du test et 60 pièces du remplissage sont remplacées par un catalogue paginé et des lectures choisies par le modèle.
- Les noms et années des modèles ne sont plus des preuves qu'ils contiennent déjà des travaux client. Les contrôles du contenu rempli restent en place.
- L'import assisté ne conserve plus un choix du code contre une appréciation négative de l'IA ; en cas de panne IA il ne sélectionne pas de correspondance automatique. Les choix humains explicites restent possibles.
- La sauvegarde du dialogue et de la conclusion conserve tous les enregistrements internes, dont les nouveaux points de reprise ; un navigateur ne peut pas injecter de tels enregistrements dans ce formulaire.
- Les erreurs de mémoire du cerveau commun sont exposées. Si une action approuvée a déjà été exécutée, son résultat le dit même lorsque l'écriture de mémoire échoue, pour éviter de la rejouer.
- Une proposition Shadow n'est plus activée par sa seule confiance ou par une référence à une prétendue correction humaine. Les leçons utilisées doivent porter une validation ; les leçons limitées à une mission ne sont pas transmises hors de cette mission.

## Vérification et périmètre

Le contrat commun couvre aussi la frontière de transport `callModel` de tous les fournisseurs et l'ancien mode direct `runAI`. Ainsi une extraction, une analyse documentaire ou une revue secondaire reçoit les mêmes règles même si son module n'importe pas le contrat. L'injection est idempotente et conserve le format de sortie propre à la tâche. Elle intervient après le routage : les mots du contrat ne changent pas la sélection des fournisseurs ni les capacités requises. Les racines et spécialistes SDK reçoivent déjà ce même contrat dans leurs instructions.

La règle de réception distingue explicitement compréhension, instruction de classement et mémorisation confirmée par un outil. La mémoire utile reste sourcée, limitée au cabinet et à la mission, liée à une version et à la couverture réellement lue. Cela définit le comportement demandé aux modèles ; ajouter cette instruction ne crée pas à lui seul un déclencheur automatique sur chaque dépôt ni un outil de mémoire absent d'un parcours. Ces branchements restent à vérifier sur les flux réels avant d'affirmer que toute réception est comprise et mémorisée.

Les tests utilisent des IA et connecteurs simulés et de vrais classeurs ExcelJS. Ils vérifient une pièce au-delà de la 60e position, un classeur portant une extension et un MIME trompeurs, les lectures à la demande, le retour d'exécution, les versions modifiées, les refus d'accès, la conservation de mémoire et l'absence de sélection automatique lors d'une panne IA.

Les catalogues de mission exposent les fichiers enregistrés dans la mission ; ils ne prétendent pas inclure des fichiers extérieurs non encore rattachés. La découverte de ces fichiers dans le Drive reste le rôle des outils Drive et de l'Orpailleur. Les limites de taille et de lecture restent annoncées. Ce changement ne constitue pas un essai sur toutes les missions réelles ni une preuve d'absence de tout défaut dans l'application.

Les anciennes fonctions de planification de `sheet-understanding.js` restent disponibles pour les compatibilités internes et tests historiques ; la route de remplissage active est `fill-orders.js`. Leur existence ne doit pas servir à réintroduire un second pilote dans cette route.
