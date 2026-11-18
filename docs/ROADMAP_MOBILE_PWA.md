# Firm Manager Mobile — feuille de route par étapes

Date de lancement : 18 novembre 2026
Dépôt : kyayoun-sudo/office-manager
Branche de travail : feature/mobile-pwa
Branche de référence : feature/white-label-desktop

## Décision d'architecture

**Un seul produit, un seul dépôt, le même backend, la même authentification, les mêmes utilisateurs, organisations, missions, agents, règles d'accès et données.** Le mobile est une interface PWA légère de Firm Manager, non un autre logiciel, non une base indépendante. Pas de deuxième système de connexion.

Le téléphone sert à discuter, agir et suivre. Les calculs d'IA, l'accès documentaire et les opérations métier lourdes sont exécutés par le serveur. Ne pas charger les classeurs complets ou le cockpit de bureau.

**Règle de livraison (clarification du propriétaire, 18 novembre 2026) :** ce n'est pas une application distincte : Firm Manager possède une interface ordinateur complète et une interface téléphone légère. Développer isolément les changements mobiles dans `feature/mobile-pwa` pour éviter les régressions ; conserver les mêmes API, authentification, organisations, permissions, missions, messages, agents IA, stockage et base. Aucune obligation de sous-domaine, de dépôt ou de serveur mobile distinct. Christian choisira le mécanisme d'intégration du code et de publication de l'interface mobile dans **le même Firm Manager**, après tests ; une fusion Git n'est pas une fusion fonctionnelle des interfaces. Ne pas fusionner ni déployer sans recette.

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

## Fonctionnalité globale hors MVP mobile : réunions, agenda et Google Agenda

**À ne pas oublier et à implémenter dans tout Firm Manager** (Web complet + Lite) : appels audio, réunions vidéo, calendrier personnel et par mission, invitations, rappels avant réunion et synchronisation facultative avec Google Agenda du compte Gmail connecté. Cahier des charges suivi dans [GitHub #54](https://github.com/kyayoun-sudo/office-manager/issues/54). Ce n'est pas une fonction uniquement téléphone ; **backlog, non implémentée**.

## E3bis — Appels audio et réunions depuis la messagerie (nouvelle exigence)

**Un seul Firm Manager.** Les appels et réunions sont accessibles dans la messagerie sur ordinateur et téléphone, avec les mêmes droits d'accès aux utilisateurs, groupes et missions. Parcours par lots : **appel audio 1:1 → vidéo 1:1 → réunions de groupe/mission → notifications d'appel**. Les médias passent par WebRTC/SFU, et le téléphone charge le SDK uniquement lorsqu'il en a besoin. Ne pas dupliquer l'authentification ni le stockage, ni enregistrer les réunions par défaut.

**Point bloquant à traiter avant implémentation :** les en-têtes `Permissions-Policy` actuels bloquent caméra/microphone ; la CSP doit être alignée sur le fournisseur média sélectionné, sans désactiver globalement la sécurité. Les appels en arrière-plan sur PWA iOS/Android ne sont pas garantis comme dans une application native.

**Spécification et tests :** [MOBILE_CALLS_MEETINGS.md](MOBILE_CALLS_MEETINGS.md). Christian valide choix LiveKit/Jitsi/Daily, capacité du VPS ou fournisseur géré, et les coûts avant l'intégration.

## E4 — Agent IA conversationnel qui agit

Brancher les routes IA existantes (ne pas développer un second moteur IA). Dans le contexte de mission, permettre : question, instruction, affectation document, demande de résumé, correction, suivi du statut et résultat vérifiable. Afficher « demandé », « en cours », « terminé avec preuve », « bloqué », « échec ». Une réponse IA n'est jamais une preuve que la tâche est réalisée. Protéger les opérations externes ou destructives par les approbations existantes.

Critères : commande depuis mobile, exécution serveur, dossier/état mis à jour, résultat visible sur bureau ; test d'erreur et de reconnexion.

**Avancement E4 (18 novembre 2026) :** écran natif du téléphone ajouté sur la branche mobile ; formulaire agent + demande au backend existant `/api/agent`, réponse, référence de traitement et statut du moteur. Pas de second modèle IA, pas de stockage local des conversations. **Les tests CI et la recette sur vrai serveur doivent confirmer le fonctionnement** ; les commandes liées au contexte de mission et la continuité conversationnelle restent à compléter.

## E5 — Caméra, fichiers et dossiers de mission

Photo, galerie et fichier via sélecteur système. Prévisualisation locale, éventuelle compression prudente (préserver l'original quand nécessaire pour la preuve), ajout de contexte de mission, envoi sécurisé et reprise d'erreur. Utiliser l'adaptateur documentaire/Shared Drive existant, contrôle anti-doublons et classement par agent, sans recréer une seconde arborescence. Limites de taille et antivirus/contrôles côté serveur à définir.

Critères : pièce correctement attachée à la mission autorisée, provenance conservée, aucun mélange inter-cabinet ; voir le fichier sur ordinateur.

**Avancement E5 (18 novembre 2026) :** le volet Missions possède maintenant la capture d'image (appareil photo), l'ajout de PDF, la sélection parmi les missions autorisées, et le dépôt via les actions `piece`/`piece-start` puis `pieces-done` du pipeline existant. L'image originale n'est pas compressée et aucun fichier n'est enregistré durablement sur le téléphone ; 20 Mo maximum pour limiter les risques de plantage. **Test réel sur serveur/Drive, gestion des dépôts interrompus et validation du classement Orpailleur restent à faire.** Aucune reprise automatique : risque de doublon.

## E6 — Mon travail et validations

Afficher les tâches autorisées par rôle : réponse à job note, commentaire de WP, checklist courte, attribution, statut, points bloquants, revue/validation. Édition mobile limitée aux champs adaptés ; aucun grand tableur rendu en entier. Proposer les messages et e-mails via les systèmes existants ; envoi externe seulement si autorisé et validé conformément au workflow réel.

Critères : un junior accomplit une tâche courte, un senior commente, un manager valide ; les mêmes états s'affichent immédiatement sur bureau. Permissions respectées.

**Avancement E6 (18 novembre 2026) :** nouvelle interface « Mon travail » ajoutée : liste des procédures attribuées et des revues issues des endpoints existants `procedure&mine=1` et `procedure&reviews=1`. L'utilisateur peut enregistrer une conclusion courte, répondre à un point de revue et, avec le bon rôle, retourner un point au préparateur ou confirmer la résolution d'un point répondu. Toutes les écritures passent par la même API `/api/app?route=procedure` avec vérification des droits serveur. La signature du Working Paper reste sur la version complète pour examen des preuves. **À terminer** : job notes élargies, checklists métier, validations simples réellement sûres sur mobile, recette réelle multi-rôles et tests des conflits/versionnage. Aucun second stockage des tâches.

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
