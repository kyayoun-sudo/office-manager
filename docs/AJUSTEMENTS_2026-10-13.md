# Ajustements demandés — suivi séparé de l'existant

Les deux documents transmis le 13 octobre 2026 définissent le périmètre. Le second précise la règle de localisation : mémoire, mission, Drive, analyse Orpailleur, puis question si nécessaire. Les workflows et les classeurs actuels restent la base. Aucun fichier sous `sources/` n'a été modifié.

## Extensions locales réalisées

| Demande | Modification | Limite à conserver |
| --- | --- | --- |
| Localisation et mémoire des documents (§1–4, §40, §42, §47–48, §58 et ajout général) | Extension de `file-index.js`, dans la mémoire existante `OFFICE_MANAGER_FILE_INDEX.json`. Outil `locate_required_document` pour les spécialistes ; règle commune dans l'orchestrateur. Recherche en mémoire, documents de mission, Drive, lecture des candidats et analyse par Orpailleur. Interface de confirmation dans le Secrétariat. | Les chemins historiques qui utilisent directement une configuration ne sont pas tous migrés vers ce nouvel outil. La disponibilité du Drive et des modèles IA reste nécessaire en exploitation. |
| Modèle distinct du document actif | Références séparées par cabinet, mission, cycle, période et rôle. Un modèle par défaut du cabinet est réutilisable pour une nouvelle mission. | Le référencement ne copie et ne remplit pas automatiquement une quotation. |
| Ambiguïté et versions | Pas de choix silencieux entre plusieurs modèles d'acceptation ; faible confiance, lecture incomplète, candidat non lu ou erreur de recherche imposent une sélection humaine. Une version confirmée modifiée doit être reconfirmée. Historique des remplacements conservé. | La confiance d'identification est une estimation du modèle, pas une preuve de conformité. |
| Absence d'un document | `NOT_FOUND_YET` après recherche non concluante ; `CONFIRMED_NOT_AVAILABLE` uniquement après une déclaration humaine, mémorisée avec auteur et date. | Aucun document créé automatiquement après cette déclaration. |
| Réception du TDR (§7) | Date indépendante de la date de création, saisissable et corrigeable, avec historique signé. Synchronisation ciblée de la cellule du classeur d'acceptation, résultat de synchronisation explicite. | L'extraction depuis les métadonnées d'un email et la propagation à tous les calculs de délais restent à compléter. Les dates inconnues ne sont plus inventées depuis la création. |
| Exception du propriétaire (§9–10) | Autorisation tracée avant progression : préparation KYC, planification ou commencement des travaux d'une mission sélectionnée. Auteur, heure, règle normale, décision et éléments ouverts conservés. Échec de transition : autorisation en attente. Shadow reçoit ces observations. | Les réponses, déclarations d'indépendance et signatures ne sont pas complétées par la dérogation. La numérotation du classeur reste Phase 0 / Phase 1 ; aucune nouvelle phase KYC n'est inventée. |
| Remplacement pour la lettre de mission (§11) | Un manager peut enregistrer l'envoi d'une lettre approuvée, avec les preuves existantes. | Cette extension ne donne pas au manager le droit d'approuver sa propre lettre ni d'enregistrer l'envoi d'un rapport. Les délégations nominatives restent à compléter. |
| Validations importantes (§12) | Liens du cockpit vers l'action ou le message précis ; la page positionne le focus sur la carte correspondante, même si son état a changé. | Les contrôles existants de validation restent applicables. |

## Périmètre encore à compléter ou à vérifier

- **P0 :** propagation de la localisation dans tous les workflows automatiques, détection de réception depuis un email, délais fondés sur cette date, délégations nominatives et progression d'acceptation complète à partir du classeur réel.
- **P1 (§13–22) :** quotation Excel réelle par mission, modèle configurable, mapping de ses zones autorisées, équipes, étapes des experts, prix et conditions, débours estimés/confirmés, copie de sécurité et mises à jour vérifiées. Les fonctions existantes de copie et de modification conservant les formules doivent être réutilisées.
- **P2 (§23–35) :** audit complet du lien message/fil/mission/cycle/test/PBC, pièces jointes et traitement des réponses, classement et notifications hors horaires. Les modules de messagerie, Gmail, événements et PBC existent ; leur présence ne suffit pas à déclarer tout ce parcours livré.
- **P3 (§41–53) :** vérifier la couverture des fichiers réels de préparation, calendrier, revue analytique et comparaison des risques ; compléter les parcours manquants en réutilisant programmes, procédures, working papers et revue humaine existants. Une exécution de macro ne doit jamais être annoncée sans moteur d'exécution et résultat réellement vérifiés.
- **P4 (§25, §36–39, §54–56) :** responsabilités et remplaçants, mémoire du cabinet, adaptation par Management Card, interface des cycles, benchmark UX documenté et couverture des notifications.

## Vérification

- Suite complète : **552 tests réussis**, aucun échec.
- Après le dernier ajustement de réutilisation du modèle par défaut : **36 tests ciblés réussis**.
- Syntaxe des modules modifiés et des scripts des trois pages contrôlée ; diff sans erreurs d'espacement.
- Tests locaux, avec connecteurs simulés lorsque nécessaire. Aucune recette sur le Drive réel, aucun envoi de message, aucune modification de fichier de mission en production, aucune migration et aucun déploiement pendant ce travail.

Ce suivi ne constitue pas une déclaration d'achèvement des 60 demandes. Il distingue les extensions réalisées des capacités restantes et de ce qui doit encore être vérifié en exploitation.
