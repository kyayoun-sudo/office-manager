# Shadow — contrôler une sauvegarde avant de réutiliser ses leçons

Une sauvegarde `office-manager.shadow-export/1` est une **mémoire métier du cabinet**, pas une modification du code source. Elle n’a pas à être jointe à une pull request : les cas, les indices, les historiques et les documents cités peuvent contenir des données confidentielles, même si le fichier ne contient pas les pièces originales.

## Procédure sans modifier les agents

1. Conserver le JSON exporté **hors du dépôt GitHub** et hors de tout service public.
2. Contrôler son intégrité et obtenir des indicateurs sans dévoiler les textes :
   `node scripts/shadow-export-audit.mjs /chemin/local/vers/shadow-export.json`
   (ajouter `--json` pour un rapport exploitable par un outil).
3. Vérifier les avertissements et la provenance. Le checksum SHA-256 détecte les modifications accidentelles ; **il n’authentifie pas l’auteur**.
4. Dans le **même cabinet autorisé**, utiliser l’interface **Entraînement → Garder ce que Shadow a appris → Importer**. L’import existant garde les statuts des leçons (dont `rejected` et `under_review`) et n’écrase pas les identifiants déjà présents. Il refuse les changements en zone protégée et trace l’opération.
5. Revoir les hypothèses, les tests sans résultats et les éventuels refus. **« active » ne prouve pas qu’un comportement fonctionne**. Le précontrôle n’exécute aucun test et ne transfère aucune leçon vers EYNOWA Lab.

Le script `scripts/shadow-lessons-import.mjs` est destiné **uniquement aux propositions nouvelles** et les transforme en leçons `under_review`. Il refuse désormais une sauvegarde complète : autrement, les statuts et les 300 tests pourraient être perdus lors d’une conversion involontaire.

## Critères pour transformer une leçon en correction de code

Associer chaque future PR fonctionnelle à un problème reproductible, un emplacement de code vérifié, un test de non-régression ciblé et un résultat de test. Ne pas transposer mécaniquement les 111 hypothèses de l’export en règles globales : les règles du cabinet, les exigences professionnelles et les autorisations des utilisateurs restent séparées. Ne pas faire passer une décision d’entraînement ou un exemple client pour un fait de production.
