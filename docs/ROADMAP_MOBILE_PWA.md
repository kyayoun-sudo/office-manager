# Firm Manager Mobile — feuille de route par étapes

Date de lancement : 18 novembre 2026
Dépôt : kyayoun-sudo/office-manager
Branche de travail : feature/mobile-pwa
Branche de référence : feature/white-label-desktop

## Décision d'architecture

**Un seul produit, un seul dépôt, le même backend, la même authentification, les mêmes utilisateurs, organisations, missions, agents, règles d'accès et données.** Le mobile est une interface PWA légère de Firm Manager, non un autre logiciel, non une base indépendante. Pas de deuxième système de connexion.

Le téléphone sert à discuter, agir et suivre. Les calculs d'IA, l'accès documentaire et les opérations métier lourdes sont exécutés par le serveur. Ne pas charger les classeurs complets ou le cockpit de bureau.

**Règle de livraison :** développer dans la branche mobile, vérifier chaque lot, intégrer progressivement par PR contrôlées vers la branche de référence quand il est validé. Ne pas déployer ni fusionner sans recette. Une branche est un espace de développement, pas une seconde application autonome à maintenir indéfiniment.

## E0 — Inventaire et garde-fous (audit initial : code inspecté, tests à exécuter)

Présence confirmée dans le dépôt :
- lib/local-auth.js, lib/user-auth.js : sessions et accès ; migration VPS prévue ;
- lib/chat.js, messagerie.html : messages internes cabinet, groupes, DM, missions ;
- lib/notifications.js : agrégation de notifications ;
- api/app.js : API métier et accès aux agents ;
- server/index.mjs, docker-compose.yml : serveur Node et conteneurs ;
- assets/role-workspace.js : interfaces selon rôles.

**À vérifier avant code fonctionnel :** schéma de connexion réellement utilisé sur le serveur, ergonomie des pages sur iPhone/Android, routes et droits des API, tests en place, serveur effectivement déployé. Vérifier les migrations de chat et le traitement de l'archivage des messages (actuellement les messages dépassant 24 h sont archivés, pas supprimés). Ne pas prétendre que le serveur tourne sur VPS sans preuve.

Preuves : inventaire des endpoints retenus, captures des écrans actuels, résultat de npm test / npm run check / npm run test:sql, liste des permissions.

## E1 — Coquille PWA mobile

Créer une entrée mobile simple `/mobile.html` (ou équivalent) et ses assets avec cinq onglets : Accueil, Messages, IA, Missions, Mon travail. Respecter la charte Firm Manager ; ne pas utiliser toute l'interface de bureau à l'identique. Routage vers les services existants, composants mobiles adaptés au tactile, états chargement / erreur / vide / hors connexion. Ajouter un lien mobile depuis l'application ordinateur si pertinent. Aucun nouvel utilisateur ni mission.

Serveur : adapter explicitement la liste des fichiers publics et le type MIME nécessaires au manifeste PWA et au service worker. Le cache du service worker ne doit contenir que des assets statiques publics, jamais les API, messages, WP, données de mission ou pièces client.

Critère : affichage correct à 320–430 px, navigation clavier/lecteur d'écran basique, retour arrière, aucun écran blanc ni requête inutile en boucle.

## E2 — Même authentification et mêmes permissions

Réutiliser login/session/refresh/logout et `currentAccount` existants. Respecter org_id, rôles, statut actif et contrôle d'accès aux missions. Sessions indépendantes par appareil ; un compte sur mobile est le même compte, mais ne doit pas partager son jeton avec le bureau. Toute API valide ses droits côté serveur. Ne pas inventer des rôles mobile, ni donner accès propriétaire à un junior.

Critères : login avec identifiants existants, expiration/renouvellement, logout, compte désactivé interdit, DM privés non visibles par tiers, missions interdites invisibles et bloquées serveur, changement de cabinet correctement filtré. Tests de non-régression bureau.

## E3 — Messagerie instantanée au centre

Brancher `lib/chat.js` : messages individuels, cabinet, groupes et missions, rédaction/réponses, statut d'envoi, pièces jointes via la chaîne documentaire autorisée (ne pas coller des fichiers arbitraires en base). Distinguer clairement messagerie instantanée et e-mails personnels/partagés. Implémenter d'abord l'actualisation fiable (rafraîchissement maîtrisé), puis évaluer SSE/WebSocket selon les contraintes et résultats. Vérifier l'archivage 24 h et l'historique attendu.

