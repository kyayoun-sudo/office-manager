> Note de mise à jour : les limites de la Brique 3 décrites dans cette analyse historique sont remplacées par `docs/ORPAILLEUR_BRIQUE_03_COMPLETE.md` (lecteur 2.0.0).

# Orpailleur — Brique 3 : analyse et premier lot implémenté

Branche cible : `feature/white-label-desktop`. Installer après les briques 1 et 2.

## Ce que la proposition apporte

La séparation lecteur / compréhension est pertinente. Le lecteur doit rapporter ce qu'il a extrait ; la brique suivante interprète le sens. Un nom ou un chemin est un indice contextuel, pas une preuve. Un échantillon de lignes ou de pages ne constitue pas une lecture complète.

## Corrections de conception

- Pas de pourcentage de lisibilité inventé : score et langue restent inconnus sans mesure réelle.
- Pas de nouvelle empreinte sans lecture. L'empreinte d'un extrait reste distincte de celle du texte extrait complet ; aucune ne prouve l'identité de toutes les données binaires, images ou mises en page.
- Pas de tables parallèles d'inspections et de chunks dans une deuxième mémoire. Le contenu et les chunks sont retournés temporairement ; une fiche sans texte est conservée dans le TIDY_STATE existant du Drive.
- Pas de cache global de contenu entre utilisateurs. Aucun cache de contenu n'est introduit dans ce lot.
- Un document protégé n'est pas déchiffré. Les erreurs ne deviennent pas des lectures réussies.

## Ce qui fonctionne dans ce lot

Un contrat commun `inspectDocument` fournit statut, version, méthode, contenu, sections, tableaux disponibles, limites, chunks et empreintes. Les chunks conservent les pages PDF réellement connues, les parties XML Word/PowerPoint ou les feuilles Excel ; aucune pagination Word ou numérotation d'affichage PowerPoint n'est inventée.

Les PDF conservent le texte natif même si d'autres pages sont vides. Les pages absentes sont signalées. Les longs PDF restent des lectures partielles.

Word extrait les paragraphes, en-têtes et pieds de page. PowerPoint extrait le texte des parties de diapositives. Ces deux formats restent PARTIAL : tables, dessins, notes et ordre d'affichage ne sont pas certifiés.

Excel conserve au maximum 10 feuilles, 21 lignes et 30 colonnes par feuille. Une cellule est limitée à 500 caractères. Les nombres de lignes et colonnes du classeur sont indiqués, les résultats de formules sont ceux enregistrés dans le fichier ; aucune formule n'est exécutée. Un échantillon est PARTIAL.

Les documents Google natifs utilisent les exports Office pour ce parcours structuré. Les téléchargements binaires et texte sont limités à 8 Mo ; les archives Office sont contrôlées avant extraction (2000 entrées, 32 Mo décompressés). Les déclarations de type XML sont refusées.

La vision existante reste disponible pour PDF scannés et images dans le budget de la passe. Elle reçoit une consigne de transcription neutre ; sa couverture n'étant pas vérifiée, sa sortie reste PARTIAL.

Le rangement reçoit le statut de lecture et conserve une fiche par fichier dans sa mémoire de Drive. Un résultat autre que READ_SUCCESS bloque le rangement automatique. Les nouveaux extraits ne sont plus envoyés au registre persistant. Cela n'efface pas les anciens extraits déjà enregistrés.

## Ce qui reste à construire avant de déclarer la Brique 3 complète

- Reconstruction des tables Word, des notes PowerPoint et de l'ordre réel de la présentation ; inspection des objets et images intégrés.
- Lecture CSV structurée avec détection du séparateur, encodages autres qu'UTF-8, comptage et échantillons. Dans ce lot : texte UTF-8, marqué PARTIAL.
- OCR page par page avec couverture vérifiée, reprise et limites dédiées. La vision actuelle est un extrait, pas un OCR exhaustif.
- File de lecture dédiée avec réservation atomique entre plusieurs workers, reprise des statuts et suivi des tentatives. La passe actuelle orchestre les lectures ; ce lot n'ajoute pas une garantie de réservation distribuée.
- Cache scoped fondé sur une version fraîche de métadonnées, invalidation et réinspection des résultats partiels. Aucun cache persistant de contenu n'est ajouté.
- Validation sur le Drive connecté et les fournisseurs de vision : les tests locaux ne prouvent pas les permissions réelles de ces services.

## Installation

Uploader les fichiers du ZIP à la racine de la branche `feature/white-label-desktop`, en préservant `lib/`, `tests/` et `docs/`. Inclure `package.json` et `pnpm-lock.yaml` : ils déclarent JSZip et Saxes. L'archive ZIP elle-même ne doit pas être déposée comme code du projet.

## Références techniques

- [Exports Google Drive](https://developers.google.com/workspace/drive/api/guides/ref-export-formats)
- [JSZip loadAsync](https://stuk.github.io/jszip/documentation/api_jszip/load_async.html)
- [Saxes](https://github.com/lddubeau/saxes)
- [ExcelJS](https://github.com/exceljs/exceljs)
