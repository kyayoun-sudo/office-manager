# Orpailleur — analyse et construction des briques 1 et 2

Date : 9 octobre 2026. Branche : `feature/white-label-desktop`.

## Ce que les deux textes définissent

La Brique 1 définit le comportement général du produit. Elle décrit aussi les futures étapes de lecture, de compréhension, de proposition, d'exécution et d'apprentissage. Ce n'est pas une seule fonction à coder avant le scanner.

La Brique 2 fournit une observation technique du périmètre autorisé. Son résultat signifie « découvert », jamais « compris », « mal rangé » ou « traité ».

L'organisation de TATY reste un contexte métier possible. Elle ne doit pas être supposée lorsqu'un autre utilisateur connecte son Drive. Un document personnel n'a pas besoin d'un client, d'une mission ou d'un PBC pour être compris.

## Révisions apportées aux propositions

| Proposition des textes | Décision et justification |
| --- | --- |
| Apprendre les habitudes du Drive | Retenu. Un nom de dossier est une observation ; une répétition est une hypothèse. La validation humaine et la provenance doivent être conservées séparément. |
| Confiance de 96 ou 97 % | Ce sont des illustrations, pas des probabilités mesurées. Aucun seuil numérique universel n'est introduit. La confiance ne crée pas une permission. |
| Devenir autonome après plusieurs validations | À construire avec une politique explicite et une portée définie. Plusieurs validations ne permettent pas au programme de s'accorder lui-même un droit. |
| Laisser un document ambigu sur place | Retenu pour le moteur de rangement. REVIEW devient un état de recherche ; il n'exige pas de déplacement dans un dossier spécial. |
| Créer des tables connections/documents/scan_runs/scan_queue/inspection_queue | Les concepts sont utiles ; leur duplication dans de nouvelles tables ne l'est pas. L'état JSON du scanner et le REGISTER existants sont étendus. Les documents restent identifiés par leur ID Google dans la mémoire du périmètre choisi. |
| Créer une queue d'inspection | Le REGISTER possède déjà l'état persistant PENDING_READ. On conserve cette liste de travail avant d'introduire une autre mémoire concurrente. Un worker de lecture indépendant et ses priorités restent à relier précisément à ce registre. |
| My Drive avec drive_id = null | Le type de source seul ne suffit pas à isoler deux utilisateurs. L'organisation, la connexion et le périmètre choisi restent indispensables. Le scanner conserve aussi la racine et refuse une reprise sous une autre organisation ou racine. |
| Un chemin lisible pour chaque objet | Retenu comme présentation. L'ID reste l'identité. Un dossier renommé peut changer les chemins de ses descendants sans que ceux-ci aient été déplacés. |
| Un fichier absent est supprimé | Rejeté. La comparaison produit NOT_SEEN/not_seen ; permissions, corbeille ou sortie du périmètre doivent être vérifiées séparément. Un scan incomplet ne calcule aucune disparition. |
| Scan en lecture seule | Lecture seule sur les documents métier. Les fichiers de mémoire appartenant au système doivent pouvoir être mis à jour pour sauvegarder la progression. |
| Scanner 500 000 fichiers | Ce n'est pas une capacité acquise. La mémoire JSON actuelle conserve un plafond de 50 000 objets environ, contrôlé entre les pages. Une architecture de stockage par lots sera nécessaire avant de promettre 500 000 objets. |
| Un seul scan actif | La reprise de la file existe. Cela ne constitue pas encore un verrou distribué atomique entre deux requêtes simultanées. Un bail de worker reste nécessaire pour une garantie forte. |

## Changements effectués dans ce lot

### Brique 1 : comportement et limites d'action

- Instructions du moteur rendues générales : aucun client, mission, année ou architecture n'est obligatoire. Les références d'audit ne s'appliquent qu'avec un contexte fourni.
- Structure déduite des chemins présentée comme une hypothèse non validée.
- Document ambigu conservé à sa place lors d'une question du moteur.
- Sans préférence enregistrée disponible, le rangement automatique est désactivé. Une valeur `auto_filing=true` déjà enregistrée reste respectée ; ce lot ne migre pas les anciennes préférences de base de données.
- Un déplacement automatique exige à la fois le paramètre d'autorisation, un extrait effectivement lisible, une confiance haute et `content_read=true`. Une réponse IA qui omet la preuve de lecture ne suffit plus.
- Les propositions de création de dossiers restent soumises à validation humaine, même si le rangement automatique est activé.
- Un rapport avec question ouverte, fichier illisible, proposition en attente ou déplacement non vérifié est incomplet. Les compteurs de propositions sont distingués des actions appliquées.

