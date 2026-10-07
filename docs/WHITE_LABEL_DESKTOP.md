# Marque blanche, recherche globale et application de bureau

Ajout du 2026-10-07, branche `feature/white-label-desktop`, créée depuis
`fix/map-register-bridge-write` (3e567eb).

**Règle suivie : ajout seulement.** Aucun fichier existant n'est modifié,
renommé ou supprimé. Aucune table, fonction SQL ou règle RLS existante n'est
touchée. `index.html`, les agents, les outils et les endpoints existants sont
inchangés.

## Ce qui est ajouté

| Fichier | Rôle |
|---|---|
| `db/org-branding.sql` | Nouvelle table `office_org_branding` : nom du cabinet, couleur principale, couleur secondaire, logo. RLS activé, aucun accès public, pas de suppression. |
| `lib/branding.js` | Validation (couleurs `#RRGGBB`, logo PNG/JPG/WebP ≤ 400 000 caractères, SVG refusé), contraste WCAG, lecture et enregistrement. |
| `api/app.js` (route `branding`) | `GET`/`POST /api/app?route=branding` : lire et enregistrer. Protégé par le token pilote. |
| `lib/global-search.js` | Recherche en lecture seule : inventaire Drive (Orpailleur), missions, annuaire. Aucun profil RH ni questionnaire. |
| `api/app.js` (route `search`) | `GET /api/app?route=search&q=…&scope=…`. Aucune écriture, aucun appel IA. |
| `parametres.html` | Écran « Paramètres du cabinet » : nom, nom d'utilisateur, logo, couleur, aperçu en direct. |
| `recherche.html` | Écran « Recherche » : barre de recherche, filtres, Ctrl+K. |
| `assets/brand-theme.js`, `assets/app.css` | Thème partagé : applique nom, logo et couleur du cabinet sur les nouvelles pages. Même clé de session que `index.html` (`officeManagerToken`). |
| `desktop/` | Coquille Tauri v2 : ouvre l'application hébergée dans une fenêtre native, sans aucune permission locale. |
| `tests/branding.test.js`, `tests/global-search.test.js`, `tests/verify-branding-sql.mjs` | 10 tests Node + vérification SQL (PGlite). |

## Vérifications faites

