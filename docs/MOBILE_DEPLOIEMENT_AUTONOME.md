# Firm Manager Mobile — déploiement autonome, sans fusion de l'interface ordinateur

## Décision produit

Le propriétaire demande **deux interfaces distinctes** :
- **Firm Manager ordinateur** : application complète, son cycle de livraison habituel intact.
- **Firm Manager Mobile** : application web installable (PWA), légère, livrée et mise à jour séparément.

Elles ne sont **pas deux bases de données**, ni deux moteurs d'agents et ne nécessitent pas deux comptes. Le mobile appelle les services existants de Firm Manager avec l'identité personnelle du collaborateur. Le serveur reste la source de vérité.

La branche `feature/mobile-pwa` est autonome pour son **cycle de livraison**. Ne pas ouvrir une fusion vers `feature/white-label-desktop` par défaut ; ne pas déployer la version ordinateur en la remplaçant par la branche mobile. La manière de partager durablement le code commun (même dépôt avec packages séparés, ou dépôt frontend mobile ultérieur) est une décision d'architecture à prendre avec Christian ; l'autonomie de la livraison prime.

## Architecture de publication recommandée

Exemple d'adresse (à remplacer par le domaine réellement attribué) :
- Bureau : `https://firm.example.com/`
- Mobile : `https://mobile.firm.example.com/mobile.html`

Sur le **même VPS**, un vhost nginx distinct pourra :
1. Servir **uniquement** les fichiers mobiles publics extraits d'une version approuvée de la branche mobile : `mobile.html`, `mobile-sw.js`, `assets/mobile.js`, `assets/mobile-chat.js`, `assets/mobile.css`, `assets/mobile-manifest.json`, `assets/firm-mobile-*.png`.
2. Faire suivre vers le backend Firm Manager existant, via le réseau interne, les appels `/api/*`, la page `/login.html`, `/cabinets.html`, l'asset partagé `/assets/brand-theme.js` et les pages complètes liées depuis le mobile. L'URL et les en-têtes d'hôte/proxy doivent être validés sans casser OAuth, HTTPS ou les permissions multi-cabinets.
3. Garder les sessions mobiles sur l'origine mobile, sans récupérer des secrets de la page bureau. Les mêmes comptes/personnes sont vérifiés par le même backend (sessions propres à chaque appareil).
4. Enregistrer un certificat TLS valide pour le sous-domaine mobile. Les PWA/installations et service workers nécessitent HTTPS en production.
5. **Ne pas** dupliquer les tâches programmées, la base SQL, ni les agents. Ne pas exécuter une deuxième instance de scheduler.
6. Publier indépendamment les fichiers statiques mobiles, via un répertoire de versions et une bascule atomique, avec rollback vers la version précédente. Le backend desktop reste intact.

Ce modèle garde un même domaine d'origine **à l'intérieur du mobile** pour `/api` et `/login.html`, en s'appuyant sur un reverse proxy ; il évite d'introduire un système CORS différent ou des jetons secrets navigateur. Alternative pour Christian : préfixe `/mobile/` sur le domaine principal, avec distribution autonome ; les chemins du manifeste et du worker devront alors être alignés au préfixe et au scope. **Ne pas appliquer les exemples DNS comme si les domaines existaient.**

Attention : une connexion Google native sur un sous-domaine mobile demande une vérification explicite des URL de redirection OAuth autorisées ; le login par e-mail/mot de passe réutilise déjà les endpoints existants. Même précaution pour le choix d'un cabinet et la redirection vers la bonne interface après login.

## État des étapes

- **E0** : inspection des fichiers et API existants, à compléter par la recette sur serveur réel.
- **E1** : interface mobile à cinq onglets, consultation missions et tâches, PWA installable. Code sur branche, aucun déploiement.
- **E2** : session de Firm Manager réutilisée, contrôles de structure ajoutés. Tests d'intégration multi-utilisateurs sur serveur réel et flux Google/cabinets toujours requis.
- **E3** : messagerie mobile indépendante : conversation cabinet, DM entre collègues, groupes déjà existants, missions autorisées, affichage des archives, émission de messages, rechargement contrôlé. Aucun envoi d'e-mail externe, aucun second moteur de chat. Tests de code ajoutés, vérification réelle avec deux comptes requise.
- **E4-E8** : agents IA dans l'interface mobile, caméra/docs, travail mobile, notifications push et recette/déploiement. Non terminés.

## Tests de recette impératifs

1. Connexion mobile par e-mail/mot de passe ; déconnexion et reconnexion, session expirée, compte désactivé.
2. Comptes de deux cabinets distincts, non-contamination des missions/messages.
3. DM privé inaccessible à un autre collaborateur et au propriétaire sans participation.
4. Groupe inaccessible aux non-membres ; mission inaccessible aux personnes hors staffing.
5. Envoyer un message mobile, le recevoir dans la messagerie bureau et inversement ; actualisation à l'affichage.
6. Perte du réseau pendant une écriture : afficher « non confirmé » et éviter une relance silencieuse (risque doublon).
7. Vérifier l'installation iPhone/Android depuis l'adresse HTTPS effectivement publiée, les icônes et la reprise après mise à jour.
8. Aucun plantage mobile ; aucun changement de la version bureau, agents, base ou scheduler.
9. Vérifier les résultats CI et tester la version mobile dans un environnement de test avant de publier sur le VPS.

## Consigne de livraison

Christian valide le reverse proxy, le déploiement indépendant et la cohérence des URL de connexion. **Ne jamais fusionner la branche mobile avec l'interface ordinateur uniquement pour rendre le téléphone installable.** Les évolutions d'API partagées, si nécessaires, doivent être négociées et testées comme contrats compatibles des deux clients.