### Brique 2 : observation et reprise

- Connecteur de listing page par page. Les anciens consommateurs conservent leur interface de liste complète et son garde-fou.
- Curseur de prochaine page et objets observés sauvegardés ensemble après chaque page.
- Identifiant de run stable lors d'une reprise et nouveau lors d'un nouveau parcours.
- Conservation des dates de création, version, checksum et détails des raccourcis quand le connecteur les fournit.
- Première observation et dernière observation distinguées ; une page rejouée ne crée pas un deuxième objet.
- Dossiers déjà parcourus reconnus ; les raccourcis ne sont pas suivis comme des dossiers.
- Changements NEW, MODIFIED, MOVED et RENAMED conservés, y compris plusieurs changements simultanés.
- Erreurs temporaires conservées avec nombre de tentatives et date de nouvelle tentative ; dossiers bloqués signalés.
- Reprise des dossiers en erreur via le prochain lancement, sans recommencer les pages déjà acceptées. Aucun minuteur supplémentaire ni automation n'est installé.
- Scan incomplet si une file reste ouverte, un dossier est bloqué ou la limite de parcours empêche de continuer. Aucun passage de cartographie finale ou apprentissage du cabinet n'est déclenché à partir de ce résultat incomplet.
- Cartographie finale limitée aux métadonnées (`maxReads=0`). Le déclenchement existant du consommateur suivant reste conservé après un inventaire complet ; ses lectures ne sont pas comptées comme des lectures du scanner.
- Affichage explicite « inventaire terminé » ou « inventaire incomplet », avec découverte séparée de la lecture.

## Ce qui reste à construire pour couvrir entièrement les textes

1. Formaliser une mémoire générique d'hypothèses, validations et corrections, avec exemples de documents lus, auteur, date, portée et révocation. Shadow et les règles signées existent déjà ; ils ne constituent pas encore ce modèle complet.
2. Relier les modes PROPOSE_ONLY / VALIDATED_RULES_ONLY / AUTONOMOUS_WITHIN_POLICY à une politique persistante. Ce lot conserve l'interrupteur d'autonomie existant ; il ne prétend pas implémenter trois modes.
3. Étendre la compréhension persistante aux personnes, organisations, dates, sujet, projet et mots-clés, sans imposer les champs métier client/mission aux autres utilisateurs.
4. Remplacer le filtre temporel des passages suivants par le flux Drive `changes.list`, avec curseur par connexion/périmètre. La comparaison lors d'un parcours détecte les changements ; elle ne remplace pas ce flux incrémental.
5. Ajouter un bail exclusif et une protection de concurrence pour les workers. Les sauvegardes actuelles de mémoire ne constituent pas une transaction distribuée.
6. Dépasser la limite JSON par un stockage paginé de l'inventaire et de la file ; traiter l'expiration des tokens par une relance contrôlée du dossier.
7. Étendre le pont Google historique pour qu'il expose un vrai curseur. En attendant, sa réponse bornée ou ambiguë reste refusée, plutôt que déclarée complète.
8. Tester un parcours réel autorisé sur My Drive et Shared Drive, avec interruption, permissions limitées et changement de compte. Les tests de ce lot utilisent des connecteurs simulés ; aucun document utilisateur n'est parcouru ou déplacé pendant les tests.

## Validation

Les tests couvrent notamment la reprise sur une deuxième page après une erreur temporaire, le respect du backoff, les doublons d'IDs, les raccourcis, les changements combinés, les dossiers inaccessibles, la limite d'inventaire, le refus d'une reprise sous une autre racine, REVIEW sans déplacement, l'absence d'autorisation par défaut et les rapports incomplets.

Les documents d'architecture existants n'ont pas été réécrits. Cette analyse consigne l'évolution demandée par les deux nouvelles briques et les limites restantes.

## Références Google vérifiées

- [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list) : pagination et signal `incompleteSearch`.
- [Prise en charge des Drives partagés](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives) : périmètres de recherche et résultats incomplets.
