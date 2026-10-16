# Transmission à Claude — Office Manager, 16 octobre 2026

## Autorisation et point de départ

L’utilisateur a validé le développement : « ok code, tu ne detruit pas ce qu’on a deja ». Conserver les fonctions et travailler sur la présentation et la continuité des dossiers. Le cahier consolidé décrit une cible plus large que ce lot ; ne pas annoncer ses 49 sections comme réalisées.

Dépôt : `kyayoun-sudo/office-manager`. Base distante observée : branche production Vercel `feature/white-label-desktop`, commit `9a4f0ffcd4ac0b5c5169502bbf89dc89dc0e6a49`. Travail local isolé : branche `feature/mission-workspace-extension`.

## Réparation nécessaire du lot précédent

Le commit « Add files via upload » a placé le ZIP précédent à plat à la racine. Les fichiers destinés à `lib/`, `assets/`, `api/` et `tests/` n’étaient pas à leur emplacement prévu. Il a aussi remplacé les anciens `app.js` et `orchestrator.js` de racine par leurs homonymes destinés à d’autres dossiers.

Ce lot replace le paquet Mes dossiers aux bons chemins et restaure les deux fichiers racine depuis `7875db9633bf21d3b0048276d494e0409b875397` (fins de ligne normalisées). Les fichiers du mauvais upload ajoutés à la racine ne sont pas supprimés. Leur nettoyage éventuel doit être fait séparément après revue. Aucune donnée de mission n’est supprimée, aucune migration SQL destructive ni réinitialisation de cabinet n’est lancée.

## Réalisé dans ce lot

- Intégration correcte du précédent espace **Mes dossiers** : synthèse, parcours personne → agent → action → résultat → relais, travaux/revue, documents, équipe/spécialistes, cotation et historique selon les permissions existantes. Navigation et registres documentaires restent ceux du produit.
- **Équipe + responsable KYC** : le responsable interne peut être choisi pendant la validation de l’équipe. Validation serveur de son appartenance, conservation du classeur et des réponses ; si la personne quitte l’équipe, la responsabilité est signalée comme devant être réattribuée. Le parcours d’attribution séparé est conservé pour les modifications ultérieures. La préparation automatique complète du KYC n’est pas ajoutée à cette validation : la phase existante et ses actions restent utilisées.
- **Fonction sur la mission** : lecture des affectations actives, identification par email personnel exact et profil actif. La fonction apparaît dans Mes dossiers et change l’ordre/la première rubrique des vues : travaux pour auditeur/senior, synthèse pour manager/partner, documents pour secrétariat. Affectations ambiguës : retour explicite à la présentation du compte. Aucun changement du rôle global, des permissions, des droits de revue ou de signature. Ce n’est pas encore une migration complète des permissions de toutes les pages vers les fonctions de mission.
- **Accueil** : cartes d’accès au travail conservées ; les agents sont accessibles dans un volet dépliable, au lieu de prendre toute la place en haut.
- **Paramètres / gestion des personnes** : une section permet de référencer le workflow du cabinet et le modèle de management card, via le registre documentaire existant. Le serveur vérifie l’existence du document avant confirmation. Cela enregistre une référence ; cela ne transforme pas un texte libre en règles d’autorisation exécutables.
- **Serveur physique facultatif** : service Node autonome dans `connectors/local-server/`, adaptateur explicite, route additionnelle dans le routeur existant (pas de nouvelle fonction Vercel), page `/fichiers.html`. Navigation/dépôt/lecture/téléchargement/copie de référence depuis le web, liens depuis Documents/Paramètres/Mes dossiers. Les IDs locaux sont acceptés pour les références documentaires et les populations de procédures. Drive reste inchangé par défaut.
- Sécurité du connecteur : racines et utilisateurs explicitement autorisés ; identité personnelle et organisation signées avec HMAC, requête liée au contenu et expiration courte ; HTTPS sauf localhost de test ; vérification des droits applicatifs puis des droits du connecteur ; pas d’identité de service implicite pour les agents de fond ; pas d’écriture via GET ; refus dans les modes test/Preview de l’application ; pas de suppression. Versions antérieures archivées avant remplacement, contrôle de version attendue, renommage sans écrasement et identifiant conservé, liens symboliques et traversées de chemins refusés. Journal technique sans contenu documentaire, registre hors des racines.

Lire `connectors/local-server/README.md` pour l’installation, les variables, les ACL et les limites. Le connecteur n’est pas installé chez le client et aucun serveur réel n’a été contacté.

## Ce qui existait déjà et a été conservé

Les déclarations personnelles d’indépendance, brouillons/reprise et questions successives, notifications interrogées par l’application, travail KYC et commercial en parallèle, files de documents du secrétariat, programmes de travail, procédures, pièces, revues/sign-offs, modèles et mémoire agents existaient déjà. Les tests existants les couvrent en partie. Ne pas présenter ces fonctions comme entièrement nouvelles dans ce lot.

