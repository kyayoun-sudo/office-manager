# Organisation du Drive et fiabilité de la cartographie

La bibliothèque métier peut être placée sous le dossier de pilotage du cabinet.
Les fichiers conservent leurs identifiants Drive : le registre maître et les rôles
validés ne doivent pas être résolus par un chemin figé. Aucun nouveau chemin
ou identifiant de cabinet n'est ajouté au moteur.

Les fichiers mémoire MAP / REGISTER restent à leur emplacement configuré.
Déplacer ces fichiers demanderait de vérifier OFFICE_MANAGER_MEMORY_FOLDER_ID ;
ce changement n'est pas nécessaire pour regrouper la bibliothèque métier.

## Correction dans notre branche

- L'inventaire exige un scan COMPLETE de la même organisation et du même Drive.
- Les observations last_seen_at depuis le début de ce scan sont conservées,
  même lorsqu'un passage partiel remplace leur last_scan_id.
- Pagination par file_id, bornée à 50000 objets ; une sonde supplémentaire
  distingue une liste exactement au plafond d'une liste tronquée.
- Un changement du scan de référence pendant la lecture rend le résultat incomplet.
- Une liste vide contredisant le REGISTER existant est refusée sans écriture.
- Une cartographie partielle conserve un avertissement explicite et ne conclut
  pas à l'absence de fichiers.
- La liste directe Drive refuse son plafond avec pagination restante.
  Le bridge existant n'expose pas son curseur : à 1000 entrées, l'application
  refuse conservativement ce résultat ambigu, même si le dossier a exactement
  1000 entrées. Une future pagination du bridge sera un chantier distinct.

Aucune Edge Function ni migration n'est changée. Les petits dossiers et la
recherche exacte des fichiers mémoire conservent leur comportement.

## Vérification et limites

182 tests automatisés passent, sans réseau réel ni requête de modèle. Ces tests
vérifient notamment les plafonds, le changement de scan, le tenant/Drive,
les lignes ré-étiquetées, le refus de liste vide et l'identité stable après
déplacement. Le diff ne change pas les programmes, approbations, affectations,
horaires ou mails. Toujours 10 fonctions API.

Il reste à publier ce code, puis déployer une preview et vérifier l'accès réel
Drive/Sheets de l'application. Le déplacement manuel d'un dossier ne remplace
ni la cartographie complète ni son approbation signée par le propriétaire.

## Suite du programme

Dans le dossier de mission, préparer et enregistrer le programme proposé.
Relier chaque procédure aux références métier réellement adaptées à la mission ;
la présence de procédures d'audit ne prouve pas une couverture du conseil.
La validation du plan, de l'équipe et du programme exact reste nécessaire avant
exécution. L'application ne consomme pas encore les nouveaux programmes proposés
dans son ancien moteur d'exécution.