Critères : deux téléphones et un ordinateur échangent, même historique et mêmes règles de visibilité ; aucun message du mauvais cabinet.

## E4 — Agent IA conversationnel qui agit

Brancher les routes IA existantes (ne pas développer un second moteur IA). Dans le contexte de mission, permettre : question, instruction, affectation document, demande de résumé, correction, suivi du statut et résultat vérifiable. Afficher « demandé », « en cours », « terminé avec preuve », « bloqué », « échec ». Une réponse IA n'est jamais une preuve que la tâche est réalisée. Protéger les opérations externes ou destructives par les approbations existantes.

Critères : commande depuis mobile, exécution serveur, dossier/état mis à jour, résultat visible sur bureau ; test d'erreur et de reconnexion.

## E5 — Caméra, fichiers et dossiers de mission

Photo, galerie et fichier via sélecteur système. Prévisualisation locale, éventuelle compression prudente (préserver l'original quand nécessaire pour la preuve), ajout de contexte de mission, envoi sécurisé et reprise d'erreur. Utiliser l'adaptateur documentaire/Shared Drive existant, contrôle anti-doublons et classement par agent, sans recréer une seconde arborescence. Limites de taille et antivirus/contrôles côté serveur à définir.

Critères : pièce correctement attachée à la mission autorisée, provenance conservée, aucun mélange inter-cabinet ; voir le fichier sur ordinateur.

## E6 — Mon travail et validations

Afficher les tâches autorisées par rôle : réponse à job note, commentaire de WP, checklist courte, attribution, statut, points bloquants, revue/validation. Édition mobile limitée aux champs adaptés ; aucun grand tableur rendu en entier. Proposer les messages et e-mails via les systèmes existants ; envoi externe seulement si autorisé et validé conformément au workflow réel.

Critères : un junior accomplit une tâche courte, un senior commente, un manager valide ; les mêmes états s'affichent immédiatement sur bureau. Permissions respectées.

## E7 — Notifications, performance et PWA installable

Manifest, icônes, installation iOS/Android, service worker statique minimal ; puis push après consentement avec abonnements par appareil, expiration/révocation et respect des droits. Distinction entre notification informative et action urgente. Notifications actuelles en application : elles ne sont pas encore un push système. Performance sur réseau lent, chargement progressif, compression et reprise des uploads, tailles raisonnables, tests mémoire et batterie. Hors connexion : brouillons/indicateur réseau limités, pas de stockage local non chiffré des pièces ou messages sensibles.

Critères : installation depuis navigateur, notifications avec consentement, traitement rapide des erreurs, retour connexion stable et aucun blocage sur appareils modestes.

## E8 — Recette, intégration et déploiement serveur

Prérequis : tests unitaires, sécurité et permissions, recette multi-appareils, audits de charge et stockage, contrôle des régressions bureau. Relecture des diffs et PR documentées avec captures et preuves. Sauvegarde DB, paramétrage HTTPS et configuration proxy Docker/IONOS existant à vérifier avant bascule. Déploiement sur un environnement de test d'abord ; mesurer puis déployer sur le serveur en conservant le rollback.

**Ne pas :** créer un nouveau dépôt ou une auth mobile indépendante, redévelopper les missions ou les agents, exposer les secrets GitHub/Drive au navigateur, démarrer deux schedulers sur les mêmes missions, pousser sur la production sans tests, fusionner par défaut les PR.

## Conditions de réussite du MVP

1. Un utilisateur ouvre Firm Manager Mobile depuis son téléphone, se connecte avec son compte normal.
2. Il retrouve ses conversations, ses missions et ses tâches autorisées, avec confidentialité identique au bureau.
3. Il écrit à un collègue ou un groupe et reçoit la réponse.
4. Il donne à un agent une instruction sur une mission : l'action est exécutée sur le serveur, son résultat et son statut sont vérifiables sur ordinateur.
5. Il photographie une pièce et l'envoie dans la mission : elle est visible dans le rangement autorisé.
6. Il répond à une tâche ou fait une validation autorisée, synchronisée avec le bureau.
7. La version ordinateur et les autres cabinets fonctionnent comme avant.

Les étapes E0 à E8 ne sont pas toutes réalisées par le seul dépôt de ce document ; elles constituent le plan de réalisation et les critères de contrôle.
