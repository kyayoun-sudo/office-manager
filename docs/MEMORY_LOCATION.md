# Emplacement de la mémoire

MAP et REGISTER peuvent résider dans le dossier de pilotage du cabinet.
Le dossier est défini par OFFICE_MANAGER_MEMORY_FOLDER_ID, sans chemin ou
identifiant de cabinet ajouté au code. Le registre maître reste inchangé.

Après déplacement des deux fichiers avec leurs identifiants conservés, régler
OFFICE_MANAGER_REQUIRE_EXISTING_MEMORY=true. La lecture et le passage de
cartographie refusent alors une mémoire absente ou incomplète, sans créer
un nouveau MAP / REGISTER. Sans ces réglages, le mode historique est préservé.

Les variables Vercel ne s'appliquent qu'aux nouveaux déploiements :
https://vercel.com/docs/environment-variables
Les anciennes previews et l'ancienne production doivent être remplacées avant
d'y lancer un passage de cartographie. La modification d'un réglage projet
ne reconfigure pas ces anciens déploiements.

Le déplacement ne restreint pas les permissions héritées du Drive partagé.
Vérifier les accès séparément ; ce travail ne rend pas la mémoire privée.
Ne pas appliquer une restriction qui retirerait l'accès au compte de l'application.

183 tests automatisés passent. Le nouveau test vérifie la réouverture après
déplacement avec les mêmes identifiants, l'absence de doublons et le refus
d'une mémoire incomplète ou mal configurée. Aucun appel de modèle nécessaire.
