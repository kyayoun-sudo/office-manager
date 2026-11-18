# Firm Manager Mobile — interface légère du même Firm Manager

> **Clarification du propriétaire (18 novembre 2026) :** ce document remplace la proposition précédente de « deuxième application autonome ». Il s'agit du **même Firm Manager**, auquel on ajoute un mode téléphone léger pour consulter et réaliser certaines activités. Ne pas créer un deuxième produit.

## Un produit, deux interfaces adaptées

- **Ordinateur** : cockpit complet, WP complexes, grande analyse, administration avancée.
- **Téléphone** : les fonctions essentielles pour réellement travailler en version légère : suivi des missions, messagerie instantanée, discussions/instructions avec les agents IA, tâches courtes, réponses et commentaires, validations selon le rôle, photo et dépôt de pièces.
- Les deux utilisent **exactement les mêmes** comptes et authentification, base de données, organisations, permissions, missions, chat, documents, mémoire et agents IA. Le serveur reste la source de vérité.
- Une action effectuée sur mobile doit être retrouvée sur l'ordinateur, et inversement. Pas de duplication d'un workflow ni de nouvelle base mobile.
- Le téléphone ne calcule pas les IA et ne charge pas les gros tableurs. Il contacte les services existants en ligne.

## Architecture recommandée

**Par défaut : même serveur et même origine web**, avec un point d'entrée `/mobile.html` déjà créé dans la branche `feature/mobile-pwa`, une PWA installable avec la même authentification que la version ordinateur. Cette solution évite CORS, les changements d'OAuth et une nouvelle gestion des comptes. Une adresse différente ou un hébergement séparé n'est **pas requis** ; ne le proposer que si un besoin réel l'exige après étude de Christian.

Le développement peut rester dans une **branche Git de travail** dédiée le temps des tests, mais cela ne signifie pas une application métier distincte ni un second déploiement obligatoire. La stratégie de publication de Christian doit mettre les fichiers mobiles à disposition du Firm Manager en service sans remplacer les pages ordinateur ; un PR ou une fusion Git éventuelle n'oblige jamais à fusionner les deux interfaces visuelles. Valider le plan avant tout changement serveur.

## État réel du code

- E0 : inventaire GitHub initial, tests sur vrai serveur à compléter.
- E1 : page `mobile.html`, assets mobiles et navigation à cinq onglets.
- E2 : même session via `assets/brand-theme.js`, installation PWA, manifeste, worker et icônes ; essais d'installation iPhone et Android sur HTTPS encore nécessaires.
- E3 : messagerie interne dans l'interface mobile, réutilisant `/api/app?route=chat` et les droits existants. Les tests automatisés ciblés ont été ajoutés ; recette réelle multi-utilisateurs encore nécessaire.
- E4 : discussions/commandes IA directement dans l'écran téléphone, à réaliser avec les routes existantes.
- E5 : caméra et pièces vers les dossiers de mission déjà existants, à réaliser.
- E6 : activités courtes (job notes, checklists, commentaire WP, approbations selon rôle), à réaliser.
- E7 : optimisation des performances, notifications push avec consentement, à finaliser.
- E8 : tests multi-rôles, sécurité, synchronisation, réseau lent et déploiement après validation.

## Points de recette impératifs

1. Un même collaborateur se connecte au même Firm Manager depuis bureau et téléphone avec les **mêmes identifiants**.
2. Une même mission et ses statuts sont retrouvés sur les deux interfaces ; droits par cabinet, utilisateur et mission identiques.
3. Envoyer et recevoir des messages privés/groupes/missions depuis le téléphone, messages retrouvés au bureau ; aucun autre utilisateur ne lit les DM.
4. Donner à un agent une demande sur téléphone, observer le statut d'exécution réelle côté serveur et le résultat au bureau, sans inventer de réussite.
5. Prendre une photo et la déposer dans la mission, retrouver le même document dans le Drive autorisé.
6. Répondre à une tâche ou effectuer une validation autorisée : le résultat est visible dans l'application bureau.
7. Installer la PWA iOS/Android via HTTPS, tester réseau lent, appareils modestes, session expirée, caméra, rotation, retour et absence d'écran blanc.
8. Ne jamais changer le comportement du bureau, du scheduler, des IA ou de l'authentification existants par inadvertance.
9. Tester puis déployer avec sauvegarde et retour arrière, sans toucher à la production avant validation.

## Instruction à Christian

**Ne pas construire une deuxième application Firm Manager.** Conserver le même backend et ajouter les écrans mobiles les plus utiles, réemployer les fonctions actuelles et masquer les opérations lourdes sur téléphone. La branche mobile protège le développement ; son cycle Git est distinct du fonctionnement métier. Éviter les doubles services et les nouvelles connexions inutiles.
