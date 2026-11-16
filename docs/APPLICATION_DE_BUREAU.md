# Application de bureau Office Manager (Windows et Mac)

Mise en place le 16 novembre 2026. Code : `desktop/` (Tauri 2), fabrication : `.github/workflows/desktop-release.yml`.

## Ce que c'est

Un vrai programme à installer : une icône sur le bureau et dans le menu Démarrer, et sa propre fenêtre.
Il ouvre le serveur du cabinet (https://office.eynowa.com). **Aucune donnée du cabinet n'est gardée sur l'ordinateur** : c'est
la même application que dans le navigateur, avec les mêmes comptes et les mêmes droits.

- Au démarrage, il vérifie que le serveur répond. Sinon, il affiche « Le serveur du cabinet ne répond pas » et un bouton « Réessayer ».
- Les liens vers d'autres sites s'ouvrent dans le navigateur habituel de la personne. Seules les pages de connexion Google restent dans la fenêtre.
- **Mise à jour automatique** : au démarrage, il cherche une nouvelle version. S'il en trouve une, il propose « Installer / Plus tard ».
  Les mises à jour sont signées : l'application refuse une version qui ne vient pas de nous.
- La page n'a accès à rien sur l'ordinateur : aucune commande, aucun fichier.

## Installer sur un ordinateur

1. Ouvrez https://github.com/kyayoun-sudo/office-manager/releases et prenez la dernière « Office Manager … (application de bureau) ».
2. **Windows** : téléchargez le fichier qui se termine par `_x64-setup.exe`, puis ouvrez-le.
   Tant que l'application n'a pas de certificat de signature, Windows affiche « Windows a protégé votre ordinateur » :
   cliquez sur **Informations complémentaires**, puis **Exécuter quand même**. L'installation ne demande pas les droits d'administrateur.
3. **Mac** : téléchargez le `.dmg`, ouvrez-le et glissez Office Manager dans **Applications**.
   Sans certificat Apple, la première ouverture est refusée : faites **clic droit sur l'application → Ouvrir → Ouvrir**.
   Si le Mac dit « endommagé », dans le Terminal : `xattr -cr "/Applications/Office Manager.app"`.
4. Connectez-vous avec votre e-mail et votre mot de passe habituels.

## Publier une nouvelle version

```
git tag desktop-v1.0.1
git push origin desktop-v1.0.1
```

Ou sur GitHub : **Actions → Application de bureau → Run workflow** (version, adresse du serveur).

GitHub fabrique la version Windows et la version Mac (environ 15 minutes), puis la publie avec le fichier de mise à jour.
Les applications déjà installées la proposent au démarrage suivant.

**Une mise à jour du site ne demande pas de nouvelle version de l'application** : la fenêtre affiche toujours la version en
ligne du serveur. Une nouvelle version de l'application ne sert que si la fenêtre elle-même change (icône, adresse, comportement).

## Pour un autre cabinet

Lancez **Run workflow** avec l'adresse de son serveur (`server_url`) : la fenêtre ouvrira ce serveur.
Pour aller plus loin en marque blanche (nom, icône), il faut changer `desktop/src-tauri/tauri.conf.json` et `desktop/app-icon.svg`.

## Pas encore fait

- **Signature de l'éditeur** : sans elle, Windows et Mac affichent un avertissement à l'installation.
  - Windows : certificat de signature de code (OV environ 200 à 400 € par an), à mettre dans les secrets GitHub.
  - Mac : compte Apple Developer (99 $ par an) et notarisation.
- **« Continuer avec Google » dans la fenêtre** : Google refuse parfois les connexions faites dans une application plutôt que
  dans un navigateur. Pas encore essayé. Si Google refuse, il faudra se connecter avec e-mail et mot de passe, ou bien
  développer une connexion qui passe par le navigateur puis revient dans l'application.
- Le complément Excel s'installe à part : voir le dossier `excel/`.
