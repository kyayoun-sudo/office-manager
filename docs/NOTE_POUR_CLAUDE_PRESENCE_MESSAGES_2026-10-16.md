# Présence et alertes de messagerie — 16 octobre 2026

Ajouts sans reconstruction : panneau En ligne dans la navigation des managers/associés, compteur de messages instantanés non lus dans Messages et par conversation, sonnerie désactivable. Chargement commun depuis brand-theme.js ; aucune nouvelle page ni fonction Vercel. Les messages externes et validations restent inchangés.

Présence : heartbeat uniquement pour un onglet visible toutes les 15 secondes, lecture toutes les 5 secondes, expiration après 45 secondes. Il s’agit de présence récente, pas d’un suivi du travail ni d’un flux WebSocket. Le manager voit ses collaborateurs directs selon le paramètre existant ; les associés/owner voient leur cabinet. Les auditeurs n’obtiennent pas le registre de présence. L’identité et le cabinet proviennent de la session serveur.

Non lus : messages entrants autorisés des dernières 24 h (périmètre actuel du chat), lecture enregistrée côté serveur jusqu’au dernier message effectivement affiché. Pas de lecture automatique en arrière-plan ni dans les archives. Le premier chargement ne sonne pas pour l’historique. Le son nécessite une interaction utilisateur selon les règles du navigateur ; un bouton permet de le désactiver. La coordination localStorage réduit les sonneries répétées entre onglets, sans garantir une exclusion atomique.

Sécurité complémentaire : les conversations de mission vérifient maintenant l’affectation pour lire et envoyer ; les autres missions sont retirées du sélecteur. Les nouvelles tables restent service-only avec RLS ; aucun accès direct navigateur.

Installation requise : exécuter db/live-collaboration.sql sur la base de l’environnement visé, après db/memory.sql. Inclus aussi dans INSTALL_TOUT.sql. Aucune migration distante effectuée par cette livraison. Ne pas exécuter sur une base partagée avec la production sans plan de déploiement. Pas de modification de main. Les changements responsables IA précédents restent séparés dans /workspace/office-manager-next et ne font pas partie de cette livraison.

Limites : polling, présence approximative après fermeture, compteur limité à la fenêtre courante du chat (2000 messages/24 h), pas de notification système/mobile en arrière-plan. Le son réel et deux sessions du cabinet nécessitent une recette sur la prévisualisation après installation SQL. Les tests locaux ne prouvent pas une installation distante.

Vérifications : 4 tests métier supplémentaires (identité serveur, compteurs, périmètre, refus de mission), test SQL répété avec RLS et refus anon/authenticated ; routeur, notifications et mémoire passent. Suite générale : les trois échecs préexistants de document-location restent hors périmètre. Installation complète exécutée deux fois dans PGlite ; aucune base distante touchée.

## Emplacement corrigé à la demande de Paul
La présence quitte la navigation : elle apparaît maintenant dans une carte « Équipe en ligne » du tableau de bord accueil, juste après Mon espace, pour les managers/superviseurs/associés/owner. Aucun registre de présence ajouté aux autres pages. Compteurs et alertes restent disponibles globalement.
