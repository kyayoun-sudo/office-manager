# Navigation, paramètres et accès du laboratoire — 16 novembre 2026

## Objectif
Conserver toutes les fonctions métier existantes, simplifier leur accès et réserver le laboratoire IA au propriétaire, aux associés (décision de Paul, 16 novembre 2026) et au responsable informatique. Office Manager est un produit indépendant et multi-cabinet : ne jamais insérer de secrets ou de données client dans les fichiers du dépôt.

## Comportement de l’interface
- Barre commune **Précédent / Actualiser / Suivant**, affichée sur les espaces authentifiés.
- Bouton **⋯** pour réduire/étendre le menu latéral ; préférence locale par personne/rôle.
- Menu compact avec icônes, libérant la largeur du document ; panneau normal sur mobile.
- Largeur principale libérée de la limite de 1 240 px ; lisibilité/contraste du rail améliorés.
- Avertissement sur les champs modifiés avant les actions de retour, avance ou rechargement ; les boutons propres à chaque écran restent inchangés.
- Nouveau centre de paramètres avec recherche des rubriques : Mon compte, Identité, Équipe et accès, Connexions, Agents, Méthodes, Administration avancée.
- Les formulaires, identifiants HTML, handlers, données existantes et routes restent les mêmes ; les sections d’origine sont uniquement montrées ou masquées.
- Les liens historiques vers les sections de Paramètres sont reconnus ; les anciens onglets automatiques sont désactivés sur cette seule page.

## Rôles du laboratoire
| Action | Propriétaire | Responsable informatique | Associé / autres |
|---|---|---|---|
| Accéder à Entraînement et à Shadow | Oui | Oui | Non |
| Créer et piloter le cabinet virtuel | Oui | Oui | Non |
| Lancer les tests spécialisés | Oui | Oui | Non |
| Piloter les exercices sur cinq jours | Oui | Oui | Non |
| Importer/exporter les leçons et tests | Oui | Oui | Non |
| Valider, rejeter, modifier les leçons et ouvrir des PR brouillon | Oui | Oui | Non |
| Contrôler les pièces d'une mission client réelle depuis Shadow | Oui | Non | Non |
| Signer, valider, lire des missions clientes réelles | Selon rôles métier | Non | Selon rôles métier |

**Important** : les autorisations de laboratoire ne donnent pas accès aux données de missions clients. Le rapport d'entraînement reste exploitable côté IT ; pour les cas réels, le contenu, les réponses, les justificatifs et les leçons détaillées ne sont pas retournés à ce rôle. Les anciens résultats du contrôle qualité de missions réelles sont masqués dans la vue Shadow de l'administrateur informatique.

La route de veille commerciale continue d'utiliser les rôles des associés : les associés gardent l'accès au laboratoire et y décident des leçons.

## Actualisation et effets de bord
La lecture de la campagne d'entraînement (`GET training`) est devenue purement consultative : elle ne déclenche plus de passage d'agent. L'avancement est exécuté au démarrage ou par `training-step`/le planificateur. Si la campagne n'avance plus, vérifier ces exécutions au lieu de mettre le rattrapage sur la route de lecture.

## Tests à lancer avant fusion
```sh
npm run check
npm test
npm run test:sql
node tests/verify-install-sql.mjs
```
Examiner notamment `tests/workspace-ux-access.test.js`, `tests/training.test.js`, `tests/firm-simulation-service.test.js` et `tests/audit-sandbox.test.js`.

## Recette manuelle dans l'aperçu
1. Se connecter comme propriétaire, ouvrir Paramètres et parcourir toutes les catégories ; modifier puis enregistrer un réglage non sensible, recharger, confirmer sa persistance.
2. Ouvrir Mission, Documents et Auditeur ; réduire le menu, utiliser Précédent/Actualiser/Suivant, vérifier la largeur et les icônes.
3. Tester un formulaire modifié avant Actualiser : aucune saisie ne doit être perdue sans confirmation.
4. Se connecter comme responsable informatique : créer un cabinet virtuel, contrôler une campagne fictive, importer/exporter un lab et approuver une leçon. Vérifier que les documents clients et les contrôles de mission réelle sont inaccessibles.
5. Se connecter comme manager puis auditeur : le laboratoire ne doit ni figurer dans le menu ni être accessible par URL/API ; l'apprentissage personnel demeure disponible.
6. Vérifier les anciens liens directs `/parametres.html#h-google`, `#h-users`, `#h-tone` ainsi que les liens du menu de paramètres.
7. Tester sur téléphone et sur un écran de largeur réduite, et sur une installation multitenant avec deux cabinets isolés.

## Limites
Le rechargement commun est un rechargement de page navigateur ; il ne déclenche pas directement d'action IA via le bouton, mais chaque écran doit maintenir ses propres lectures réseau sans effets de bord. Les tests locaux sans accès aux comptes réels ne prouvent pas la recette visuelle sur Vercel ni l'exécution en production. Fusion et promotion uniquement après CI verte et validation humaine.
