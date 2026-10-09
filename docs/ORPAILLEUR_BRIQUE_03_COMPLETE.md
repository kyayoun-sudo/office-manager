# Brique 3 — lecteur / inspecteur, version 2.0.0

Branche cible : `feature/white-label-desktop`.

Cette livraison complète le contrat du lecteur dans le dépôt. Elle remplace le premier lot Brique 3 et conserve la Brique 4 déjà livrée. Une lecture peut toujours être PARTIAL ou UNSUPPORTED : compléter le moteur ne signifie pas prétendre lire tous les documents sans limite.

## Installation

1. Décompresser l'archive et uploader ses fichiers à la racine de la branche desktop, en conservant les dossiers.
2. Dans le SQL Editor du projet Supabase utilisé par cette application, exécuter **`db/inspection-reader-leases.sql`**. Il nécessite la table déjà installée par `db/memory.sql`. Le script est réexécutable et n'efface aucune donnée.
3. Déployer la branche avec ses dépendances et son verrou de versions. Aucune nouvelle clé ni extension Postgres n'est nécessaire.
4. Tester une lecture avec le Drive connecté et un document témoin. Les tests locaux ne prouvent pas les permissions de votre Drive ni la transcription d'un fournisseur de vision réel.

Sans le script SQL, les passages de production s'arrêtent sur l'indisponibilité de la réservation ; ils ne basculent pas vers une fausse réservation locale. Le verrou en mémoire du code sert seulement aux adaptateurs injectés pour les tests hors ligne.

## Couverture du texte de la Brique 3

| Exigences | Fonctionnement livré |
|---|---|
| 1–5, 45 : rôle, admissibilité, routeur, contrat | MIME → lecteur, formats supportés / ignorés / spéciaux / trop gros. Dossiers, raccourcis et temporaires exclus. Retour commun avec document, portée, méthode, statut et structures. Le lecteur ne range, ne renomme et ne classe rien. |
| 6–7, 31 : PDF natifs et scannés | Texte natif en premier, uniquement sur les pages sélectionnées. Petits PDF : toutes les pages ; longs PDF : début et fin, ou pages explicitement demandées. Pages manquantes et pages tronquées indiquées. Fallback vision seulement sur les pages pauvres en texte. Chaque page PDF est isolée avant transmission au fournisseur. |
| 8 : Word | Paragraphes, styles de titres, tableaux, en-têtes/pieds de page référencés, notes de bas de page et de fin. Source : partie XML et bloc, sans pagination inventée. Images, dessins, commentaires ou contenus alternatifs omis entraînent PARTIAL. |
| 9–10 : Excel | Noms des feuilles, plage occupée observée, cellules non vides, première ligne candidate et échantillons, formules et valeurs sauvegardées. Aucune exécution de formule. Feuille et lignes ciblables. Au plus 10 feuilles, 21 lignes par défaut, 100 lignes sur demande, 30 colonnes et 500 caractères par cellule. Les statistiques dépassant 100 000 cellules sont explicitement incomplètes. |
| 11 : CSV | Séparateur détecté avec ambiguïté signalée, champs cités, guillemets doubles, retours à la ligne internes, nombre de lignes logiques et colonnes, échantillon et première ligne candidate. UTF-8 validé, UTF-16 avec BOM, encodage explicite si nécessaire. Pas de conversion silencieuse d'un encodage inconnu. |
| 12 : PowerPoint | Ordre réel défini par les relations de la présentation, numéros de diapositives, titres déclarés, texte, notes accessibles et tableaux. Les éléments visuels non transcrits et parties manquantes entraînent PARTIAL. |
| 13–15 : Google natif | Docs et Slides : exports Office officiels puis lecteurs structurés. Sheets : API de structure puis plages bornées, sans télécharger le classeur entier. Dimensions de grille distinctes d'une plage réellement occupée ; l'inconnue reste inconnue. |
| 16 : images | Transcription documentaire par le fournisseur de vision existant, dans le budget de la passe. Pas de description artistique ni de classification métier dans le lecteur. |
| 17–20 : contexte et normalisation | Nom, chemin observé, parent et au maximum cinq exemples voisins. Ces indices restent non probants. Retours de ligne et tableaux préservés ; aucune réécriture du sens. |
| 21–27 : langue, volumes, chunks, tableaux | Langue et score laissés inconnus sans mesure fiable. Caractères, tokens estimés, pages/feuilles/diapositives disponibles. Chunks identifiés par document/version/empreinte/séquence ; limites naturelles quand possible, positions et source réelle. Tableaux séparés et bornés. |
| 28–29 : empreintes et version | Reader 2.0.0. Empreinte du texte extrait complet distincte de l'empreinte d'un extrait. Aucun hash d'extrait ne prouve un doublon intégral, et aucune détection n'autorise une suppression. |
| 30–35 : statuts, protections et erreurs | PENDING/PROCESSING dans la file, puis READ_SUCCESS, PARTIAL, UNREADABLE, UNSUPPORTED, ERROR_RETRYABLE ou ERROR_FINAL. Codes mots de passe, corruption, encodage, taille et source modifiée. Aucun contournement de protection. |
| 36–41 : original, confidentialité et mémoire | Original intact. Texte, tableaux et chunks transitoires ; fiche de lecture, référence de version et états dans le TIDY_STATE existant par Drive. Vérification de l'appartenance au Drive sélectionné avant lecture. Cache séparé par organisation, connexion, propriétaire connu, Drive et mémoire. Aucun nouveau registre documentaire en base. |
| 42–44 : réservation et transmission | Réservation atomique de l'orchestration par Drive dans le checkpoint de contrôle existant. Les lectures de ce Drive sont ainsi sérialisées. Tâche PROCESSING sauvegardée avant lecture, statut final sauvegardé après, puis référence sans contenu dans understanding_queue. Brique 4 consomme les extractions en mémoire. |
| 46–49 : priorités, cache, réinspection, budgets | Priorité conservée. Cache RAM de 60 secondes, 20 entrées / 4 Mo maximum, succès complets seulement, métadonnées fraîches exigées. Invalidation sur portée, version, modification ou options. Réinspection forcée possible ; version de lecteur obsolète remise dans le passage suivant. Résultats partiels non mis en cache. Erreurs temporaires et OCR différé : reprise avec délai croissant. |
| 50–54 : flux et frontière | Scanner → file persistante de lecture → extraction normalisée → file de compréhension → Brique 4. La destination et l'autorisation restent des responsabilités distinctes. |

