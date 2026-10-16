# Transmission à Claude — trois parcours d’entraînement personnel

L’utilisateur a précisé que les trois boutons de l’accueil ne devaient pas ouvrir le même questionnaire. Il veut des exercices métier posés par l’IA, trois questions par mois avec un rappel, la possibilité de s’exercer librement, des consignes/exemples pour son agent, et des cas pour apprendre à travailler avec lui. Les contenus et agents disponibles doivent dépendre du grade/rôle. Instruction maintenue : garder le travail sur `feature/white-label-desktop`, ne pas toucher à `main` ni à la production.

## Réalisé

- Nouvelle page `apprentissage.html`, accessible depuis les trois boutons de l’accueil, avec trois modes distincts.
- **M’améliorer** : une session mensuelle par utilisateur/rôle, exactement trois questions métier et un cas fictif. Le contenu IA reçoit le rôle et le grade quand celui-ci est disponible dans le compte. Les réponses se sauvegardent en brouillon ; la session se reprend sans recréation. Après les trois réponses : retour pédagogique par question. On peut aussi lancer un entraînement libre ; le terminer ne remplace pas la session mensuelle.
- **Entraîner mon IA** : sélection parmi les agents autorisés pour le rôle, champs « ce que je veux », « à éviter », « exemple attendu ». Conservation, révision et retrait des consignes. Les préférences accompagnent les prochaines demandes personnelles dans l’Assistant ; ce n’est pas un fine-tuning du modèle ni une modification des règles du cabinet.
- **Mieux travailler ensemble** : cas fictif distinct de l’entraînement métier, consacré aux demandes à l’agent, à la vérification humaine, à la correction et au passage de relais. Brouillon, reprise et retour pédagogique comme pour les autres sessions.
- Un auditeur peut personnaliser Enhanced Auditor, Mission Controller et Orpailleur ; Firm Manager n’est pas proposé et une requête forcée est refusée côté serveur. Les partenaires et autres grades ont le catalogue déjà défini par les règles existantes.
- Rappel mensuel dans les notifications de l’application : « Votre entraînement du mois : trois questions métier ». Il reste à faire tant que la session mensuelle n’est pas terminée et change de clé au mois suivant. Il apparaît quand les notifications sont consultées, sans tâche Cron nouvelle ni email/push hors application. L’ancien questionnaire de retours demeure accessible, mais son rappel hebdomadaire automatique est retiré pour éviter de confondre feedback et entraînement.
- Les exercices utilisent l’IA du parcours existant uniquement si les autorisations de traitement du cabinet sont accordées. Réponses IA structurées validées : trois questions exactement, puis trois retours correspondants. En cas de refus, panne ou résultat invalide : exercice/correction de référence, identifié explicitement à l’écran, sans prétendre à une évaluation IA.

## Données, identité et conservation

Nouveau service `lib/personal-learning.js`, nouvelle route personnelle dans `/api/app?route=personal-learning`. Pas de table SQL nouvelle, pas de migration, pas de fonction Vercel supplémentaire, pas de changement des dépendances.

Les sessions et préférences sont stockées dans un fichier de mémoire Drive dédié par organisation et email (nom dérivé SHA-256). L’API utilise exclusivement l’identité personnelle vérifiée, jamais une adresse ou un rôle fournis par le navigateur. Les accès applicatifs ne donnent pas accès aux réponses d’un autre utilisateur. Comme pour les autres mémoires de l’application, les droits directs sur le dossier Drive restent ceux du cabinet.

Lecture stricte : une erreur Drive, un JSON invalide ou plusieurs fichiers homonymes ne sont jamais assimilés à une mémoire vide. Révisions contrôlées et écritures avec version attendue ; verrou de processus pour les demandes concurrentes du même utilisateur. Les garanties inter-processus restent celles du fournisseur Drive et de son contrôle de version, pas une transaction de base de données. Limites explicites de 200 sessions et 200 changements de préférences avant intervention ; pas de purge silencieuse.

Les corrigés restent masqués jusqu’à la fin. Les réponses ne deviennent pas des notes RH, des sign-offs ni des modifications de mission. Les préférences restent des données de contexte sous les règles système et les permissions existantes.

Le vrai écran Assistant appelle `/api/agent` : cette route vérifie désormais le bearer lorsqu’il est fourni avant d’utiliser les préférences personnelles. Les appels historiques avec le seul code pilote n’acquièrent aucune identité ni préférence personnelles. Les sessions expirées conservent le code `TOKEN_EXPIRED` pour que le navigateur puisse les renouveler. Le contexte personnel est aussi pris en charge dans les demandes du routeur déjà exécutées avec `personal-ai.runAs`.

## Vérification

- Dix nouveaux tests métier : périodicité mensuelle, trois questions, corrigés masqués, brouillon/reprise, session libre distincte, isolation utilisateur/organisation/rôle, conflit de révision, agents autorisés, retrait de préférences, refus IA et JSON invalide, concurrence de démarrage, rappel mensuel et refus d’écraser après une erreur de stockage.
- Suite complète : **641 tests, 638 réussis, trois échecs document-location déjà reproduits sur la version d’origine** (démarrage avec exception Owner, transition de mission en échec, manager nommé). Aucun échec masqué.
- Chromium avec vrais HTML/JS, serveur HTTP de test et service métier réel derrière un stockage simulé : ouvrir trois questions, sauvegarder une réponse, recharger/reprendre, répondre et voir les trois retours, contrôler les consignes et agents du rôle, reprendre celles-ci après rechargement, ouvrir le cas de collaboration ; contrôle mobile 390 px et texte HTML hostile inerte ; aucune erreur JavaScript sur ces parcours.
- Le test navigateur ne constitue pas une recette avec le Drive ou les clés IA réels du cabinet. Aucun email envoyé et aucune donnée réelle de mission modifiée pendant les tests.

## Limites et suite

Pas de réentraînement des poids du modèle, pas de règle globale du cabinet modifiée par un junior, pas de publication automatique d’une méthode, pas de nouveau KPI ni de notation RH. Les préférences s’appliquent aux conversations personnelles de l’Assistant, pas à tous les agents planifiés en arrière-plan ni à chaque traitement spécialisé du produit.

Le rôle de compte pilote ce lot. Le grade libre est utilisé s’il est déjà présent dans le compte fourni ; sa résolution complète depuis toutes les fiches RH et les fonctions de chaque mission reste à étendre. Les cas générés sont pédagogiques, pas une validation de la méthodologie professionnelle du cabinet. Le calendrier mensuel est UTC.

Pas d’email ni de notification mobile hors connexion. Une notification nouvelle apparaît à l’ouverture/actualisation de l’application. Une planification d’envois externes exigerait un circuit et une configuration supplémentaires.

Le laboratoire d’entraînement existant (`entrainement.html`), le questionnaire historique et les autres fonctionnalités sont conservés. `main` et la production restent inchangées.
