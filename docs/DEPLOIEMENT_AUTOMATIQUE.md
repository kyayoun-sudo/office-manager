# Déploiement automatique sur le serveur du cabinet (VPS)

Mis en place le 16 novembre 2026 pour le VPS IONOS (82.165.169.151).

## Pour mettre une version en ligne

Envoyez le code sur la branche **`production`** :

```
git push origin feature/white-label-desktop:production
```

Ou, sur GitHub : **Pull requests → New** (base : `production`, compare : `feature/white-label-desktop`) → **Merge**.

GitHub fait alors, tout seul (onglet **Actions → Déploiement sur le serveur du cabinet**) :

1. **tous les tests** (`npm test` et la vérification du SQL). Si un test échoue, rien n'est envoyé ;
2. l'envoi du code au serveur, qui :
   - vérifie l'archive ;
   - si le SQL de l'application a changé : sauvegarde la base, essaie le nouveau SQL sur une copie, puis l'applique ;
   - garde une copie du code actuel dans `backups/` (les 10 dernières) ;
   - met le nouveau code en place sans toucher à `.env`, aux sauvegardes ni aux réglages locaux (nginx, `docker-compose.override.yml`) ;
   - reconstruit et redémarre l'application (environ 2 minutes de coupure) ;
   - vérifie que `/api/health` répond avec la base. **Sinon, il remet la version précédente** et le travail GitHub échoue ;
3. une dernière vérification de l'adresse publique.

On peut aussi relancer un déploiement à la main : **Actions → Déploiement… → Run workflow**.

## Sécurité

- La clé SSH de GitHub ne sert qu'à une chose : `authorized_keys` la force sur `/usr/local/bin/office-manager-deploy`. Toute autre commande est refusée (essayé).
- Elle est rangée dans les secrets du dépôt (`VPS_SSH_KEY`, `VPS_HOST`, `VPS_KNOWN_HOSTS`) et n'existe nulle part ailleurs.
- Seul ce que Git contient part : jamais `entrainement/`, jamais `.env`.
- Pour la retirer : supprimer la ligne `github-actions-deploy-office-manager` dans `/root/.ssh/authorized_keys` du serveur.

## Ce qui n'est PAS automatique

- **Le contenu de `.env`** (clés, réglages). Une nouvelle variable se règle à la main sur le serveur.
- **Un SQL qui modifie ou supprime** des données existantes. Le déploiement ne rejoue que `db/INSTALL_TOUT.sql`, qui ajoute seulement des tables, colonnes et fonctions. S'il échoue sur la copie d'essai, le déploiement s'arrête avant de toucher la base.
- **Le script du serveur lui-même.** Après une modification de `scripts/vps-deploy-receive.sh`, il faut le réinstaller :
  ```
  ssh ionos-office "cat > /usr/local/bin/office-manager-deploy" < scripts/vps-deploy-receive.sh
  ```

## Protection supplémentaire (facultative, à faire par le propriétaire du dépôt)

Le travail GitHub ne déploie que la branche `production`, même lancé à la main depuis une autre branche.
Pour verrouiller aussi côté GitHub (il faut les droits d'administrateur du dépôt, que Claude n'a pas) :
**Settings → Environments → production → Deployment branches and tags → Selected branches → Add rule `production`**.
Vous pouvez aussi cocher **Required reviewers** : chaque mise en ligne attendra alors votre clic « Approve ».