## Choix importants

La réservation utilise une ligne de contrôle par mémoire de Drive, pas une seconde base d'inspections. Les fonctions SQL sont SECURITY INVOKER, réservées au serveur ; anon et authenticated ne peuvent pas les appeler. Deux travailleurs ne peuvent pas prendre simultanément la même réservation. Son expiration permet la reprise après arrêt ; un ancien propriétaire ne peut plus la renouveler ou libérer la réservation d'un autre.

Les états et tentatives sont persistés avant et après chaque lecture. Après interruption, la même tranche peut être relue : le texte n'étant pas stocké durablement, cette relecture est nécessaire pour la compréhension. Les actions et questions conservent leurs protections d'idempotence existantes. Une génération de passage remplacée n'est pas écrasée par un ancien lecteur.

Les métadonnées sont vérifiées avant et après une lecture réelle. Si la source a changé entre-temps, l'extraction est rejetée avec SOURCE_CHANGED_DURING_READ. La portée est vérifiée avant une réutilisation du cache. Le chemin reçu du scanner est un contexte observé ; les identifiants de parents frais sont également transmis, sans déclarer ce chemin actuel vérifié.

La connexion directe transmet le propriétaire enregistré (`connected_by`, ou l'identifiant de compte disponible) et une référence de connexion fondée sur le compte et sa date de connexion. Un propriétaire inconnu reste inconnu : aucun utilisateur fictif n'est inventé. Les identifiants de connexion sont des références techniques, pas des jetons d'accès.

Les limites sont intentionnelles : téléchargement 8 Mo, archive Office 32 Mo décompressés / 2000 entrées, XML 250 000 éléments / profondeur 128, PDF 1000 pages maximum et sélection bornée. Les gros fichiers sont refusés avant une lecture coûteuse lorsque leur taille est connue, sinon pendant le téléchargement. Les relations Office externes ne sont jamais téléchargées.

La vision produit une transcription non vérifiée. Même après lecture de toutes les pages demandées, sa sortie reste PARTIAL, avec pages transcrites et non vérifiées. La complétude du moteur n'autorise pas un faux READ_SUCCESS. Les originaux protégés et formats non supportés restent explicitement bloqués.

## Validation et limites de déploiement

Tests sur véritables buffers PDF/XLSX, archives Word/PowerPoint structurées, CSV cités et multilingues, appels Sheets simulés, cache et versions, refus de portée, reprise, OCR différé et isolation d'une page PDF. Les fonctions SQL sont réellement exécutées dans une base Postgres embarquée : installation répétée, réservations concurrentes logiques, expiration, mauvais propriétaire et refus des rôles frontend.

Les services externes ne sont pas déployés par cette livraison. La SQL n'est pas appliquée à votre projet Supabase depuis ce chat et aucun document réel de votre Drive n'a servi aux tests. L'exactitude d'une transcription OCR ne peut pas être garantie par un test local.

## Références techniques

- [Exports et téléchargements Drive](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [Structure Google Sheets](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get)
- [unpdf](https://github.com/unjs/unpdf)
- [JSZip : lecture en flux](https://stuk.github.io/jszip/documentation/api_zipobject/node_stream.html)
- [Fonctions Supabase](https://supabase.com/docs/guides/database/functions)