La note du paquet précédent `NOTE_POUR_CLAUDE_DOSSIERS_2026-10-16.md` précise notamment le suivi déclaratif des spécialistes et les relais de cotation SIKA/Shadow. Les traces et notifications ne constituent pas une décision humaine, un envoi email ou une preuve de lecture.

## Vérifications

- Suite complète sur le lot : **631 tests, 628 réussis, 3 échecs**. Les mêmes trois échecs étaient reproduits sur la source originale `7875db9`, dans `tests/document-location.test.js` : exception Owner de démarrage, transition mission en échec, démarrage par manager nommé ; attendu `applied`, obtenu `blocked`. Ils n’ont pas été masqués ni les assertions affaiblies.
- Après les derniers ajustements : tests ciblés dossiers/opportunités/procédures/routeur/connecteur passent ; le fichier connecteur final contient huit tests réussis, dont appel HTTP réel sur localhost, ACL, signature, versions, sauvegarde, renommage, liens symboliques et refus Preview. Les tests sont dans le dépôt.
- Chromium, pages et scripts réels avec API simulée : index → dossier, onglets travaux/documents, formulaires spécialiste et cotation, liens dangereux refusés, refus mission après affichage, dépôt base64 sur la page serveur et lecture ; largeur mobile 390 px sans débordement ; aucune erreur JS sur ces parcours. Ce contrôle n’est pas une recette avec les données et permissions du cabinet en production.
- Vérification syntaxique des fichiers JS/MJS modifiés et contrôle des espaces Git. Aucun envoi d’email, écriture Drive réelle ou déploiement du connecteur chez le client pendant les tests.

## Reste à développer ou valider — ne pas le déclarer terminé

1. **Présence dans toute l’application** (« qui est connecté »), états actif/inactif fiables et périmètre manager. Le suivi Excel existant n’est pas étendu en présence globale.
2. Mesure séparée du temps humain, temps IA et attentes sur chaque tâche ; définition/validation des KPI. Ne pas assimiler une page ouverte à de la productivité.
3. Interface par fonction de mission sur toutes les pages et permissions contextuelles complètes ; le lot adapte l’entrée Mes dossiers et conserve les contrôles existants.
4. Notifications push/temps réel, nouveau popup secrétariat et circuit de correction tracée après déclaration d’indépendance déjà certifiée. Le popup personnel existant reste utilisé ; ne pas prétendre qu’un email ou un push a été envoyé à chaque membre.
5. Configuration progressive complète dès première connexion, workflow déduit/proposé et validé, remplacements/escalades automatiques, scan Orpailleur tenant compte de tous les acquis.
6. Exécution de macros VBA, Excel desktop automatisé, calcul natif/coédition, écriture dans tout format et intégration de tous les working files. Les écritures existantes dans les XLSX restent limitées aux parcours autorisés ; l’adaptateur refuse les modifications des classeurs à macros.
7. Parité complète serveur/Drive : scan Orpailleur global local, recherche globale locale, réconciliation des renommages externes, ACL Active Directory, passerelle sortante, installation/supervision/sauvegarde chez le cabinet, hébergement entièrement local. Plusieurs mémoires et processus restent dépendants de Drive.
8. Génération/revue de l’opinion globale et circuit complet manager → partner → secrétariat → contrôle → émission, couverture de tous les jugements et relais des réunions.
9. Nouveaux moteurs d’entraînement humain/IA/collaboration et apprentissage des nouvelles techniques d’audit avec approbation. Les liens et questionnaires existants ne prouvent pas la réalisation des trois moteurs.
10. Recette documentée avec les vrais rôles du cabinet et comparaison actuelle Caseware/Karbon/Canopy/Deltek. Le tremblement signalé sur l’écran anglais n’a pas été reproduit et corrigé de manière vérifiée dans ce lot.

## Installation et retour arrière

Appliquer le lot en conservant ses chemins, jamais tous les fichiers à la racine. Le code est poussé sur `feature/mission-workspace-extension`, commit initial `704a9d2e8a524c3dd172728fcf0cacf0a8f9e650`. Utiliser la pull request vers `feature/white-label-desktop` pour conserver automatiquement les chemins. Aucun upload manuel à plat n’est nécessaire. Un ZIP de sources et un patch peuvent être générés depuis cette branche pour la transmission technique.

Pull request : https://github.com/kyayoun-sudo/office-manager/pull/8 vers `feature/white-label-desktop`. La prévisualisation du commit initial a atteint READY sur Vercel ; les pages et scripts nouveaux répondent 200, l’API sans authentification répond 401. La simple création d’une branche ou d’une PR ne prouve pas un déploiement en production. Vérifier séparément l’état GitHub/Vercel mentionné dans le fichier de livraison ; ne pas annoncer une publication si elle n’a pas réussi. Le retour arrière du code se fait par revert du commit ; la désactivation du connecteur se fait en retirant ses variables backend, sans effacer ses fichiers ni ses versions.
