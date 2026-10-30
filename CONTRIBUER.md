# Travailler sur Office Manager AI — récupérer le code et lancer les tests

Tout le travail en cours est sur la branche **`feature/white-label-desktop`**.

## 1. Outils (une seule fois)

- **Git**
- **Node.js 24** (la version de la CI ; avec Node 20, les tests du pont Supabase échouent : ils chargent des fichiers `.ts`)
- facultatif : **GitHub CLI** (`gh`), pour voir l'état de la CI

## 2. Récupérer le code

Première fois :

```
git clone git@github.com:kyayoun-sudo/office-manager.git
cd office-manager
git checkout feature/white-label-desktop
```

Ensuite, pour avoir les dernières modifications :

```
git fetch origin
git checkout feature/white-label-desktop
git pull
```

## 3. Installer les dépendances

```
npm install
```

(La CI utilise `pnpm install --frozen-lockfile` : mêmes versions exactes. Les deux conviennent.)

## 4. Lancer les tests

```
npm run check                        # syntaxe de tous les fichiers JavaScript
npm test                             # tous les tests (environ 4 minutes)
npm run test:sql                     # le SQL de la base
node tests/verify-install-sql.mjs    # db/INSTALL_TOUT.sql s'installe et se relance sans erreur
```

Attendu au 30/10/2026 : **1 336 réussis, 0 échec, 1 ignoré**. Ces tests n'ont besoin d'aucun secret ni d'aucune connexion
(Supabase, Google, IA) : tout est simulé. Ils prouvent la logique, pas le fonctionnement réel.

## 5. Essayer l'application en vrai

Rien à lancer chez soi : on passe par l'**aperçu Vercel** de la branche (adresse donnée par Paul) avec un compte créé dans le
cabinet (Paramètres → Comptes). Les essais à faire sont au point 000 de `docs/A_FAIRE_DE_VOTRE_COTE.txt`.
Un écran qui affiche `UNAUTHORIZED` ou `USER_SESSION_REQUIRED` : noter la page et l'heure.

**Jamais de secret** (clés Supabase, Google, IA, variables `OFFICE_MANAGER_*`) par message ou par e-mail : ils restent dans Vercel.
Pour les voir ou les régler, se faire inviter dans le projet Vercel.

## 6. Modifier le code

1. Lire d'abord `CLAUDE.md` (mémoire et règles du projet), puis `AUDIT_2026-10-30.md` et `sauv.md`.
2. Travailler sur **sa propre branche**, jamais directement sur `feature/white-label-desktop` :

   ```
   git checkout feature/white-label-desktop
   git pull
   git checkout -b fix/mon-sujet
   ```

3. Avant chaque envoi : `npm run check` et `npm test` verts.
4. Envoyer la branche et ouvrir une pull request vers `feature/white-label-desktop` :

   ```
   git push -u origin fix/mon-sujet
   gh pr create --base feature/white-label-desktop
   ```

5. Vérifier que la CI est verte (onglet « Actions » sur GitHub, ou `gh run list`). Une CI rouge n'est jamais laissée telle quelle :
   c'est ainsi qu'une correction a été perdue sans que personne ne le voie (octobre 2026).

Sous Windows, git convertit les fins de ligne (CRLF) : c'est normal, ne pas les « corriger » à la main.
La mise en production (« Promote » dans Vercel, jamais « Redeploy ») est faite par Paul.