- Nouveaux tests : 10/10.
- SQL : `node tests/verify-branding-sql.mjs` réussi (idempotent, une ligne par
  organisation, contraintes, RLS, pas d'accès anon/authenticated, pas de DELETE).
- Suite complète : 123/124. Le seul échec, `tests/browser-response.test.js`,
  **existait déjà avant cet ajout** (SyntaxError dans le script extrait de
  `index.html`) ; il n'est pas lié à ces fichiers.
- `npm run test:sql` et `tests/verify-plan-sql.mjs` existants : toujours OK.

## Non fait / à faire

- **Rien n'est déployé.** Ni Vercel, ni Supabase, ni Edge Function.
- **Appliquer `db/org-branding.sql`** dans Supabase après relecture, sinon
  `/api/app?route=branding` répond `BRANDING_UNAVAILABLE`.
- **Nom d'utilisateur** : enregistré sur l'ordinateur (localStorage), car
  l'application n'a pas encore de comptes utilisateurs. À brancher sur de vrais
  comptes plus tard.
- **Écrire les réglages** demande le token pilote, comme le reste de l'application.
  Avec de vrais comptes, réserver `POST /api/app?route=branding` à l'administrateur.
- **Réponse rédigée par l'assistant** en tête de la recherche : non branchée
  (la recherche reste déterministe). Peut appeler `/api/agent` ensuite.
- **Écran « À valider »** de la maquette : non construit ici.
- **Lien depuis `index.html`** vers les nouvelles pages : volontairement absent
  pour ne pas modifier l'existant. Accès direct : `/recherche.html`,
  `/parametres.html`.
- **Application de bureau** : non compilée ici.
  1. Remplacer `frontendDist` dans `desktop/src-tauri/tauri.conf.json` par
     l'adresse Vercel réelle.
  2. Placer le logo du cabinet en `desktop/logo-cabinet.png` (carré, 1024 px).
  3. `cd desktop && npm install && npm run icons && npm run build`
     (Rust et les prérequis Tauri de la plateforme sont nécessaires).
  Pour vendre à un autre cabinet : changer `productName`, `identifier`, le logo,
  puis reconstruire.

## Ajout 2 — écrans Accueil, Missions et À valider (2026-10-07)

Toujours en ajout seulement : aucun fichier d'origine du projet n'est modifié.
Seuls trois fichiers de l'ajout 1 sont mis à jour (menu commun, page d'ouverture
de l'application de bureau) : `parametres.html`, `recherche.html`,
`desktop/src-tauri/tauri.conf.json`.

| Fichier | Rôle |
|---|---|
| `accueil.html` | Tableau de bord : recherche, missions, nombre de propositions à valider, dernières demandes aux agents. |
| `mission.html` | Liste des missions et dossier d'une mission (`?id=`) : chiffres clés, points à régler, équipe, actions, documents, plan proposé, question au Mission Controller. |
| `validations.html` | « À valider » : propositions des agents, filtre par agent, Valider / Reporter / Refuser (commentaire obligatoire pour refuser). |
| `lib/mission-view.js`, `api/mission-view.js` | Dossier de mission + noms de l'équipe (nom et fonction uniquement, jamais e-mail, compétences, CV ou profil RH). Lecture seule. |
| `lib/action-decisions.js`, `api/actions.js` | Liste des propositions en attente et journal des décisions. |
| `db/action-decisions.sql` | Nouvelle table `office_action_decisions`, journal **en ajout seul** (ni modification ni suppression), avec l'empreinte exacte du contenu décidé. |
| `assets/screens.css`, `assets/screens.js` | Styles et outils communs des écrans. |
| `tests/action-decisions.test.js`, `tests/verify-action-decisions-sql.mjs` | 7 tests + vérification SQL. |

**Important — ce qu'une décision fait et ne fait pas :** elle est enregistrée et
horodatée dans `office_action_decisions`. Elle **ne modifie pas**
`office_action_queue` et **ne déclenche rien** (aucun envoi, classement ou
affectation). Brancher l'exécution d'une décision validée est une étape
ultérieure, à faire explicitement, action par action.

**La question au Mission Controller** (écran mission) appelle l'endpoint
existant `/api/agent` : elle part chez OpenAI et l'agent peut utiliser ses
outils habituels, avec leurs garde-fous existants.

Vérifications : nouveaux tests 7/7 ; SQL OK ; suite complète 130/131 (seul
échec : `tests/browser-response.test.js`, déjà présent avant ces ajouts).
À appliquer dans Supabase : `db/action-decisions.sql` (en plus de
`db/org-branding.sql`).

## Correctif — limite de 12 fonctions Vercel (2026-10-07)

L'aperçu Vercel échouait à l'étape « Deploying outputs » : le dossier `api/`
comptait 13 fichiers, alors que l'offre Hobby de Vercel accepte au plus
12 fonctions. Les 4 endpoints ajoutés (`api/branding.js`, `api/search.js`,
`api/actions.js`, `api/mission-view.js`) sont regroupés dans **un seul
fichier, `api/app.js`**, avec un paramètre `route` :

- `/api/app?route=branding` (GET, POST)
- `/api/app?route=search&q=…&scope=…` (GET)
- `/api/app?route=actions` (GET, POST)
- `/api/app?route=mission-view&mission_id=…` (GET)

Total `api/` : 10 fonctions. Les endpoints d'origine du projet sont inchangés.
Le test `tests/app-router.test.js` vérifie aussi que `api/` reste à 12 fichiers au plus.

## Ajout 3 — Assistant intégré et paramètres propriétaire (2026-10-07)

- `assistant.html` : la console pilote dans la même application (voir `docs/POUR_CHATGPT.md`).
- `parametres.html` réservé au propriétaire / associés-gérants (code propriétaire).
  Nouvelles sections : e-mail de l'agent (nom, adresse d'envoi, réponse, alias,
  domaines du cabinet) et ton avec les collègues (nouchi et blagueur par défaut).
- `lib/owner-auth.js`, `lib/agent-persona.js`, `db/agent-persona.sql`, routes
  `agent-persona` (propriétaire) et `agent-message` (brouillon, jamais envoyé)
  dans `api/app.js`. `POST branding` est désormais réservé au propriétaire.
- Tests : `tests/agent-persona.test.js`, `tests/verify-agent-persona-sql.mjs`.
- Résumé complet pour reprendre le travail : **`docs/POUR_CHATGPT.md`**.

## Ajout 4 — Connexion par e-mail et mot de passe (2026-10-07)

`login.html`, `lib/accounts.js`, `db/app-users.sql`, routes `login`, `session`,
`logout`, `bootstrap-owner`, `users` dans `api/app.js`, session persistante et
bouton « Se déconnecter » dans `assets/brand-theme.js`, gestion des comptes dans
`parametres.html`. Détails et limites : `docs/POUR_CHATGPT.md`.
