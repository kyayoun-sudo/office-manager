# Installer le lot « Mes dossiers »

Le lot est basé sur le commit `7875db9` de `feature/white-label-desktop`. Il contient uniquement les fichiers nouveaux ou modifiés ; les autres fonctions de l’application restent en place.

## Depuis GitHub dans le navigateur

1. Télécharger `office-manager-dossiers.zip` et extraire son contenu sur le PC.
2. Ouvrir le dépôt `kyayoun-sudo/office-manager`, branche `feature/white-label-desktop`.
3. Au niveau racine du dépôt, choisir **Add file → Upload files**.
4. Glisser **le contenu extrait** : les dossiers `api`, `assets`, `lib`, `tests`, `docs`, ainsi que `dossiers.html`. Ne pas uploader le ZIP lui-même. Garder exactement les noms et les sous-dossiers.
5. Vérifier la liste avant de valider : certains fichiers existants seront remplacés. Commit proposé : « Add shared dossier workspace and agent handoffs ».
6. Vérifier le build Vercel déclenché par la branche. La promotion de production reste au propriétaire.
7. Ouvrir `/dossiers.html`, puis tester avec les rôles du cabinet. Actualiser avec Ctrl+F5 si nécessaire.

Aucun SQL à exécuter pour ce lot. Les tables et fonctions déjà requises par l’application restent nécessaires.

Les résultats de tests, les trois échecs préexistants et les fonctionnalités non réalisées sont décrits dans `NOTE_POUR_CLAUDE_DOSSIERS_2026-10-16.md`.

## Avec un checkout Git

Une alternative pour Claude ou un développeur est d’appliquer le fichier `office-manager-dossiers.patch` depuis la racine d’un checkout compatible, puis de lancer `npm ci` et `npm test`. Le patch est fourni séparément du ZIP.
