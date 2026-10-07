# Aperçu du programme — état de livraison

7 octobre 2026. Notre branche reste fix/map-register-bridge-write.

Aperçu créé depuis les 63 fichiers applicatifs relus du commit local
6467456abbff8c19e750a2d2655cb20b9c0175f2, incluant les contributions utiles
de Claude. Il n'a pas été construit depuis un commit publié sur GitHub.

- Projet : office-manager-personal-pilot, équipe Paul.
- Déploiement : dpl_9bvfEku6vEaALndkZjdSFe7KJTLb.
- Environnement : Preview, état vérifié READY. Aucune promotion en production.
- URL : https://office-manager-personal-pilot-dw4g7ke48-paul-bc10.vercel.app/
- Programme Nova :
  https://office-manager-personal-pilot-dw4g7ke48-paul-bc10.vercel.app/programme.html?mission_id=d64b9ce0-510a-4c6b-bc75-4b2a3bba6021

Vérifications : /api/health 200, programme.html 200, navigateur redirigé vers
la connexion attendue. Le fetch du nouvel endpoint sans code retourne 401 mais
l'outil Vercel le classe comme authentification requise ; ce fetch ne suffit
donc pas à distinguer la protection Vercel et la protection de l'application.
Le refus sans code est vérifié dans les tests de l'API. La recette authentifiée
en ligne reste à faire par Paul. Aucun token de navigateur ou secret récupéré.

L'écran de connexion peut utiliser le **code pilote existant**, option
« Se connecter avec le code d'accès du cabinet ». Les tables de comptes sont
installées mais aucun compte n'a été créé par l'agent. La création du compte
propriétaire reste liée au réglage propriétaire dans Preview, en attente de
l'accord explicite de Paul. Préparer un programme utilise seulement le code pilote.

Recette : entrer → programme Nova → Modèle conseil — parcours client → Préparer
un brouillon → adapter le contenu/échéances → cocher la relecture → Enregistrer
la proposition → rouvrir pour vérifier la version. Ce test ne vaut aucune
approbation du plan, du programme ou de l'équipe, et ne déclenche aucune action.

Le lot complet TATY-Notre-Branche-Programme.zip est prêt pour la publication
manuelle sur notre branche GitHub. Les anciens lots visant la branche de Claude
ou ne contenant que son intégration ne sont plus la livraison la plus récente.
