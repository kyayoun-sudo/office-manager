# Reprise : sources du budget et du planning

## Décision du propriétaire

Le programme de travail validé détermine les travaux, les intervenants et les heures estimées. Mission Controller remplit un Excel dans le Shared Drive à partir de ces sources. Ne pas imposer une nouvelle saisie d'équipe et une seconde validation dans Supabase pour une mission déjà validée dans Drive.

Supabase reste la mémoire technique de l'application. Les modules de propositions et décisions ajoutés récemment restent une voie distincte pour les missions créées dans l'application ; leurs nouvelles migrations ne sont pas un prérequis du parcours Drive.

## Constat de lecture du 7 octobre 2026

- Le registre maître Drive contient 17 lignes dans Collaborateurs. Missions, Planning et Calendrier_Capacite ne contiennent actuellement que leurs en-têtes.
- Planning prévoit déjà les responsabilités, les dates, les allocations et la provenance du programme. Il ne contient pas de colonne d'heures ou de taux. Un pourcentage d'allocation ne permet pas de déduire des heures.
- Un modèle Excel de budget existe déjà dans la bibliothèque des working papers. Une copie existe aussi dans la base documentaire. Identifier le modèle canonique par le mapping avant toute écriture ; ne pas créer un autre modèle concurrent.
- Le modèle dispose de formules, d'ajustements manager, de contrôles et d'une distinction entre valeur technique, honoraires contractuels et facturation. Les catégories tarifaires proposées ne constituent pas des tarifs approuvés pour une mission.
- Le programme Word examiné indique explicitement « à valider ». Ses tableaux donnent des responsabilités par rôle, mais les budgets horaires et plusieurs dates sont des champs à compléter. Ce document ne permet pas de confirmer une équipe nominative ou un budget chiffré.
- Le classeur exemple signalé par le propriétaire est encore à la racine du Drive au moment de la lecture. Aucune opération de rangement n'a été effectuée pendant cet audit.

Les contenus nominatifs, CV et réponses individuelles ne sont pas reproduits ici. Ces constats sont une photographie de lecture, pas une recette du bridge de l'application.

## Fonctions déjà disponibles

Dans `lib/agent-tools.js`, `get_team_directory` / la lecture d'annuaire utilisent Drive comme source métier, avec un cache technique subordonné. `read_taty_master_sheet` lit les onglets existants. `sync_validated_programme_assignments` synchronise les affectations confirmées dans Planning et recalcule la capacité ; il refuse un programme dont le nom indique encore un brouillon. Ces fonctions doivent être réutilisées.

Le récent `prepare_office_mission_budget` consomme les versions et décisions propres aux missions de l'application. Il ne remplit pas le modèle Excel existant : son export produit un autre classeur. Ne pas le présenter comme le raccordement Drive demandé.

## Plan du prochain incrément

1. Ajouter une préparation en lecture seule à partir du programme Drive et du registre existants : provenance, état de validation, intervenants identifiés, heures explicites et taux approuvés. Signaler les manques sans les inventer ni écrire dans Planning.
2. Vérifier les cellules, formules et limites du modèle réel avant de construire le remplissage. Conserver le modèle ; écrire dans une copie propre à la mission, à un emplacement confirmé par le mapping.
3. Quand les sources sont complètes et validées, réutiliser la synchronisation existante du Planning et remplir le budget à partir des mêmes affectations et heures. Ne pas utiliser les hypothèses de risque comme substitut aux heures validées.
4. Recetter avec une mission fictive : cohérence des heures et des montants, conservation des formules, absence de doublons, refus des sources non validées et absence de modification du modèle.

Ne pas appliquer les nouvelles migrations de validation/budget pour résoudre les champs manquants de Drive. Ne pas activer le scheduler ou annoncer un export effectué sans vérifier le résultat réel.

## Premier raccordement construit

`read_drive_mission_budget_sources` est ajouté à Mission Controller. Il lit le programme et le modèle sélectionnés ainsi que Collaborateurs, Missions et Planning, vérifie le Shared Drive, la version des sources et les bornes de lecture, et fournit un dossier de préparation en lecture seule. Il exclut les champs CV et téléphone de l'annuaire renvoyé. Le contenu du modèle reste interne au traitement.

L'identifiant de mission doit correspondre exactement à ID_Mission ; les lignes Planning associées par un simple nom historique ne sont pas assimilées automatiquement. Un registre vide, des en-têtes inattendus, un document incomplet ou une provenance ancienne restent des problèmes à résoudre. Le dossier reste toujours REVIEW_REQUIRED : l'agent doit vérifier les preuves de validation, les heures et les taux, et cet outil ne peut pas écrire ou exporter.

Les instructions de Controller distinguent désormais ce parcours des propositions propres aux missions créées dans l'application. Sept tests ciblés couvrent les refus et l'absence d'écriture ; la suite locale complète passe (215 tests). Le remplissage du modèle Excel, la publication et la recette réelle du bridge restent à faire.
